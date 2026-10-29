import { daysUntilDate } from '#/lib/calendar-days'
import { useQuery } from '@tanstack/react-query'

import type { Tone } from '#/components/v3/ui/status'
import type { DataClient } from '#/lib/data-client'
import { notebookDataClient } from '#/lib/notebook-data'
import { listByIds } from '#/lib/chunk-ids'
import { now as appNow } from '#/lib/clock'

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
  qualifiedFor?: string | null
  createdAt?: string | null
  createdByUserId?: string | null
  /** R5-CONFIG-02 — how this instrument's data arrives. */
  intakeMethod: string
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
  qualified_for?: string | null
  created_at?: string | null
  created_by_user_id?: string | null
  intake_method: string
  position: number
  updated_at: string
}

// ---------------------------------------------------------------------------
// R5-CONFIG-02 — how an instrument's data gets in.
//
// The method is instrument configuration, not an integration: it says who writes the data and
// therefore what its provenance is. `filedrop` and `webhook` data can only arrive through a
// parser the workspace validated, so while none is attached the honest state is "parser not
// validated" and nothing has been imported; `manual` names the person entering the reading;
// `none` is registration for booking and citing only.
// ---------------------------------------------------------------------------

export type IntakeMethod = 'filedrop' | 'webhook' | 'manual' | 'none'

export const INTAKE_METHODS: readonly {
  value: IntakeMethod
  title: string
  consequence: string
  needsParser: boolean
}[] = [
  {
    value: 'filedrop',
    title: 'File drop',
    consequence:
      'The instrument or its PC saves exports to a watched folder. Needs a validated parser.',
    needsParser: true,
  },
  {
    value: 'webhook',
    title: 'Webhook',
    consequence:
      'The instrument’s software posts results to Sheetbase. Needs a validated parser.',
    needsParser: true,
  },
  {
    value: 'manual',
    title: 'Manual entry',
    consequence:
      'People type readings in. Whoever enters a reading is its provenance.',
    needsParser: false,
  },
  {
    value: 'none',
    title: 'Not connected yet',
    consequence: 'Registered for booking and citing only. No data arrives.',
    needsParser: false,
  },
]

/** The label for a stored method; an unknown value reads as "Not connected". */
export function intakeMethodLabel(method: string): string {
  return (
    INTAKE_METHODS.find((m) => m.value === method)?.title ?? 'Not connected'
  )
}

export function intakeMethodNeedsParser(method: string): boolean {
  return INTAKE_METHODS.find((m) => m.value === method)?.needsParser ?? false
}

/** How long since the last committed import before an automated method reads stale. */
const INTAKE_STALE_DAYS = 30

export interface InstrumentIntakeEvidence {
  /** Whether a parser with a validated or approved version is attached. */
  parserReady?: boolean
  /** The instrument's most recent import, whatever its status. */
  lastImport?: { status: string; createdAt: string } | null
}

/**
 * Per-method health. A method with no ingestion (manual, none) reports what it is rather than a
 * heartbeat, and an automated method never reports healthy without a committed import to prove it.
 */
export function intakeHealth(
  method: string,
  evidence: InstrumentIntakeEvidence = {},
  now: Date = appNow(),
): { tone: Tone; label: string } {
  if (method === 'manual') return { tone: 'none', label: 'Manual entry' }
  if (method === 'none' || !intakeMethodNeedsParser(method))
    return { tone: 'none', label: 'Not connected' }
  if (evidence.parserReady === false)
    return { tone: 'warn', label: 'Parser not validated' }
  const last = evidence.lastImport
  if (!last) return { tone: 'draft', label: 'Waiting for first data' }
  if (last.status === 'failed')
    return { tone: 'bad', label: 'Last import failed' }
  if (last.status !== 'committed')
    return { tone: 'draft', label: 'Waiting for first data' }
  const ageDays = (now.getTime() - Date.parse(last.createdAt)) / 86_400_000
  if (!Number.isFinite(ageDays) || ageDays <= INTAKE_STALE_DAYS)
    return { tone: 'ok', label: 'Healthy' }
  return { tone: 'warn', label: `No data for ${Math.floor(ageDays)} days` }
}

