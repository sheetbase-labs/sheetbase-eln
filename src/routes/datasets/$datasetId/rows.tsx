import { useMemo } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'

import { LoadMore } from '#/components/v3/ui/load-more'
import { Button } from '#/components/v3/ui/button'
import { Checkbox } from '#/components/v3/ui/checkbox'
import { Input } from '#/components/v3/ui/input'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Inspector, InspectorSection, Muted } from '#/components/v3/ui/layout'
import { TableBox } from '#/components/v3/ui/table'
import {
  RegistryGrid,
  useRowFocus,
} from '#/components/v3/inventory/registry-grid'
import type { RegistryColumn } from '#/components/v3/inventory/registry-grid'
import { ValueActions } from '#/components/v3/datasets/value-actions'
import type { RepeatSourceSample } from '#/components/v3/datasets/value-actions'
import { datasetListQueryKeys } from '#/components/v3/datasets/datasets-data'
import { hasCapability } from '#/lib/capability'
import {
  buildFlagIndex,
  fetchActiveDatasetFlags,
  flagKey,
} from '#/lib/dataset-flags'
import { notebookDataClient } from '#/lib/notebook-data'
import { SEARCH_SETTLE_MS, useSettledValue } from '#/lib/settled-value'
import { cn } from '#/lib/utils'
import { useDatasetVersions } from '../$datasetId'

/** A row of the snapshot grid: the loader's own row shape. */
type RowGridRow = RowValuePayload['rows'][number]

interface RowValuePayload {
  datasetVersionId: string
  datasetId: string
  schemaVersionId: string
  totalCount: number
  offset: number
  limit: number
  rows: { rowId: string; revision: number; values: Record<string, unknown> }[]
}

interface FieldWire {
  field_id: string
  key: string
  label: string
  logical_type: string
  display_order: number
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** DSET-03.3 — rows page size. The server supports p_limit/p_offset, so the
 * grid asks for one window at a time and extends it through the visible
 * "Load more" control instead of stopping at a fixed first page. */
const ROWS_PAGE_SIZE = 100

/** UI port (roadmap-4/ui-app3): the dataset Rows grid, wired to
 * query_dataset_version_rows + schema fields, with selected-value actions for
 * marking a value out of range, clearing a flag and requesting a repeat. Row
 * numbers are page positions: the model stores no row number. */
export const Route = createFileRoute('/datasets/$datasetId/rows')({
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    q?: string
    flagged?: boolean
    row?: string
    field?: string
    snapshot?: string
  } => ({
    q: typeof search.q === 'string' ? search.q : undefined,
    flagged: search.flagged === true || search.flagged === 'true' || undefined,
    row: typeof search.row === 'string' ? search.row : undefined,
    field: typeof search.field === 'string' ? search.field : undefined,
    snapshot: typeof search.snapshot === 'string' ? search.snapshot : undefined,
  }),
  component: Rows,
})

