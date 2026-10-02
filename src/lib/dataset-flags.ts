/**
 * DSET-01.2 — excluding flagged values.
 *
 * A rejected/flagged value stays as recorded but is left out of analyses,
 * charts, criteria and pipeline inputs by default. This module reads the
 * dataset's active flags and gives consumers a small, tested predicate so each
 * surface excludes (and can report) the same values.
 */
import type { DataClient } from './data-client'
import { notebookDataClient } from './notebook-data'
import { CHART_ROW_ID_KEY } from './visualisation-pipeline'

export type DatasetValueFlagKind =
  'out_of_range' | 'missing_unit' | 'above_curve' | 'high_cv'

/**
 * DSET-01 step 1 — who owns a flag. `manual` is set by a person through
 * `flag_dataset_value`; `system` is derived from a Schema field rule during
 * validation. Validation only ever writes/clears its own `system` flags.
 */
export type DatasetValueFlagSource = 'manual' | 'system'

/** Wire shape of `api.dataset_value_flags` (snake_case via PostgREST). */
export interface DatasetValueFlagWire {
  id: string
  dataset_id: string
  row_id: string
  field_id: string
  kind: DatasetValueFlagKind
  source: DatasetValueFlagSource
  reason: string
  comment: string | null
  set_at: string
  cleared_at: string | null
}

export interface DatasetValueFlag {
  id: string
  datasetId: string
  rowId: string
  fieldId: string
  kind: DatasetValueFlagKind
  /**
   * Optional on the domain type so older in-memory fixtures stay valid; the
   * database and `DatasetValueFlagWire` always carry it.
   */
  source?: DatasetValueFlagSource
  reason: string
  comment: string | null
  setAt: string
}

export function toDatasetValueFlag(
  wire: DatasetValueFlagWire,
): DatasetValueFlag {
  return {
    id: wire.id,
    datasetId: wire.dataset_id,
    rowId: wire.row_id,
    fieldId: wire.field_id,
    kind: wire.kind,
    source: wire.source,
    reason: wire.reason,
    comment: wire.comment,
    setAt: wire.set_at,
  }
}

export const datasetFlagsQueryKeys = {
  active: (datasetId: string) =>
    ['dataset-value-flags', 'active', datasetId] as const,
}

export async function fetchActiveDatasetFlags(
  client: DataClient = notebookDataClient,
  datasetId: string,
): Promise<DatasetValueFlag[]> {
  const rows = await client.list<DatasetValueFlagWire>(
    'dataset_value_flags',
    `?dataset_id=eq.${encodeURIComponent(datasetId)}&cleared_at=is.null&select=id,dataset_id,row_id,field_id,kind,source,reason,comment,set_at,cleared_at`,
  )
  return rows.map((row) => toDatasetValueFlag(row))
}

// ---------------------------------------------------------------------------
// DSET-01.1 — manual flag set/clear
// ---------------------------------------------------------------------------

export interface FlagDatasetValueInput {
  datasetId: string
  rowId: string
  fieldId: string
  /** Defaults to `out_of_range`. */
  kind?: DatasetValueFlagKind
  reason: string
  comment?: string | null
}

/**
 * Set or update the active `manual` flag on a value. The value is never
 * edited; it stays as recorded and is excluded until the flag is cleared.
 * The RPC is writer-gated and requires a non-empty reason.
 */
export async function flagDatasetValue(
  client: DataClient = notebookDataClient,
  input: FlagDatasetValueInput,
): Promise<DatasetValueFlag> {
  const wire = await client.rpc<DatasetValueFlagWire>('flag_dataset_value', {
    p_dataset_id: input.datasetId,
    p_row_id: input.rowId,
    p_field_id: input.fieldId,
    p_kind: input.kind ?? 'out_of_range',
    p_reason: input.reason,
    p_comment: input.comment ?? null,
  })
  return toDatasetValueFlag(wire)
}

/**
 * Clear an active flag by id. Works for both `manual` and `system` flags so a
 * person can override a rule-derived flag; the RPC is writer-gated.
 */
export async function clearDatasetValueFlag(
  client: DataClient = notebookDataClient,
  flagId: string,
): Promise<DatasetValueFlag> {
  const wire = await client.rpc<DatasetValueFlagWire>(
    'clear_dataset_value_flag',
    { p_flag_id: flagId },
  )
  return toDatasetValueFlag(wire)
}

/** Stable key for a flagged value. */
export function flagKey(rowId: string, fieldId: string): string {
  return `${rowId}:${fieldId}`
}