/**
 * A calibration or qualification day, in the lab surfaces' shared style
 * ("9 Apr 2027", never "09 Apr 2027" or "Sept"). Both are recorded as UTC days
 * (`…T00:00:00.000Z`), so the parts are read in UTC: rendering them in the
 * reader's zone shows the day before to anyone west of Greenwich.
 */
export function formatInstrumentDay(iso: string | null | undefined): string {
  if (!iso) return '—'
  const parsed = Date.parse(iso)
  if (Number.isNaN(parsed)) return '—'
  const date = new Date(parsed)
  // `en-GB` gives the four-letter "Sept"; the design uses three-letter months.
  const month = date
    .toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })
    .slice(0, 3)
  return `${date.getUTCDate()} ${month} ${date.getUTCFullYear()}`
}

export const instrumentQueryKeys = {
  list: ['ui-port', 'instruments', 'list'] as const,
  instrument: (id: string) =>
    ['ui-port', 'instruments', 'instrument', id] as const,
  runs: (id: string) => ['ui-port', 'instruments', 'runs', id] as const,
  calibrations: (id: string) =>
    ['ui-port', 'instruments', 'calibrations', id] as const,
  lastImport: (id: string) =>
    ['ui-port', 'instruments', 'last-import', id] as const,
  parsers: (id: string) => ['ui-port', 'instruments', 'parsers', id] as const,
  nextBooking: (id: string) =>
    ['ui-port', 'instruments', 'next-booking', id] as const,
  history: (id: string) => ['ui-port', 'instruments', 'history', id] as const,
  usedBy: (id: string) => ['ui-port', 'instruments', 'used-by', id] as const,
  week: (id: string) => ['ui-port', 'instruments', 'week', id] as const,
}

const FIELDS =
  'id,display_id,name,instrument_type,model,serial_number,vendor,location,owner_id,retired_at,qualified_for,created_at,created_by_user_id,intake_method,position,updated_at'

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
    qualifiedFor: row.qualified_for ?? null,
    createdAt: row.created_at ?? null,
    createdByUserId: row.created_by_user_id ?? null,
    intakeMethod: row.intake_method,
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

export interface InstrumentLastImport {
  status: string
  createdAt: string
}

interface ImportWire {
  instrument_id: string | null
  status: string
  created_at: string
}

const IMPORT_FIELDS = 'instrument_id,status,created_at'

/** The instrument's most recent import, whatever its status. */
export function useInstrumentLastImport(
  instrumentId: string,
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: instrumentQueryKeys.lastImport(instrumentId),
    enabled: instrumentId.length > 0,
    queryFn: () =>
      client
        .list<ImportWire>(
          'dataset_imports',
          `?select=${IMPORT_FIELDS}&instrument_id=eq.${encodeURIComponent(instrumentId)}&order=created_at.desc,id.desc&limit=1`,
        )
        .then((rows) =>
          rows[0]
            ? { status: rows[0].status, createdAt: rows[0].created_at }
            : null,
        ),
    staleTime: 15_000,
  })
}

/** The latest import per instrument, for the registry list's health column. */
export function useLastImportsByInstrument(
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: ['ui-port', 'instruments', 'last-import', 'all'] as const,
    queryFn: () =>
      client
        .list<ImportWire>(
          'dataset_imports',
          `?select=${IMPORT_FIELDS}&instrument_id=not.is.null&order=created_at.desc,id.desc&limit=500`,
        )
        .then((rows) => {
          const latest = new Map<string, InstrumentLastImport>()
          for (const row of rows) {
            if (!row.instrument_id || latest.has(row.instrument_id)) continue
            latest.set(row.instrument_id, {
              status: row.status,
              createdAt: row.created_at,
            })
          }
          return latest
        }),
    staleTime: 15_000,
  })
}

export interface InstrumentParserRow {
  name: string
  /** A validated or approved version exists, so the parser may import GxP data. */
  validated: boolean
  /** The newest draft version, which still has to be tested against a file. */
  draftVersionId?: string
}

export type ParserFollowUpKind = 'missing' | 'draft'

export interface ParserFollowUp {
  kind: ParserFollowUpKind
  /** Search for `/settings/instruments`, so the next step opens with its context. */
  search: { instrumentId: string; versionId?: string }
}

