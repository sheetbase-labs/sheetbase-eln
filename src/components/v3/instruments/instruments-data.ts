import { useQuery } from '@tanstack/react-query'

import type { Tone } from '#/components/v3/ui/status'
import type { DataClient } from '#/lib/data-client'
import { notebookDataClient } from '#/lib/notebook-data'

/**
 * UI port (roadmap-4/ui-app3): the Instruments area (LAB-06, folded from
 * DEC-03's /instrument-monitor). Reads the workspace instrument registry and its
 * run queue; writes stay with the existing RPCs.
 */
export interface InstrumentRow {
  id: string
  displayId: string | null
  name: string
  instrumentType: string
  model: string | null
  serialNumber: string | null
  vendor: string | null
  location: string | null
  ownerId: string | null
  retiredAt: string | null
  connectionStatus: string
  lastConnectedAt: string | null
  position: number
  updatedAt: string
}

interface InstrumentWire {
  id: string
  display_id: string | null
  name: string
  instrument_type: string
  model: string | null
  serial_number: string | null
  vendor: string | null
  location: string | null
  owner_id: string | null
  retired_at: string | null
  connection_status: string
  last_connected_at: string | null
  position: number
  updated_at: string
}

export function instrumentConnection(status: string): {
  tone: Tone
  label: string
} {
  switch (status) {
    case 'connected':
      return { tone: 'ok', label: 'Connected' }
    case 'error':
      return { tone: 'bad', label: 'Error' }
    default:
      return { tone: 'stored', label: 'Disconnected' }
  }
}

export const instrumentQueryKeys = {
  list: ['ui-port', 'instruments', 'list'] as const,
  instrument: (id: string) =>
    ['ui-port', 'instruments', 'instrument', id] as const,
  runs: (id: string) => ['ui-port', 'instruments', 'runs', id] as const,
  calibrations: (id: string) =>
    ['ui-port', 'instruments', 'calibrations', id] as const,
}

const FIELDS =
  'id,display_id,name,instrument_type,model,serial_number,vendor,location,owner_id,retired_at,connection_status,last_connected_at,position,updated_at'

function toInstrument(row: InstrumentWire): InstrumentRow {
  return {
    id: row.id,
    displayId: row.display_id,
    name: row.name,
    instrumentType: row.instrument_type,
    model: row.model,
    serialNumber: row.serial_number,
    vendor: row.vendor,
    location: row.location,
    ownerId: row.owner_id,
    retiredAt: row.retired_at,
    connectionStatus: row.connection_status,
    lastConnectedAt: row.last_connected_at,
    position: row.position,
    updatedAt: row.updated_at,
  }
}

export function useInstruments(client: DataClient = notebookDataClient) {
  return useQuery({
    queryKey: instrumentQueryKeys.list,
    queryFn: () =>
      client
        .list<InstrumentWire>(
          'instruments',
          `?select=${FIELDS}&order=position.asc,name.asc`,
        )
        .then((rows) => rows.map(toInstrument)),
    staleTime: 15_000,
  })
}

export function useInstrument(
  instrumentId: string,
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: instrumentQueryKeys.instrument(instrumentId),
    queryFn: () =>
      client
        .list<InstrumentWire>(
          'instruments',
          `?select=${FIELDS}&id=eq.${encodeURIComponent(instrumentId)}`,
        )
        .then((rows) => (rows[0] ? toInstrument(rows[0]) : null)),
    staleTime: 15_000,
  })
}

export interface InstrumentRunRow {
  id: string
  name: string
  runIdentifier: string
  status: string
  progressPercent: number
  plateFormat: string
  startedAt: string | null
  completedAt: string | null
  operator: string | null
  errorMessage: string | null
}

interface RunWire {
  id: string
  name: string
  run_identifier: string
  status: string
  progress_percent: number
  plate_format: string
  started_at: string | null
  completed_at: string | null
  operator: string | null
  error_message: string | null
}

export function runStatus(status: string): { tone: Tone; label: string } {
  switch (status) {
    case 'running':
      return { tone: 'progress', label: 'Running' }
    case 'completed':
      return { tone: 'ok', label: 'Completed' }
    case 'failed':
      return { tone: 'bad', label: 'Failed' }
    case 'cancelled':
      return { tone: 'stored', label: 'Cancelled' }
    default:
      return { tone: 'draft', label: 'Queued' }
  }
}

export function useInstrumentRuns(
  instrumentId: string,
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: instrumentQueryKeys.runs(instrumentId),
    queryFn: () =>
      client
        .list<RunWire>(
          'instrument_runs',
          `?select=id,name,run_identifier,status,progress_percent,plate_format,started_at,completed_at,operator,error_message&instrument_id=eq.${encodeURIComponent(instrumentId)}&order=created_at.desc&limit=100`,
        )
        .then((rows) =>
          rows.map((r) => ({
            id: r.id,
            name: r.name,
            runIdentifier: r.run_identifier,
            status: r.status,
            progressPercent: r.progress_percent,
            plateFormat: r.plate_format,
            startedAt: r.started_at,
            completedAt: r.completed_at,
            operator: r.operator,
            errorMessage: r.error_message,
          })),
        ),
    staleTime: 15_000,
  })
}

