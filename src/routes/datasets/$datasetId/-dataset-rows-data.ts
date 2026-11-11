/**
 * The dataset Rows screen's reads, and the values it derives from them.
 *
 * The screen itself decides what it shows; this module owns which snapshot is
 * being read, the paged row window, the schema fields and the flags, so the
 * route file stays a description of the screen rather than of its transport.
 */
import type { QueryClient } from '@tanstack/react-query'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { z } from 'zod'

import type { RepeatSourceSample } from '#/components/datasets/value-actions'
import type { DatasetValueFlag } from '#/lib/dataset-flags'
import { buildFlagIndex, fetchActiveDatasetFlags } from '#/lib/dataset-flags'
import type { DatasetRowValues } from '#/lib/dataset-product'
import { datasetListQueryKeys } from '#/components/datasets/datasets-data'
import { notebookDataClient } from '#/lib/notebook-data'
import { useDatasetVersions } from '../$datasetId'
import type { DatasetVersion } from '../$datasetId'

/** A URL flag the grid reads: `?flagged` or `?flagged=true` means on. */
const searchFlagSchema = z
  .union([z.literal(true), z.literal('true')])
  .transform((): true => true)
  .optional()
  .catch(undefined)

/** The grid's URL search, decoded once: anything else reads as absent. */
export const rowsSearchSchema = z.object({
  q: z.string().optional().catch(undefined),
  flagged: searchFlagSchema,
  row: z.string().optional().catch(undefined),
  field: z.string().optional().catch(undefined),
  col: z.string().optional().catch(undefined),
  snapshot: z.string().optional().catch(undefined),
  live: searchFlagSchema,
})

export type RowsSearch = z.output<typeof rowsSearchSchema>

/** The rows of one dataset snapshot, as `query_dataset_version_rows` returns them. */
export interface RowValuePayload {
  datasetVersionId: string
  datasetId: string
  schemaVersionId: string
  totalCount: number
  offset: number
  limit: number
  rows: { rowId: string; revision: number; values: DatasetRowValues }[]
}

/** A row of the snapshot grid: the loader's own row shape. */
export type RowGridRow = RowValuePayload['rows'][number]

/** A schema field of the snapshot's version, as the fields table returns it. */
export interface FieldWire {
  field_id: string
  key: string
  label: string
  logical_type: string
  display_order: number
}

/** DSET-03.3 — rows page size. The server supports p_limit/p_offset, so the
 * grid asks for one window at a time and extends it through the visible
 * "Load more" control instead of stopping at a fixed first page. */
const ROWS_PAGE_SIZE = 100

