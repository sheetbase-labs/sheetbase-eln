/**
 * Plate runs and worklists (migration 0104): one plate read on an instrument,
 * with its layout, readout, analysis settings and the last analysis; and the
 * transfer lists a liquid handler runs.
 *
 * Reads go straight to the tables under row-level security. Every change goes
 * through an RPC so the rules (who may write, what a well may hold, clearing a
 * stale analysis) stay in the database. The analysis itself is computed here by
 * `plate-assay.ts` from the stored layout and readout, then saved beside them.
 */
import type { DataClient } from '#/lib/data-client'
import { analysePlate, normaliseAssayConfig } from '#/lib/plate-assay'
import type {
  AssayWell,
  PlateAnalysis,
  PlateAssayConfig,
  PlateReadout,
  QcStatus,
} from '#/lib/plate-assay'
import type { PlateFormat } from '#/lib/plate-map'
import type {
  Transfer,
  WorklistFormat,
  WorklistMode,
} from '#/lib/plate-worklist'

export const plateRunKeys = {
  all: ['plate-runs'] as const,
  list: ['plate-runs', 'list'] as const,
  one: (id: string) => ['plate-runs', 'one', id] as const,
  worklists: ['plate-runs', 'worklists'] as const,
}

export type PlateRunStatus = 'draft' | 'analysed' | 'archived'

export interface PlateRunRow {
  id: string
  number: number
  name: string
  project_id: string | null
  record_id: string | null
  design_id: string | null
  format: PlateFormat
  rows: number
  cols: number
  wells: AssayWell[]
  readout: PlateReadout
  config: PlateAssayConfig
  results: PlateAnalysis | null
  qc_status: QcStatus | null
  status: PlateRunStatus
  analysed_at: string | null
  analysed_by: string | null
  metadata_version: number
  created_by: string
  created_at: string
}

interface PlateRunWire extends Omit<PlateRunRow, 'config' | 'status'> {
  config: unknown
  status: string
}

const RUN_COLUMNS =
  'id,number,name,project_id,record_id,design_id,format,rows,cols,wells,readout,config,results,qc_status,status,analysed_at,analysed_by,metadata_version,created_by,created_at'

export function plateRunReference(number: number): string {
  return `PLR-${String(number).padStart(4, '0')}`
}

export function worklistReference(number: number): string {
  return `WL-${String(number).padStart(4, '0')}`
}

function toRun(wire: PlateRunWire): PlateRunRow {
  return {
    ...wire,
    config: normaliseAssayConfig(wire.config),
    status:
      wire.status === 'analysed' || wire.status === 'archived'
        ? wire.status
        : 'draft',
  }
}

export async function fetchPlateRuns(
  client: DataClient,
): Promise<PlateRunRow[]> {
  const rows = await client.list<PlateRunWire>(
    'plate_runs',
    `?select=${RUN_COLUMNS}&status=neq.archived&order=number.desc&limit=1000`,
  )

  return rows.map(toRun)
}

export async function fetchPlateRun(
  client: DataClient,
  id: string,
): Promise<PlateRunRow | null> {
  const rows = await client.list<PlateRunWire>(
    'plate_runs',
    `?select=${RUN_COLUMNS}&id=eq.${encodeURIComponent(id)}&limit=1`,
  )

  return rows.length ? toRun(rows[0]) : null
}

export interface NewPlateRun {
  name: string
  format: PlateFormat
  wells: AssayWell[]
  readout: PlateReadout
  config: PlateAssayConfig
  projectId?: string | null
  recordId?: string | null
  designId?: string | null
}

export async function createPlateRun(
  client: DataClient,
  input: NewPlateRun,
): Promise<PlateRunRow> {
  const wire = await client.rpc<PlateRunWire>('create_plate_run', {
    p_name: input.name.trim(),
    p_format: input.format,
    p_wells: input.wells,
    p_readout: input.readout,
    p_config: input.config,
    p_project_id: input.projectId ?? null,
    p_record_id: input.recordId ?? null,
    p_design_id: input.designId ?? null,
  })

  return toRun(wire)
}

export async function updatePlateRun(
  client: DataClient,
  id: string,
  patch: {
    name?: string
    wells?: AssayWell[]
    readout?: PlateReadout
    config?: PlateAssayConfig
  },
  expectedVersion?: number,
): Promise<PlateRunRow> {
  const wire = await client.rpc<PlateRunWire>('update_plate_run', {
    p_plate_run_id: id,
    p_name: patch.name ?? null,
    p_wells: patch.wells ?? null,
    p_readout: patch.readout ?? null,
    p_config: patch.config ?? null,
    p_expected_metadata_version: expectedVersion ?? null,
  })

  return toRun(wire)
}