/**
 * What stands between an automated instrument and importing data: no parser at all, or a
 * draft nobody has tested yet. `null` when a parser may already import or the method
 * needs none. The caller says whether the parsers have loaded, so a pending query never
 * reads as "no parser".
 */
export function parserFollowUp(
  instrumentId: string,
  method: string,
  parsers: readonly InstrumentParserRow[] | undefined,
): ParserFollowUp | null {
  if (!intakeMethodNeedsParser(method) || !parsers) return null
  if (parsers.some((parser) => parser.validated)) return null
  const draft = parsers.find((parser) => parser.draftVersionId)
  return draft
    ? {
        kind: 'draft',
        search: { instrumentId, versionId: draft.draftVersionId },
      }
    : { kind: 'missing', search: { instrumentId } }
}

interface ParserWire {
  id: string
  name: string
}

interface ParserVersionIdWire extends ParserVersionWire {
  id: string
}

interface InstrumentParserWire {
  id: string
  instrument_id: string
}

interface ParserVersionWire {
  parser_id: string
  status: string
}

/**
 * Which instruments have a parser that may import, accumulated from every attached
 * parser. This is the same evidence the inspector derives for one instrument, so the
 * registry list's health column can report the same state without a query per row.
 */
export function parserReadinessByInstrument(
  parsers: Array<{ id: string; instrumentId: string }>,
  validatedParserIds: ReadonlySet<string>,
): Map<string, boolean> {
  const ready = new Map<string, boolean>()
  for (const parser of parsers) {
    ready.set(
      parser.instrumentId,
      (ready.get(parser.instrumentId) ?? false) ||
        validatedParserIds.has(parser.id),
    )
  }
  return ready
}

/** Parser readiness for every instrument, for the registry list's health column. */
export function useParserReadinessByInstrument(
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: ['ui-port', 'instruments', 'parsers', 'all'] as const,
    queryFn: async (): Promise<Map<string, boolean>> => {
      const parsers = await client.list<InstrumentParserWire>(
        'parsers',
        '?select=id,instrument_id&instrument_id=not.is.null&limit=500',
      )
      if (!parsers.length) return new Map()
      const versions = await listByIds(
        parsers.map((parser) => parser.id),
        (ids) =>
          client.list<ParserVersionWire>(
            'parser_versions',
            `?select=parser_id,status&parser_id=in.(${ids})&status=in.(validated,approved)&limit=500`,
          ),
      )
      return parserReadinessByInstrument(
        parsers.map((parser) => ({
          id: parser.id,
          instrumentId: parser.instrument_id,
        })),
        new Set(versions.map((version) => version.parser_id)),
      )
    },
    staleTime: 15_000,
  })
}

/** The parsers attached to the instrument, with whether any version is validated. */
export function useInstrumentParsers(
  instrumentId: string,
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: instrumentQueryKeys.parsers(instrumentId),
    enabled: instrumentId.length > 0,
    queryFn: async (): Promise<InstrumentParserRow[]> => {
      const parsers = await client.list<ParserWire>(
        'parsers',
        `?select=id,name&instrument_id=eq.${encodeURIComponent(instrumentId)}&order=name.asc&limit=50`,
      )
      if (!parsers.length) return []
      const versions = await listByIds(
        parsers.map((parser) => parser.id),
        (ids) =>
          client.list<ParserVersionIdWire>(
            'parser_versions',
            `?select=id,parser_id,status&parser_id=in.(${ids})&status=in.(draft,validated,approved)&order=version.desc&limit=200`,
          ),
      )
      return parsers.map((parser) => {
        const own = versions.filter(
          (version) => version.parser_id === parser.id,
        )
        return {
          name: parser.name,
          validated: own.some((version) => version.status !== 'draft'),
          draftVersionId: own.find((version) => version.status === 'draft')?.id,
        }
      })
    },
    staleTime: 15_000,
  })
}

export interface InstrumentNextBooking {
  id: string
  title: string
  startsAt: string
}

/**
 * The instrument's next booking. ADR-0054: a booking for an instrument is
 * stored with `resource_id` = the instrument id (the instrument's calendar
 * resource is derived from it), so this is a plain join on the booking and the
 * registry decides bookability — a retired instrument keeps its history but
 * takes no new booking.
 */
