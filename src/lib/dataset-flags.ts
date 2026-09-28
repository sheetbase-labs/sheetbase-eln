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

/** Wire shape of `api.dataset_value_flags` (snake_case via PostgREST). */
export interface DatasetValueFlagWire {
  id: string
  dataset_id: string
  row_id: string
  field_id: string
  kind: DatasetValueFlagKind
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
    `?dataset_id=eq.${encodeURIComponent(datasetId)}&cleared_at=is.null&select=id,dataset_id,row_id,field_id,kind,reason,comment,set_at,cleared_at`,
  )
  return rows.map((row) => toDatasetValueFlag(row))
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