/** Index of flagged values, for O(1) lookups while transforming rows. */
export function buildFlagIndex(
  flags: readonly DatasetValueFlag[],
): Map<string, DatasetValueFlag> {
  const index = new Map<string, DatasetValueFlag>()
  for (const flag of flags) index.set(flagKey(flag.rowId, flag.fieldId), flag)
  return index
}

export function isValueFlagged(
  index: ReadonlyMap<string, DatasetValueFlag>,
  rowId: string,
  fieldId: string,
): boolean {
  return index.has(flagKey(rowId, fieldId))
}

/**
 * Keep rows whose used fields are not flagged. Rows without a stable row id
 * are kept (they cannot be matched to a flag).
 */
export function filterRowsByFlags(
  rows: readonly Record<string, unknown>[],
  flags: readonly DatasetValueFlag[],
  fieldIds: readonly string[],
): Record<string, unknown>[] {
  if (flags.length === 0 || fieldIds.length === 0) return [...rows]
  const index = buildFlagIndex(flags)
  return rows.filter((row) => {
    const rowId = row[CHART_ROW_ID_KEY]
    if (typeof rowId !== 'string') return true
    return !fieldIds.some((fieldId) => isValueFlagged(index, rowId, fieldId))
  })
}

export interface ExcludedValue {
  rowId: string
  fieldId: string
  flag: DatasetValueFlag
}

export interface ExclusionSummary {
  /** Distinct flagged values dropped. */
  valueCount: number
  /** Distinct rows with at least one dropped value. */
  rowCount: number
  /** Flag kinds present, codepoint-sorted and unique. */
  kinds: DatasetValueFlagKind[]
}

/**
 * DSET-01.2 — count what exclusion dropped so a surface can report "3 values
 * on 2 rows excluded" instead of silently shrinking its input set.
 */
export function summariseExcludedValues(
  excluded: readonly ExcludedValue[],
): ExclusionSummary {
  const values = new Set<string>()
  const rows = new Set<string>()
  const kinds = new Set<DatasetValueFlagKind>()
  for (const item of excluded) {
    values.add(flagKey(item.rowId, item.fieldId))
    rows.add(item.rowId)
    kinds.add(item.flag.kind)
  }
  return {
    valueCount: values.size,
    rowCount: rows.size,
    kinds: Array.from(kinds).sort(),
  }
}

/**
 * Drops rows whose identifying value is flagged, reporting which values were
 * excluded so a surface can say how many were left out.
 */
export function excludeFlaggedValues<T>(
  rows: readonly T[],
  index: ReadonlyMap<string, DatasetValueFlag>,
  rowIdOf: (row: T) => string,
  fieldId: string,
): { rows: T[]; excluded: ExcludedValue[] } {
  const kept: T[] = []
  const excluded: ExcludedValue[] = []
  for (const row of rows) {
    const rowId = rowIdOf(row)
    const flag = index.get(flagKey(rowId, fieldId))
    if (flag) excluded.push({ rowId, fieldId, flag })
    else kept.push(row)
  }
  return { rows: kept, excluded }
}

// ---------------------------------------------------------------------------
// DSET-01.4 — request repeat
// ---------------------------------------------------------------------------

export interface RequestRepeatInput {
  /** Source sample record the dilution is derived from. */
  sourceRecordId: string
  /** Dataset the planned repeat rows are added to. */
  datasetId: string
  scheduledAt?: string | null
  /** How many planned rows to create (1–96). */
  plannedRowCount?: number
  /** Optional coordinates of the flagged measurement being repeated. */
  sourceRowId?: string | null
  sourceFieldId?: string | null
  title?: string | null
  /** Derived-sample properties (quantity, quantityUnit, storageLocation, …). */
  properties?: Record<string, unknown>
}

export interface RequestRepeatResult {
  sample: Record<string, unknown>
  plannedRowIds: string[]
  idempotent: boolean
}

/**
 * DSET-01.4 — atomically derive a dilution sample (LAB-01) and plan the
 * Dataset rows that will hold the repeat measurement, linked to the source
 * sample. The RPC is writer-gated and rejects a duplicate request for the same
 * measurement and schedule.
 */
export async function requestRepeat(
  client: DataClient = notebookDataClient,
  input: RequestRepeatInput,
): Promise<RequestRepeatResult> {
  return client.rpc<RequestRepeatResult>('request_repeat', {
    p_source_record_id: input.sourceRecordId,
    p_dataset_id: input.datasetId,
    p_scheduled_at: input.scheduledAt ?? null,
    p_planned_row_count: input.plannedRowCount ?? 1,
    p_source_row_id: input.sourceRowId ?? null,
    p_source_field_id: input.sourceFieldId ?? null,
    p_title: input.title ?? null,
    p_properties: input.properties ?? {},
  })
}