export function useInstrumentNextBooking(
  instrumentId: string,
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: instrumentQueryKeys.nextBooking(instrumentId),
    enabled: instrumentId.length > 0,
    queryFn: async (): Promise<{
      bookable: boolean
      next: InstrumentNextBooking | null
    }> => {
      const instrument = await client.list<{
        id: string
        retired_at: string | null
      }>(
        'instruments',
        `?select=id,retired_at&id=eq.${encodeURIComponent(instrumentId)}&limit=1`,
      )
      if (!instrument.length || instrument[0].retired_at !== null)
        return { bookable: false, next: null }
      const bookings = await client.list<{
        id: string
        title: string
        starts_at: string
      }>(
        'calendar_bookings',
        `?select=id,title,starts_at&resource_id=eq.${encodeURIComponent(instrumentId)}&status=neq.cancelled&starts_at=gt.${encodeURIComponent(appNow().toISOString())}&order=starts_at.asc&limit=1`,
      )
      return {
        bookable: true,
        next: bookings[0]
          ? {
              id: bookings[0].id,
              title: bookings[0].title,
              startsAt: bookings[0].starts_at,
            }
          : null,
      }
    },
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
  /** Samples the run measured. */
  sampleCount: number
  /** The experiment the run's samples belong to, when it was linked to one. */
  experiment: { id: string; identifier: string } | null
  /** The dataset the run's file became, when the file was read. */
  dataset: { id: string; displayId: string | null; name: string } | null
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

interface RunLinkWire {
  run_id: string
  link_type: string
  linked_record_id: string | null
  linked_record_identifier: string | null
}

interface RunImportWire {
  dataset_id: string
  source_provenance: { instrumentRunId?: string } | null
}

interface RunDatasetWire {
  id: string
  display_id: string | null
  name: string
}

/** What each run produced and measured: its samples, experiment and dataset. */
async function runOutcomes(
  client: DataClient,
  instrumentId: string,
  runIds: string[],
) {
  const outcomes = new Map<
    string,
    Pick<InstrumentRunRow, 'sampleCount' | 'experiment' | 'dataset'>
  >()
  for (const id of runIds)
    outcomes.set(id, { sampleCount: 0, experiment: null, dataset: null })
  if (runIds.length === 0) return outcomes
  const ids = runIds.map(encodeURIComponent).join(',')
  const [links, imports] = await Promise.all([
    client
      .list<RunLinkWire>(
        'instrument_run_links',
        `?run_id=in.(${ids})&link_type=in.(sample,experiment)&select=run_id,link_type,linked_record_id,linked_record_identifier`,
      )
      .catch(() => [] as RunLinkWire[]),
    client
      .list<RunImportWire>(
        'dataset_imports',
        `?instrument_id=eq.${encodeURIComponent(instrumentId)}&select=dataset_id,source_provenance&order=created_at.desc&limit=500`,
      )
      .catch(() => [] as RunImportWire[]),
  ])
  for (const link of links) {
    const outcome = outcomes.get(link.run_id)
    if (!outcome) continue
    if (link.link_type === 'sample') outcome.sampleCount += 1
    else if (link.linked_record_id && link.linked_record_identifier)
      outcome.experiment = {
        id: link.linked_record_id,
        identifier: link.linked_record_identifier,
      }
  }
  const datasetByRun = new Map<string, string>()
  for (const row of imports) {
    const runId = row.source_provenance?.instrumentRunId
    if (runId && outcomes.has(runId) && !datasetByRun.has(runId))
      datasetByRun.set(runId, row.dataset_id)
  }
  const datasetIds = [...new Set(datasetByRun.values())]
  if (datasetIds.length > 0) {
    const datasets = await client
      .list<RunDatasetWire>(
        'datasets',
        `?id=in.(${datasetIds.map(encodeURIComponent).join(',')})&select=id,display_id,name`,
      )
      .catch(() => [] as RunDatasetWire[])
    const byId = new Map(datasets.map((d) => [d.id, d]))
    for (const [runId, datasetId] of datasetByRun) {
      const dataset = byId.get(datasetId)
      if (dataset)
        outcomes.get(runId)!.dataset = {
          id: dataset.id,
          displayId: dataset.display_id,
          name: dataset.name,
        }
    }
  }
  return outcomes
}

export function useInstrumentRuns(
  instrumentId: string,
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: instrumentQueryKeys.runs(instrumentId),
    queryFn: async (): Promise<InstrumentRunRow[]> => {
      const rows = await client.list<RunWire>(
        'instrument_runs',
        `?select=id,name,run_identifier,status,progress_percent,plate_format,started_at,completed_at,operator,error_message&instrument_id=eq.${encodeURIComponent(instrumentId)}&order=created_at.desc&limit=100`,
      )
      const outcomes = await runOutcomes(
        client,
        instrumentId,
        rows.map((r) => r.id),
      )
      return rows.map((r) => ({
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
        ...outcomes.get(r.id)!,
      }))
    },
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

/**
 * How far ahead a calibration counts as due soon. One window for every surface —
 * the record page, the registry list's due column, its filter and ITS tab — so an
 * instrument is never "due" on one screen and "valid" on another.
 */
export const CALIBRATION_DUE_SOON_DAYS = 30

/** Current standing of the latest calibration: overdue, due soon or valid. */
export function calibrationStatus(
  dueAt: string | null,
  now: Date = appNow(),
): { tone: Tone; label: string } {
  if (!dueAt) return { tone: 'none', label: 'Not calibrated' }
  if (Number.isNaN(Date.parse(dueAt)))
    return { tone: 'none', label: 'Not calibrated' }
  const days = daysUntilDate(dueAt, now) ?? 0
  if (days < 0) return { tone: 'bad', label: 'Overdue' }
  if (days <= CALIBRATION_DUE_SOON_DAYS)
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
  /** R5-CONFIG-02 — how the instrument's data will arrive. */
  intakeMethod: IntakeMethod
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
    p_intake_method: input.intakeMethod,
    p_model: input.model ?? null,
    p_serial_number: input.serialNumber ?? null,
    p_vendor: input.vendor ?? null,
    p_location: input.location ?? null,
    p_owner_id: input.ownerId ?? null,
  })
  return toInstrument(row)
}

