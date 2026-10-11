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
  now: Date = new Date(),
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
}

const FIELDS =
  'id,display_id,name,instrument_type,model,serial_number,vendor,location,owner_id,retired_at,intake_method,position,updated_at'

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
}

interface ParserWire {
  id: string
  name: string
}

interface ParserVersionWire {
  parser_id: string
  status: string
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
      const ids = parsers.map((parser) => parser.id).join(',')
      const versions = await client.list<ParserVersionWire>(
        'parser_versions',
        `?select=parser_id,status&parser_id=in.(${ids})&status=in.(validated,approved)&limit=200`,
      )
      const validated = new Set(versions.map((version) => version.parser_id))
      return parsers.map((parser) => ({
        name: parser.name,
        validated: validated.has(parser.id),
      }))
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
 * The instrument's next booking. Bookings hang off a calendar resource whose metadata names the
 * instrument, so an instrument with no resource is not bookable — reported as such, not as free.
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
      const resources = await client.list<{ id: string }>(
        'calendar_resources',
        `?select=id&metadata->>instrumentId=eq.${encodeURIComponent(instrumentId)}&limit=50`,
      )
      if (!resources.length) return { bookable: false, next: null }
      const ids = resources.map((resource) => resource.id).join(',')
      const bookings = await client.list<{
        id: string
        title: string
        starts_at: string
      }>(
        'calendar_bookings',
        `?select=id,title,starts_at&resource_id=in.(${ids})&status=neq.cancelled&starts_at=gt.${encodeURIComponent(new Date().toISOString())}&order=starts_at.asc&limit=1`,
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