/** Analyse a run from what it stores and keep the result beside it. */
export async function analyseAndSavePlateRun(
  client: DataClient,
  run: Pick<
    PlateRunRow,
    'id' | 'wells' | 'readout' | 'config' | 'metadata_version'
  >,
): Promise<{ run: PlateRunRow; analysis: PlateAnalysis }> {
  const analysis = analysePlate(run.wells, run.readout, run.config)

  const wire = await client.rpc<PlateRunWire>('save_plate_run_analysis', {
    p_plate_run_id: run.id,
    p_analysis: analysis,
    p_qc_status: analysis.qc.status,
    p_expected_metadata_version: run.metadata_version,
  })

  return { run: toRun(wire), analysis }
}

export async function archivePlateRun(
  client: DataClient,
  id: string,
): Promise<void> {
  await client.rpc<unknown>('archive_plate_run', { p_plate_run_id: id })
}

/**
 * Link layout labels to sample records. A label that is a sample's identifier
 * (SMP-0012) or exact title gets that sample's id, so a worklist can withdraw
 * from it. Anything else stays a plain label.
 */
export async function resolveSampleIds(
  client: DataClient,
  labels: readonly string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(labels.map((l) => l.trim()).filter(Boolean))]
  const found = new Map<string, string>()

  for (let i = 0; i < unique.length; i += 100) {
    const batch = unique.slice(i, i + 100)
    const list = batch.map((l) => `"${l.replace(/[",()\\]/g, '')}"`).join(',')

    const rows = await client.list<{
      id: string
      identifier: string
      title: string
    }>(
      'records',
      `?select=id,identifier,title&kind=eq.sample&deleted_at=is.null&or=(identifier.in.(${list}),title.in.(${list}))&limit=500`,
    )

    for (const r of rows) {
      found.set(r.identifier, r.id)

      if (!found.has(r.title)) found.set(r.title, r.id)
    }
  }

  return found
}

// ---------------------------------------------------------------------------
// Worklists
// ---------------------------------------------------------------------------

export interface PlateWorklistRow {
  id: string
  number: number
  name: string
  run_id: string | null
  record_id: string | null
  format: WorklistFormat
  mode: WorklistMode
  source_plate: string
  source_format: PlateFormat
  dest_plate: string
  dest_format: PlateFormat
  transfers: Array<
    Pick<
      Transfer,
      'sourceWell' | 'destWell' | 'volumeUl' | 'label' | 'sampleId'
    >
  >
  options: Record<string, unknown>
  status: 'planned' | 'complete' | 'cancelled'
  reconciled: Array<Record<string, unknown>> | null
  withdrawals: {
    recorded: boolean
    withdrawn: Array<{ identifier: string; quantity: number; unit: string }>
    skipped: Array<{ identifier?: string; reason: string; message?: string }>
  } | null
  completed_at: string | null
  created_by: string
  created_at: string
}

const WORKLIST_COLUMNS =
  'id,number,name,run_id,record_id,format,mode,source_plate,source_format,dest_plate,dest_format,transfers,options,status,reconciled,withdrawals,completed_at,created_by,created_at'

export async function fetchPlateWorklists(
  client: DataClient,
): Promise<PlateWorklistRow[]> {
  return client.list<PlateWorklistRow>(
    'plate_worklists',
    `?select=${WORKLIST_COLUMNS}&order=number.desc&limit=1000`,
  )
}

export async function createPlateWorklist(
  client: DataClient,
  input: {
    name: string
    format: WorklistFormat
    mode: WorklistMode
    sourcePlate: string
    sourceFormat: PlateFormat
    destPlate: string
    destFormat: PlateFormat
    transfers: Transfer[]
    runId?: string | null
    recordId?: string | null
    options?: Record<string, unknown>
  },
): Promise<PlateWorklistRow> {
  return client.rpc<PlateWorklistRow>('create_plate_worklist', {
    p_name: input.name.trim(),
    p_format: input.format,
    p_mode: input.mode,
    p_source_plate: input.sourcePlate,
    p_source_format: input.sourceFormat,
    p_dest_plate: input.destPlate,
    p_dest_format: input.destFormat,
    p_transfers: input.transfers.map((t) => ({
      sourceWell: t.sourceWell,
      destWell: t.destWell,
      volumeUl: t.volumeUl,
      label: t.label,
      sampleId: t.sampleId,
    })),
    p_plate_run_id: input.runId ?? null,
    p_record_id: input.recordId ?? null,
    p_options: input.options ?? {},
  })
}

export async function completePlateWorklist(
  client: DataClient,
  input: {
    worklistId: string
    reconciled: Array<Record<string, unknown>>
    purposeRecordId?: string | null
    recordWithdrawals: boolean
  },
): Promise<PlateWorklistRow> {
  return client.rpc<PlateWorklistRow>('complete_plate_worklist', {
    p_worklist_id: input.worklistId,
    p_reconciled: input.reconciled,
    p_purpose_record_id: input.purposeRecordId ?? null,
    p_record_withdrawals: input.recordWithdrawals,
  })
}

export async function cancelPlateWorklist(
  client: DataClient,
  id: string,
): Promise<void> {
  await client.rpc<unknown>('cancel_plate_worklist', { p_worklist_id: id })
}

export function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}