function Rows() {
  const { datasetId } = Route.useParams()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const { context } = Route.useRouteContext()
  const queryClient = useQueryClient()
  // The box holds what was typed and reports the settled value to the route —
  // the two-nature rule (adopt a change made elsewhere, drop pending typing)
  // lives in the hook, twice over in this screen's history.
  const { value: query, setValue: searchRows } = useSettledValue(
    search.q ?? '',
    SEARCH_SETTLE_MS,
    (next) =>
      void navigate({
        to: '/datasets/$datasetId/rows',
        params: { datasetId },
        search: (s) => ({ ...s, q: next || undefined }),
        replace: true,
      }),
  )
  const versions = useDatasetVersions(datasetId)
  const version =
    (versions.data ?? []).find((v) => v.id === search.snapshot) ??
    versions.data?.at(0)

  const canWrite = hasCapability(context.workspace?.role, 'record.create')

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
    enabled: Boolean(version),
  })
  const payload = rowsQuery.data?.pages.at(0)

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
  const fields = fieldsQuery.data ?? []
  const flags = flagsQuery.data ?? []
  const flagIndex = useMemo(() => buildFlagIndex(flags), [flags])
  const flaggedRowIds = useMemo(
    () => new Set(flags.map((f) => f.rowId)),
    [flags],
  )

  const q = (search.q ?? '').trim().toLowerCase()
  const rows = rowsQuery.data?.pages.flatMap((page) => page.rows) ?? []
  // The flagged filter reads only the rows loaded so far, so its count must
  // too — otherwise "(12)" sits beside "Showing 9 of 162" as a contradiction.
  // The count converges on the dataset total as "Load more" extends the window.
  const loadedFlaggedCount = rows.reduce(
    (count, row) => (flaggedRowIds.has(row.rowId) ? count + 1 : count),
    0,
  )
  const visible = rows.filter((r) => {
    if (search.flagged && !flaggedRowIds.has(r.rowId)) return false
    if (!q) return true
    return Object.values(r.values).some((v) =>
      String(v).toLowerCase().includes(q),
    )
  })
  const selected = visible.find((r) => r.rowId === search.row) ?? visible.at(0)
  const { rowSelection, onRowSelectionChange } = useRowFocus(
    selected?.rowId ?? null,
    (rowId) =>
      void navigate({
        to: '/datasets/$datasetId/rows',
        params: { datasetId },
        search: (s) => ({ ...s, row: rowId ?? undefined }),
        replace: true,
      }),
  )
  // One grid column per schema field, right-aligned unless the field is text —
  // the bespoke table's own rule — plus the row-number column the snapshot
  // shows. A value cell carries the flag colour of its own row and field.
  const columns = useMemo<RegistryColumn<RowGridRow>[]>(() => {
    const rowNumber: RegistryColumn<RowGridRow> = {
      id: 'row',
      header: 'Row',
      cell: ({ row }) => {
        if (!('values' in row.original)) return null
        const index = visible.findIndex((r) => r.rowId === row.original.rowId)
        return (
          <span className="num text-fg-muted">
            {index + 1}
            {flaggedRowIds.has(row.original.rowId) ? (
              <span className="ml-1 text-danger">•</span>
            ) : null}
          </span>
        )
      },
      meta: { headerClassName: 'min-w-[64px]' },
    }
    return [
      rowNumber,
      ...fields.map((f) => {
        const align = f.logical_type === 'text' ? undefined : 'right'
        return {
          id: f.field_id,
          header: f.label,
          cell: ({ row }) => {
            if (!('values' in row.original)) return null
            const value = row.original.values[f.field_id]
            const flagged = flagIndex.get(
              flagKey(row.original.rowId, f.field_id),
            )
            return (
              <span className={cn(flagged && 'text-danger-text')}>
                {value == null ? '—' : String(value)}
              </span>
            )
          },
          meta: align
            ? {
                headerClassName: 'text-right',
                cellClassName: 'text-right',
              }
            : undefined,
        } satisfies RegistryColumn<RowGridRow>
      }),
    ]
  }, [fields, flagIndex, flaggedRowIds, visible])
  const selectedField =
    fields.find((f) => f.field_id === search.field) ?? fields.at(0)

  const refresh = (versionId: string | undefined) => {
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
    }
  }

  // A repeat is requested from a source sample. The row links to it either by a
  // reference field (record id) or by a text field whose value matches a sample
  // identifier. When neither resolves, the action stays disabled.
  const sourceSample = useRowSourceSample(selected, fields)

  if (!version) {
    return (
      <div className="px-6 py-4">
        <EmptyState
          icon="table"
          title="No snapshot to read rows from"
          description="Snapshot the dataset to freeze its rows as evidence; the grid reads a snapshot."
          action={
            <Button
              nativeButton={false}
              render={
                <Link
                  to="/datasets/$datasetId/snapshots"
                  params={{ datasetId }}
                />
              }
            >
              Create a snapshot
            </Button>
          }
        />
      </div>
    )
  }

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

  return (
    <>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-4 py-2 md:px-6">
          <label className="block w-full sm:w-[220px]">
            <span className="sr-only">Search rows</span>
            <Input
              type="search"
              placeholder="Search rows"
              value={query}
              className="h-[26px] text-label max-md:h-10"
              onChange={(e) => searchRows(e.target.value)}
            />
          </label>
          <label className="flex items-center gap-2 text-label max-md:min-h-10 sm:ml-2">
            <Checkbox
              checked={!!search.flagged}
              onCheckedChange={(v) =>
                void navigate({
                  to: '/datasets/$datasetId/rows',
                  params: { datasetId },
                  search: (s) => ({ ...s, flagged: v ? true : undefined }),
                  replace: true,
                })
              }
            />
            Only flagged rows ({loadedFlaggedCount})
          </label>
          <span className="flex-1" />
          <Muted className="max-lg:hidden">
            Snapshot {version.label} · read-only; values change only by import
          </Muted>
          <Button
            size="sm"
            nativeButton={false}
            render={<Link to="/import" search={{ dataset: datasetId }} />}
          >
            Correct by re-import
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-4 pb-3 md:px-6">
          {visible.length ? (
            <TableBox className="mt-3">
              <RegistryGrid
                label="Dataset rows"
                rows={visible}
                columns={columns}
                getRowId={(r) => r.rowId}
                rowSelection={rowSelection}
                onRowSelectionChange={onRowSelectionChange}
                selectable={false}
              />
            </TableBox>
          ) : (
            <EmptyState
              icon="search"
              title={
                payload && payload.totalCount === 0
                  ? 'No rows in this snapshot'
                  : 'No rows match'
              }
              description={
                payload && payload.totalCount === 0
                  ? 'The snapshot froze a dataset with no rows; import rows into the dataset and snapshot it again.'
                  : 'Search looks at the rows loaded so far; the flagged filter keeps rows with any flagged value.'
              }
              action={
                payload && payload.totalCount === 0 ? undefined : (
                  <Button
                    onClick={() =>
                      void navigate({
                        to: '/datasets/$datasetId/rows',
                        params: { datasetId },
                        search: (s) => ({
                          ...s,
                          q: undefined,
                          flagged: undefined,
                        }),
                        replace: true,
                      })
                    }
                  >
                    Clear search and filters
                  </Button>
                )
              }
            />
          )}
          <div className="num flex flex-col gap-2 py-2 text-label text-fg-muted">
            <span>
              Showing {visible.length} of {payload?.totalCount ?? 0} rows
              {rows.length < (payload?.totalCount ?? 0)
                ? ` (${rows.length} loaded so far)`
                : ''}
              {selected
                ? ` · row ${visible.indexOf(selected) + 1} selected`
                : ''}
            </span>
            {rowsQuery.hasNextPage ? (
              <span className="font-sans">
                Search and the flagged filter look at the rows loaded so far.
              </span>
            ) : null}
            <LoadMore
              label="More dataset rows"
              hasMore={rowsQuery.hasNextPage}
              loading={rowsQuery.isFetchingNextPage}
              onLoadMore={() => void rowsQuery.fetchNextPage()}
            />
          </div>
        </div>
      </div>

      {selected ? (
        <Inspector aria-label="Row details" className="w-[320px]">
          <InspectorSection title={`Row ${visible.indexOf(selected) + 1}`}>
            <Muted className="mb-2">
              Row numbers are page positions; the model stores no row number.
              Select a value to act on it.
            </Muted>
            <div className="flex flex-col">
              {fields.map((f) => {
                const value = selected.values[f.field_id]
                const cellFlag = flagIndex.get(
                  flagKey(selected.rowId, f.field_id),
                )
                const isSelected = f.field_id === selectedField?.field_id
                return (
                  <button
                    key={f.field_id}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() =>
                      void navigate({
                        to: '/datasets/$datasetId/rows',
                        params: { datasetId },
                        search: (s) => ({ ...s, field: f.field_id }),
                        replace: true,
                      })
                    }
                    className={cn(
                      'flex cursor-pointer items-center justify-between gap-2 rounded-sm border-0 bg-transparent px-1.5 py-1 text-left text-label hover:bg-surface-hover',
                      isSelected && 'bg-selection font-medium',
                    )}
                  >
                    <span className="text-fg-muted">{f.label}</span>
                    <span
                      className={cn(
                        'num truncate',
                        cellFlag && 'text-danger-text',
                      )}
                    >
                      {value == null ? '—' : String(value)}
                      {cellFlag ? ' •' : ''}
                    </span>
                  </button>
                )
              })}
            </div>
          </InspectorSection>

          {selectedField ? (
            <InspectorSection title="Selected value">
              <div className="mb-2 flex items-baseline gap-2">
                <span className="num text-title font-medium">
                  {selectedValue == null ? '—' : String(selectedValue)}
                </span>
                <span className="text-label text-fg-muted">
                  {selectedField.label}
                </span>
              </div>
              <ValueActions
                datasetId={datasetId}
                rowId={selected.rowId}
                fieldId={selectedField.field_id}
                fieldLabel={selectedField.label}
                value={selectedValue}
                flags={selectedFlags}
                canWrite={canWrite}
                sourceSample={sourceSample.data ?? null}
                onChanged={() => refresh(version.id)}
              />
              <Muted className="mt-2">
                To correct this value, import the corrected rows into the
                dataset.{' '}
                <Link
                  to="/import"
                  search={{ dataset: datasetId }}
                  className="underline"
                >
                  Re-import
                </Link>
              </Muted>
            </InspectorSection>
          ) : null}
        </Inspector>
      ) : null}
    </>
  )
}

/**
 * Resolve the source sample for a repeat from the selected row: a `reference`
 * field value that is a Sample record id, or a text value matching a Sample
 * identifier. Returns `null` when nothing resolves; the action then explains
 * itself rather than guessing a source.
 */
function useRowSourceSample(
  row: RowValuePayload['rows'][number] | undefined,
  fields: FieldWire[],
) {
  const referenceIds = fields
    .filter((f) => f.logical_type === 'reference')
    .map((f) => row?.values[f.field_id])
    .filter((v): v is string => typeof v === 'string' && UUID_RE.test(v))

  const sampleTexts = fields
    .filter((f) => /sample/i.test(f.key) || /sample/i.test(f.label))
    .map((f) => row?.values[f.field_id])
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)

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