/**
 * Declare how the instrument's data now arrives. Configuration for future data: imports already
 * committed keep the parser and source provenance they arrived with, so this rewrites no history.
 */
export async function setInstrumentIntakeMethod(
  instrumentId: string,
  intakeMethod: IntakeMethod,
  client: DataClient = notebookDataClient,
): Promise<InstrumentRow> {
  const row = await client.rpc<InstrumentWire>('set_instrument_intake_method', {
    p_instrument_id: instrumentId,
    p_intake_method: intakeMethod,
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

/**
 * The calibration that states an instrument's standing: the one performed most
 * recently, not the one with the furthest due date. A recalibration with a nearer
 * due date must not be masked by an older certificate that expires later.
 */
export function latestCalibrationByInstrument(
  rows: InstrumentCalibrationRow[],
): Map<string, InstrumentCalibrationRow> {
  const latest = new Map<string, InstrumentCalibrationRow>()
  for (const row of rows) {
    const current = latest.get(row.instrumentId)
    if (
      !current ||
      row.performedAt > current.performedAt ||
      (row.performedAt === current.performedAt && row.id > current.id)
    ) {
      latest.set(row.instrumentId, row)
    }
  }
  return latest
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
          `?select=${CALIBRATION_FIELDS}&order=performed_at.desc,id.desc&limit=500`,
        )
        .then((rows) => latestCalibrationByInstrument(rows.map(toCalibration))),
    staleTime: 15_000,
  })
}

/** One change to what an instrument is called, where it sits or what it is qualified for. */
export interface InstrumentChange {
  id: string
  at: string
  actorUserId: string | null
  /** "Created from the registry" for the first entry, else the changed fields. */
  changes: { label: string; from: string | null; to: string | null }[]
}

interface ChangeEventWire {
  id: string
  operation: string
  actor_user_id: string | null
  created_at: string
  payload: {
    changes?: Record<
      string,
      { label?: string; from?: string | null; to?: string | null }
    >
  }
}