// ---------------------------------------------------------------------------
// LAB-06 — calibration
// ---------------------------------------------------------------------------

export interface InstrumentCalibrationRow {
  id: string
  instrumentId: string
  performedAt: string
  dueAt: string
  certificateFileId: string | null
  performedByUserId: string | null
  notes: string | null
}

interface CalibrationWire {
  id: string
  instrument_id: string
  performed_at: string
  due_at: string
  certificate_file_id: string | null
  performed_by_user_id: string | null
  notes: string | null
}

const CALIBRATION_FIELDS =
  'id,instrument_id,performed_at,due_at,certificate_file_id,performed_by_user_id,notes'

function toCalibration(row: CalibrationWire): InstrumentCalibrationRow {
  return {
    id: row.id,
    instrumentId: row.instrument_id,
    performedAt: row.performed_at,
    dueAt: row.due_at,
    certificateFileId: row.certificate_file_id,
    performedByUserId: row.performed_by_user_id,
    notes: row.notes,
  }
}

/** Current standing of the latest calibration: overdue, due soon or valid. */
export function calibrationStatus(
  dueAt: string | null,
  now: Date = new Date(),
): { tone: Tone; label: string } {
  if (!dueAt) return { tone: 'none', label: 'Not calibrated' }
  const due = Date.parse(dueAt)
  if (Number.isNaN(due)) return { tone: 'none', label: 'Not calibrated' }
  if (due < now.getTime()) return { tone: 'bad', label: 'Overdue' }
  if (due - now.getTime() <= 30 * 86_400_000)
    return { tone: 'warn', label: 'Due soon' }
  return { tone: 'ok', label: 'Valid' }
}

export function useInstrumentCalibrations(
  instrumentId: string,
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: instrumentQueryKeys.calibrations(instrumentId),
    enabled: instrumentId.length > 0,
    queryFn: () =>
      client
        .list<CalibrationWire>(
          'instrument_calibrations',
          `?select=${CALIBRATION_FIELDS}&instrument_id=eq.${encodeURIComponent(instrumentId)}&order=performed_at.desc,id.desc&limit=50`,
        )
        .then((rows) => rows.map(toCalibration)),
    staleTime: 15_000,
  })
}

export async function recordInstrumentCalibration(
  input: {
    instrumentId: string
    performedAt: string
    dueAt: string
    certificateFileId?: string | null
    notes?: string | null
  },
  client: DataClient = notebookDataClient,
): Promise<InstrumentCalibrationRow> {
  const row = await client.rpc<CalibrationWire>(
    'record_instrument_calibration',
    {
      p_instrument_id: input.instrumentId,
      p_performed_at: input.performedAt,
      p_due_at: input.dueAt,
      p_certificate_file_id: input.certificateFileId ?? null,
      p_notes: input.notes ?? null,
    },
  )
  return toCalibration(row)
}

export interface NewInstrumentInput {
  workspaceId: string
  name: string
  instrumentType: string
  model?: string | null
  serialNumber?: string | null
  vendor?: string | null
  location?: string | null
  ownerId?: string | null
}

/** Register an instrument through the canonical RPC (writer-gated in SQL). */
export async function createInstrument(
  input: NewInstrumentInput,
  client: DataClient = notebookDataClient,
): Promise<InstrumentRow> {
  const row = await client.rpc<InstrumentWire>('create_instrument', {
    p_workspace_id: input.workspaceId,
    p_name: input.name,
    p_instrument_type: input.instrumentType,
    p_model: input.model ?? null,
    p_serial_number: input.serialNumber ?? null,
    p_vendor: input.vendor ?? null,
    p_location: input.location ?? null,
    p_owner_id: input.ownerId ?? null,
  })
  return toInstrument(row)
}

/** Retire or reinstate an instrument through the canonical RPC. */
export async function setInstrumentRetired(
  instrumentId: string,
  retired: boolean,
  client: DataClient = notebookDataClient,
): Promise<InstrumentRow> {
  const row = await client.rpc<InstrumentWire>('set_instrument_retired', {
    p_instrument_id: instrumentId,
    p_retired: retired,
  })
  return toInstrument(row)
}

/** Latest calibration per instrument, for the registry list's due column. */
export function useLatestCalibrationsByInstrument(
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: ['ui-port', 'instruments', 'calibrations', 'all'] as const,
    queryFn: () =>
      client
        .list<CalibrationWire>(
          'instrument_calibrations',
          `?select=${CALIBRATION_FIELDS}&order=due_at.desc,id.desc&limit=500`,
        )
        .then((rows) => {
          const latest = new Map<string, InstrumentCalibrationRow>()
          for (const row of rows.map(toCalibration)) {
            if (!latest.has(row.instrumentId)) latest.set(row.instrumentId, row)
          }
          return latest
        }),
    staleTime: 15_000,
  })
}
