/**
 * Every result on a record: the dataset rows whose link column holds the
 * record, read through `api.record_results` and grouped by the measurement
 * table they follow. Shared by the record pages, the assistant and the tests.
 */
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'

import type { DataClient } from './data-client'
import { notebookDataClient } from './notebook-data'

const resultValueSchema = z.object({
  fieldId: z.string(),
  key: z.string(),
  label: z.string(),
  type: z.string(),
  unit: z.string().nullable(),
  /** True for the link column that holds the record being read. */
  linksHere: z.boolean(),
  value: z.unknown(),
})

const resultRowSchema = z.object({
  rowId: z.string(),
  datasetId: z.string(),
  datasetDisplayId: z.string().nullable(),
  datasetName: z.string(),
  tableId: z.string(),
  tableKey: z.string(),
  tableName: z.string(),
  tableVersion: z.number(),
  source: z.enum(['live', 'snapshot']),
  snapshotId: z.string().nullable(),
  snapshotLabel: z.string().nullable(),
  status: z.string(),
  recordedAt: z.string().nullable(),
  values: z.array(resultValueSchema),
})

const recordResultsSchema = z.object({
  total: z.number(),
  rows: z.array(resultRowSchema),
})

export type RecordResultValue = z.infer<typeof resultValueSchema>

export type RecordResultRow = z.infer<typeof resultRowSchema>

export type RecordResults = z.infer<typeof recordResultsSchema>

/** Rows the page asks for at once; the answer says how many more there are. */
export const RECORD_RESULTS_PAGE = 500

export const recordResultsQueryKey = (
  recordId: string,
  includeSnapshots: boolean,
) => ['record-results', recordId, includeSnapshots] as const

export async function fetchRecordResults(
  client: DataClient,
  recordId: string,
  includeSnapshots = false,
): Promise<RecordResults> {
  const raw = await client.rpc<unknown>('record_results', {
    p_record_id: recordId,
    p_include_snapshots: includeSnapshots,
    p_limit: RECORD_RESULTS_PAGE,
    p_offset: 0,
  })

  return recordResultsSchema.parse(raw)
}

/** The record's results, for a page that shows them or only counts them. */
export function useRecordResults(
  recordId: string | undefined,
  includeSnapshots = false,
) {
  return useQuery({
    queryKey: recordResultsQueryKey(recordId ?? '', includeSnapshots),
    queryFn: () =>
      fetchRecordResults(notebookDataClient, recordId ?? '', includeSnapshots),
    enabled: Boolean(recordId),
  })
}

export interface RecordResultGroup {
  tableId: string
  tableName: string
  rows: RecordResultRow[]
}

/** The rows by measurement table, the table with the newest result first. */
export function groupRecordResults(
  rows: readonly RecordResultRow[],
): RecordResultGroup[] {
  const groups = new Map<string, RecordResultGroup>()

  for (const row of rows) {
    const group = groups.get(row.tableId) ?? {
      tableId: row.tableId,
      tableName: row.tableName,
      rows: [],
    }

    group.rows.push(row)
    groups.set(row.tableId, group)
  }

  return [...groups.values()]
}

/** The columns of a group: every field the rows carry, in the table's order. */
export function groupColumns(group: RecordResultGroup): RecordResultValue[] {
  const columns = new Map<string, RecordResultValue>()

  for (const row of group.rows)
    for (const value of row.values)
      if (!columns.has(value.key)) columns.set(value.key, value)

  return [...columns.values()]
}

/** What the assistant is shown: the groups with a short line per row. */
export function recordResultsSummary(results: RecordResults) {
  return {
    total: results.total,
    returned: results.rows.length,
    tables: groupRecordResults(results.rows).map((group) => ({
      table: group.tableName,
      rows: group.rows.map((row) => ({
        dataset: row.datasetDisplayId ?? row.datasetName,
        source:
          row.source === 'snapshot'
            ? `snapshot ${row.snapshotLabel ?? ''}`.trim()
            : 'live',
        recordedAt: row.recordedAt,
        values: Object.fromEntries(
          row.values
            .filter((value) => !value.linksHere)
            .map((value) => [
              value.label,
              value.unit ? `${String(value.value)} ${value.unit}` : value.value,
            ]),
        ),
      })),
    })),
  }
}