/** What the screen reads and derives: one snapshot, its rows, fields and flags. */
export function useDatasetRowsData(input: {
  datasetId: string
  search: RowsSearch
  /** A value link reads one row live rather than a frozen snapshot. */
  liveValue: boolean
  queryClient: QueryClient
}) {
  const { datasetId, search, liveValue, queryClient } = input

  const versions = useDatasetVersions(datasetId)

  // A snapshot is named by its id or by its label (S-14), so a pane can be
  // pointed at the newer one by the label it shows.
  const version = snapshotVersion(versions.data, search.snapshot)

  const valueContext = useQuery({
    queryKey: ['ui-port', 'dataset-value', datasetId, search.row],
    queryFn: () =>
      notebookDataClient.rpc<Omit<RowValuePayload, 'datasetVersionId'> | null>(
        'dataset_value_context',
        { p_dataset_id: datasetId, p_row_id: search.row },
      ),
    enabled: liveValue,
  })

  const rowsQuery = useInfiniteQuery({
    queryKey: ['ui-port', 'dataset-rows', version?.id],
    queryFn: ({ pageParam }) =>
      notebookDataClient.rpc<RowValuePayload>('query_dataset_version_rows', {
        p_dataset_version_id: version!.id,
        p_limit: ROWS_PAGE_SIZE,
        p_offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) =>
      lastPage.offset + lastPage.rows.length < lastPage.totalCount
        ? lastPage.offset + lastPage.rows.length
        : undefined,
    enabled: Boolean(version) && !liveValue,
  })

  // A dataset nobody has snapshotted yet still has rows: read them live
  // rather than showing an empty grid beside a row count.
  const liveRows =
    !liveValue && !search.snapshot && versions.isSuccess && !version

  const datasetSchema = useQuery({
    queryKey: ['ui-port', 'dataset-schema-version', datasetId],
    queryFn: async () => {
      const rows = await notebookDataClient.list<{
        schema_version_id: string
      }>('datasets', `?id=eq.${datasetId}&select=schema_version_id`)

      return rows.at(0)?.schema_version_id ?? null
    },
    enabled: liveRows,
  })

  const liveRowsQuery = useInfiniteQuery({
    queryKey: ['ui-port', 'dataset-live-rows', datasetId],
    queryFn: async ({ pageParam }): Promise<RowValuePayload> => {
      const page = await notebookDataClient.rpc<
        Omit<RowValuePayload, 'datasetVersionId' | 'schemaVersionId'>
      >('query_dataset_rows', {
        p_dataset_id: datasetId,
        p_limit: ROWS_PAGE_SIZE,
        p_offset: pageParam,
      })

      return {
        ...page,
        datasetVersionId: '',
        schemaVersionId: datasetSchema.data ?? '',
      }
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) =>
      lastPage.offset + lastPage.rows.length < lastPage.totalCount
        ? lastPage.offset + lastPage.rows.length
        : undefined,
    enabled: liveRows && Boolean(datasetSchema.data),
  })

  const windowQuery = liveRows ? liveRowsQuery : rowsQuery

  const payload = liveValue ? valueContext.data : windowQuery.data?.pages.at(0)

  const fieldsQuery = useQuery({
    queryKey: ['ui-port', 'dataset-fields', payload?.schemaVersionId],
    queryFn: () =>
      notebookDataClient.list<FieldWire>(
        'dataset_schema_version_fields',
        `?schema_version_id=eq.${payload!.schemaVersionId}&order=display_order.asc&select=field_id,key,label,logical_type,display_order`,
      ),
    enabled: Boolean(payload?.schemaVersionId),
  })

  const flagsQuery = useQuery({
    queryKey: ['ui-port', 'dataset-flags', datasetId],
    queryFn: () => fetchActiveDatasetFlags(notebookDataClient, datasetId),
  })

  const fields = useMemo(() => fieldsQuery.data ?? [], [fieldsQuery.data])
  const flags = useMemo(() => flagsQuery.data ?? [], [flagsQuery.data])

  const flagIndex: ReadonlyMap<string, DatasetValueFlag> = useMemo(
    () => buildFlagIndex(flags),
    [flags],
  )

  const flaggedRowIds = useMemo(
    () => new Set(flags.map((f) => f.rowId)),
    [flags],
  )

  // Columns whose values were flagged for a missing unit: the grid marks them.
  const unitless = useMemo(
    () =>
      new Set(
        flags.filter((f) => f.kind === 'missing_unit').map((f) => f.fieldId),
      ),
    [flags],
  )

  const columnField = fields.find((f) => f.field_id === search.col)
  const q = (search.q ?? '').trim().toLowerCase()

  const rows = rowsOf(liveValue, valueContext.data, windowQuery.data?.pages)

  // The flagged filter reads only the rows loaded so far, so its count must
  // too — otherwise "(12)" sits beside "Showing 9 of 162" as a contradiction.
  // The count converges on the dataset total as "Load more" extends the window.
  const loadedFlaggedCount = countFlagged(rows, flaggedRowIds)

  const visible = visibleRows(rows, Boolean(search.flagged), flaggedRowIds, q)

  const selection = selectionOf(fields, visible, flags, search)

  const refresh = (versionId: string | undefined) => {
    void queryClient.invalidateQueries({
      queryKey: ['ui-port', 'dataset-value', datasetId],
    })
    void queryClient.invalidateQueries({
      queryKey: ['ui-port', 'dataset-flags', datasetId],
    })
    void queryClient.invalidateQueries({
      queryKey: datasetListQueryKeys.page,
    })

    if (versionId) {
      void queryClient.invalidateQueries({
        queryKey: ['ui-port', 'dataset-rows', versionId],
      })
    } else {
      void queryClient.invalidateQueries({
        queryKey: ['ui-port', 'dataset-live-rows', datasetId],
      })
    }
  }

  return {
    versions,
    version,
    valueContext,
    rowsQuery: windowQuery,
    liveRows,
    payload,
    fields,
    flags,
    flagIndex,
    flaggedRowIds,
    unitless,
    columnField,
    rows,
    visible,
    selected: selection.selected,
    selectedField: selection.selectedField,
    selectedPosition: selection.selectedPosition,
    selectedValue: selection.selectedValue,
    selectedFlags: selection.selectedFlags,
    loadedFlaggedCount,
    totalCount: payload?.totalCount ?? 0,
    inspectorRowCount: payload?.totalCount ?? rows.length,
    refresh,
  }
}

/** The snapshot a pane reads: the one its id or label names, else the newest. */
function snapshotVersion(
  versions: DatasetVersion[] | undefined,
  snapshot: string | undefined,
): DatasetVersion | undefined {
  if (!snapshot) return versions?.at(0)

  return versions?.find((v) => v.id === snapshot || v.label === snapshot)
}

/** The rows in view: one live row's values, or every loaded page of the window. */
function rowsOf(
  liveValue: boolean,
  live: { rows: RowGridRow[] } | null | undefined,
  pages: Array<{ rows: RowGridRow[] }> | undefined,
): RowGridRow[] {
  if (liveValue) return live?.rows ?? []

  return pages?.flatMap((page) => page.rows) ?? []
}

/** How many of the loaded rows carry a flag: the flagged filter's own count. */
function countFlagged(
  rows: RowGridRow[],
  flaggedRowIds: ReadonlySet<string>,
): number {
  return rows.reduce(
    (count, row) => (flaggedRowIds.has(row.rowId) ? count + 1 : count),
    0,
  )
}

/** What the inspector shows: the chosen column's row, or the first visible row. */
function selectionOf(
  fields: FieldWire[],
  visible: RowGridRow[],
  flags: DatasetValueFlag[],
  search: RowsSearch,
) {
  const selected = visible.find((r) => r.rowId === search.row) ?? visible.at(0)

  const selectedField =
    fields.find((f) => f.field_id === search.field) ?? fields.at(0)

  // A row number is the row's page position: the model stores none.
  const selectedPosition = selected ? visible.indexOf(selected) + 1 : null

  const selectedValue = selectedField
    ? selected?.values[selectedField.field_id]
    : undefined

  const selectedFlags =
    selected && selectedField
      ? flags.filter(
          (f) =>
            f.rowId === selected.rowId && f.fieldId === selectedField.field_id,
        )
      : []

  return {
    selected,
    selectedField,
    selectedPosition,
    selectedValue,
    selectedFlags,
  }
}

/** The rows the grid shows: the flagged filter first, then the search text. */
function visibleRows(
  rows: RowGridRow[],
  flaggedOnly: boolean,
  flaggedRowIds: ReadonlySet<string>,
  needle: string,
): RowGridRow[] {
  return rows.filter((row) => {
    if (flaggedOnly && !flaggedRowIds.has(row.rowId)) return false

    if (!needle) return true

    return Object.values(row.values).some((value) =>
      // oxlint-disable-next-line typescript/no-base-to-string -- Row search has always matched each cell's native String form, including `null`, `undefined` and object coercion; the search box finds what the grid shows.
      String(value).toLowerCase().includes(needle),
    )
  })
}

/** A cell's text, when the cell holds one; `null` for anything else. */
function textValue(value: DatasetRowValues[string]): string | null {
  const text = z.string().safeParse(value)

  return text.success ? text.data : null
}

/**
 * Resolve the source sample for a repeat from the selected row: a `reference`
 * field value that is a Sample record id, or a text value matching a Sample
 * identifier. Returns `null` when nothing resolves; the action then explains
 * itself rather than guessing a source.
 */
export function useRowSourceSample(
  row: RowGridRow | undefined,
  fields: FieldWire[],
) {
  const referenceIds = fields.flatMap((field) => {
    if (field.logical_type !== 'reference') return []

    const value = textValue(row?.values[field.field_id])

    return value !== null && UUID_RE.test(value) ? [value] : []
  })

  const sampleTexts = fields.flatMap((field) => {
    if (!/sample/i.test(field.key) && !/sample/i.test(field.label)) return []

    const value = textValue(row?.values[field.field_id])

    return value !== null && value.trim().length > 0 ? [value] : []
  })

  const enabled = referenceIds.length > 0 || sampleTexts.length > 0

  return useQuery({
    queryKey: [
      'ui-port',
      'dataset-row-source-sample',
      JSON.stringify({ referenceIds, sampleTexts }),
    ],
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<RepeatSourceSample | null> => {
      if (referenceIds.length) {
        const byId = await notebookDataClient.list<
          Pick<RepeatSourceSample, 'id' | 'identifier'>
        >(
          'records',
          `?kind=eq.sample&id=in.(${referenceIds.join(
            ',',
          )})&select=id,identifier&limit=1`,
        )

        if (byId[0]) return byId[0]
      }

      for (const identifier of sampleTexts.slice(0, 3)) {
        const byText = await notebookDataClient.list<
          Pick<RepeatSourceSample, 'id' | 'identifier'>
        >(
          'records',
          `?kind=eq.sample&identifier=eq.${encodeURIComponent(
            identifier,
          )}&select=id,identifier&limit=1`,
        )

        if (byText[0]) return byText[0]
      }

      return null
    },
  })
}

/** A UUID names a record; a sample identifier does not have to. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