/** The identity history the instrument trigger records, newest first. */
export function useInstrumentHistory(
  instrumentId: string,
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: instrumentQueryKeys.history(instrumentId),
    enabled: instrumentId.length > 0,
    queryFn: () =>
      client
        .list<ChangeEventWire>(
          'change_events',
          `?select=id,operation,actor_user_id,created_at,payload&entity_type=eq.instrument&entity_uuid=eq.${encodeURIComponent(instrumentId)}&operation=in.(create,update)&order=created_at.desc,sequence.desc&limit=50`,
        )
        .then((rows): InstrumentChange[] =>
          rows.map((row) => ({
            id: row.id,
            at: row.created_at,
            actorUserId: row.actor_user_id,
            changes: Object.values(row.payload.changes ?? {}).map((c) => ({
              label: c.label ?? 'Changed',
              from: c.from ?? null,
              to: c.to ?? null,
            })),
          })),
        ),
    staleTime: 15_000,
  })
}

export interface InstrumentUsedBy {
  key: string
  kind: 'dataset' | 'parser'
  label: string
  how: string
  since: string | null
  link: { to: '/datasets/$datasetId'; id: string } | null
}

/** What leans on the instrument: datasets imported from it and the parsers for its exports. */
export function useInstrumentUsedBy(
  instrumentId: string,
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: instrumentQueryKeys.usedBy(instrumentId),
    enabled: instrumentId.length > 0,
    queryFn: async (): Promise<InstrumentUsedBy[]> => {
      const id = encodeURIComponent(instrumentId)
      const [imports, parsers] = await Promise.all([
        client.list<{ dataset_id: string | null; created_at: string }>(
          'dataset_imports',
          `?select=dataset_id,created_at&instrument_id=eq.${id}&dataset_id=not.is.null&order=created_at.asc&limit=500`,
        ),
        client.list<{ id: string; name: string; created_at: string }>(
          'parsers',
          `?select=id,name,created_at&instrument_id=eq.${id}&order=name.asc&limit=50`,
        ),
      ])
      const firstImport = new Map<string, string>()
      const counts = new Map<string, number>()
      for (const row of imports) {
        if (!row.dataset_id) continue
        counts.set(row.dataset_id, (counts.get(row.dataset_id) ?? 0) + 1)
        if (!firstImport.has(row.dataset_id))
          firstImport.set(row.dataset_id, row.created_at)
      }
      const datasets = counts.size
        ? await listByIds([...counts.keys()], (ids) =>
            client.list<{
              id: string
              name: string
              display_id: string | null
            }>('datasets', `?select=id,name,display_id&id=in.(${ids})`),
          )
        : []
      return [
        ...datasets.map((d): InstrumentUsedBy => ({
          key: d.id,
          kind: 'dataset',
          label: `${d.display_id ?? ''} ${d.name}`.trim(),
          how: `${counts.get(d.id) ?? 0} import${counts.get(d.id) === 1 ? '' : 's'}`,
          since: firstImport.get(d.id) ?? null,
          link: { to: '/datasets/$datasetId', id: d.id },
        })),
        ...parsers.map((p): InstrumentUsedBy => ({
          key: p.id,
          kind: 'parser',
          label: p.name,
          how: 'Parses its exports',
          since: p.created_at,
          link: null,
        })),
      ]
    },
    staleTime: 15_000,
  })
}

/** Bookings on the instrument in the next seven days, soonest first. */
export function useInstrumentWeek(
  instrumentId: string,
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: instrumentQueryKeys.week(instrumentId),
    enabled: instrumentId.length > 0,
    queryFn: () => {
      const now = appNow()
      const until = new Date(now.getTime() + 7 * 86_400_000)
      return client.list<{
        id: string
        title: string
        starts_at: string
        created_by_user_id: string | null
      }>(
        'calendar_bookings',
        `?select=id,title,starts_at,created_by_user_id&resource_id=eq.${encodeURIComponent(instrumentId)}&status=neq.cancelled&starts_at=gte.${encodeURIComponent(now.toISOString())}&starts_at=lt.${encodeURIComponent(until.toISOString())}&order=starts_at.asc&limit=20`,
      )
    },
    staleTime: 15_000,
  })
}
