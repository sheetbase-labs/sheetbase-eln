import { useCallback, useEffect, useMemo } from 'react'
import type { ReactNode } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'

import { rich, t } from '#/copy'
import { LoadMore } from '#/components/ui/load-more'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { Input } from '#/components/ui/input'
import { EmptyState } from '#/components/ui/empty-state'
import { Inspector, InspectorSection, Muted } from '#/components/ui/layout'
import { TableBox } from '#/components/ui/table'
import { RegistryGrid, useRowFocus } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { ColumnInspector } from '#/components/datasets/column-inspector'
import { ValueActions } from '#/components/datasets/value-actions'
import type { RepeatSourceSample } from '#/components/datasets/value-actions'
import { formatSelectedValue } from '#/components/datasets/value-action-presentation'
import { hasCapability } from '#/lib/capability'
import { flagKey } from '#/lib/dataset-flags'
import type { DatasetValueFlag } from '#/lib/dataset-flags'
import type { DatasetRowValues } from '#/lib/dataset-product'
import { SEARCH_SETTLE_MS, useSettledValue } from '#/lib/settled-value'
import { cn } from '#/lib/utils'
import { usePaneContext } from '#/components/workspace/workspace-navigation'
import {
  rowsSearchSchema,
  useDatasetRowsData,
  useRowSourceSample,
} from './-dataset-rows-data'
import type { FieldWire, RowGridRow, RowsSearch } from './-dataset-rows-data'

/** UI port (roadmap-4/ui-app3): the dataset Rows grid, wired to
 * query_dataset_version_rows + schema fields, with selected-value actions for
 * marking a value out of range, clearing a flag and requesting a repeat. Row
 * numbers are page positions: the model stores no row number. */
export const Route = createFileRoute('/datasets/$datasetId/rows')({
  validateSearch: (search): RowsSearch => rowsSearchSchema.parse(search),
  component: Rows,
})

function Rows() {
  const { datasetId } = Route.useParams()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const { context } = Route.useRouteContext()
  const queryClient = useQueryClient()

  const updateSearch = useCallback(
    (patch: Partial<RowsSearch>) => {
      void navigate({
        to: '/datasets/$datasetId/rows',
        params: { datasetId },
        search: (s) => ({ ...s, ...patch }),
        replace: true,
      })
    },
    [navigate, datasetId],
  )

  // The box holds what was typed and reports the settled value to the route —
  // the two-nature rule (adopt a change made elsewhere, drop pending typing)
  // lives in the hook, twice over in this screen's history.
  const settleSearch = useCallback(
    (next: string) => updateSearch({ q: next || undefined }),
    [updateSearch],
  )

  const { value: query, setValue: searchRows } = useSettledValue(
    search.q ?? '',
    SEARCH_SETTLE_MS,
    settleSearch,
  )

  const canWrite = hasCapability(context.workspace?.role, 'record.create')
  // A value link is a live inspection, not a claim about a frozen snapshot.
  const liveValue = Boolean(search.live && search.row && !search.snapshot)

  const {
    versions,
    version,
    valueContext,
    rowsQuery,
    payload,
    fields,
    flags,
    flagIndex,
    flaggedRowIds,
    unitless,
    columnField,
    rows,
    visible,
    selected,
    selectedField,
    selectedPosition,
    selectedValue,
    selectedFlags,
    loadedFlaggedCount,
    totalCount,
    inspectorRowCount,
    refresh,
  } = useDatasetRowsData({ datasetId, search, liveValue, queryClient })

  // A pane pinned to a snapshot says when a newer one exists.
  const { reportNewer } = usePaneContext()
  const newestLabel = versions.data?.at(0)?.label

  const pinnedNewer = newerSnapshotLabel(
    search.snapshot,
    version?.label,
    newestLabel,
  )

  useEffect(() => {
    reportNewer(pinnedNewer)
  }, [reportNewer, pinnedNewer])

  const onToggleColumn = useCallback(
    (fieldId: string) =>
      updateSearch({ col: search.col === fieldId ? undefined : fieldId }),
    [updateSearch, search.col],
  )

  const focusRow = useCallback(
    (rowId: string | null) =>
      updateSearch({ row: rowId ?? undefined, col: undefined }),
    [updateSearch],
  )

  const onSelectField = useCallback(
    (fieldId: string) => updateSearch({ field: fieldId }),
    [updateSearch],
  )

  const setFlagged = useCallback(
    (next: boolean) => updateSearch({ flagged: next ? true : undefined }),
    [updateSearch],
  )

  const clearFilters = useCallback(
    () => updateSearch({ q: undefined, flagged: undefined }),
    [updateSearch],
  )

  const rowFocus = useRowFocus(selected?.rowId ?? null, focusRow)
  const versionId = version?.id

  // One grid column per schema field, right-aligned unless the field is text —
  // the bespoke table's own rule — plus the row-number column the snapshot
  // shows. A value cell carries the flag colour of its own row and field.
  const columns = useDatasetRowColumns({
    fields,
    visible,
    flaggedRowIds,
    flagIndex,
    unitless,
    selectedColumn: search.col,
    onToggleColumn,
  })

  // A repeat is requested from a source sample. The row links to it either by a
  // reference field (record id) or by a text field whose value matches a sample
  // identifier. When neither resolves, the action stays disabled.
  const sourceSample = useRowSourceSample(selected, fields)

  const fallback = fallbackScreen(versions, version !== undefined, liveValue)

  if (fallback)
    return (
      <RowsFallback
        kind={fallback}
        datasetId={datasetId}
        snapshot={search.snapshot}
        onRetry={() => void versions.refetch()}
      />
    )

  return (
    <RowsView
      datasetId={datasetId}
      query={query}
      onSearch={searchRows}
      flagged={!!search.flagged}
      onFlagged={setFlagged}
      liveValue={liveValue}
      liveStatus={liveValueStatus({
        isError: valueContext.isError,
        isLoading: valueContext.isLoading,
        hasData: Boolean(valueContext.data),
      })}
      snapshotLabel={version?.label}
      loadedFlaggedCount={loadedFlaggedCount}
      visible={visible}
      columns={columns}
      rowFocus={rowFocus}
      emptySnapshot={payload?.totalCount === 0}
      onClearFilters={clearFilters}
      totalCount={totalCount}
      loadedCount={rows.length}
      selectedPosition={selectedPosition}
      hasNextPage={rowsQuery.hasNextPage}
      loadingMore={rowsQuery.isFetchingNextPage}
      onLoadMore={rowsQuery.fetchNextPage}
      inspector={
        <RowsInspector
          datasetId={datasetId}
          columnField={columnField}
          selected={selected}
          selectedField={selectedField}
          selectedValue={selectedValue}
          selectedFlags={selectedFlags}
          fields={fields}
          flags={flags}
          flagIndex={flagIndex}
          rows={rows}
          totalCount={inspectorRowCount}
          selectedPosition={selectedPosition}
          canWrite={canWrite}
          sourceSample={sourceSample.data ?? null}
          onSelectField={onSelectField}
          onChanged={() => refresh(versionId)}
        />
      }
    />
  )
}

/** The rows screen's layout: status line, toolbar, grid, counts and details. */
function RowsView(props: {
  datasetId: string
  query: string
  onSearch: (next: string) => void
  flagged: boolean
  onFlagged: (next: boolean) => void
  liveValue: boolean
  liveStatus: string
  snapshotLabel: string | undefined
  loadedFlaggedCount: number
  visible: RowGridRow[]
  columns: RegistryColumn<RowGridRow>[]
  rowFocus: ReturnType<typeof useRowFocus>
  emptySnapshot: boolean
  onClearFilters: () => void
  totalCount: number
  loadedCount: number
  selectedPosition: number | null
  hasNextPage: boolean
  loadingMore: boolean
  onLoadMore: () => void
  inspector: ReactNode
}) {
  return (
    <>
      <div className="flex min-w-0 flex-1 flex-col">
        {props.liveValue ? (
          <div
            role="status"
            className="border-b border-border-subtle px-4 py-2 text-label text-fg-muted md:px-6"
          >
            {props.liveStatus}
          </div>
        ) : null}
        <RowsToolbar
          datasetId={props.datasetId}
          query={props.query}
          onSearch={props.onSearch}
          flagged={props.flagged}
          onFlagged={props.onFlagged}
          loadedFlaggedCount={props.loadedFlaggedCount}
          liveValue={props.liveValue}
          snapshotLabel={props.snapshotLabel}
        />

        <div className="min-h-0 flex-1 overflow-auto px-4 pb-3 md:px-6">
          {props.visible.length ? (
            <TableBox className="mt-3">
              <RegistryGrid
                label={t('data.datasetRows.datasetRows')}
                rows={props.visible}
                columns={props.columns}
                getRowId={(r) => r.rowId}
                rowSelection={props.rowFocus.rowSelection}
                onRowSelectionChange={props.rowFocus.onRowSelectionChange}
                selectable={false}
              />
            </TableBox>
          ) : (
            <EmptyState
              icon="search"
              title={
                props.emptySnapshot
                  ? t('data.datasetRows.rowsSnapshot')
                  : t('data.datasetRows.rowsMatch')
              }
              description={
                props.emptySnapshot
                  ? t('data.datasetRows.snapshotFrozeDatasetRows')
                  : t('data.datasetRows.searchLooksRowsLoaded')
              }
              action={
                props.emptySnapshot ? undefined : (
                  <Button onClick={props.onClearFilters}>
                    {t('data.datasetRows.clearSearchFilters')}
                  </Button>
                )
              }
            />
          )}
          <RowsFooter
            totalCount={props.totalCount}
            shownCount={props.visible.length}
            loadedCount={props.loadedCount}
            selectedPosition={props.selectedPosition}
            hasNextPage={props.hasNextPage}
            loadingMore={props.loadingMore}
            onLoadMore={props.onLoadMore}
          />
        </div>
      </div>

      {props.inspector}
    </>
  )
}

/** The grid's columns: the row number, then one per schema field. */
function useDatasetRowColumns(input: {
  fields: FieldWire[]
  visible: RowGridRow[]
  flaggedRowIds: ReadonlySet<string>
  flagIndex: ReadonlyMap<string, DatasetValueFlag>
  unitless: ReadonlySet<string>
  selectedColumn: string | undefined
  onToggleColumn: (fieldId: string) => void
}): RegistryColumn<RowGridRow>[] {
  const {
    fields,
    visible,
    flaggedRowIds,
    flagIndex,
    unitless,
    selectedColumn,
    onToggleColumn,
  } = input

  return useMemo<RegistryColumn<RowGridRow>[]>(() => {
    const rowNumber: RegistryColumn<RowGridRow> = {
      id: 'row',
      header: t('data.datasetRows.row2'),
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
          header: () => (
            <button
              type="button"
              aria-pressed={selectedColumn === f.field_id}
              title={t('data.datasetRows.inspectColumn', { label: f.label })}
              onClick={() => onToggleColumn(f.field_id)}
              className={cn(
                'cursor-pointer border-0 bg-transparent p-0 font-[inherit] text-inherit',
                selectedColumn === f.field_id && 'font-semibold underline',
                unitless.has(f.field_id) && 'text-warning-text',
              )}
            >
              {unitless.has(f.field_id)
                ? t('data.datasetRows.labelUnitless', { label: f.label })
                : f.label}
            </button>
          ),
          cell: ({ row }) => {
            if (!('values' in row.original)) return null
            const value = row.original.values[f.field_id]

            const flagged = flagIndex.get(
              flagKey(row.original.rowId, f.field_id),
            )

            return (
              <span className={cn(flagged && 'text-danger-text')}>
                {formatSelectedValue(value)}
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
  }, [
    fields,
    flagIndex,
    flaggedRowIds,
    visible,
    selectedColumn,
    unitless,
    onToggleColumn,
  ])
}

/** The rows grid's toolbar: search, the flagged filter, and how the read is owned. */
function RowsToolbar(props: {
  datasetId: string
  query: string
  onSearch: (next: string) => void
  flagged: boolean
  onFlagged: (next: boolean) => void
  loadedFlaggedCount: number
  liveValue: boolean
  snapshotLabel: string | undefined
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-4 py-2 md:px-6">
      <label className="block w-full sm:w-[220px]">
        <span className="sr-only">{t('data.datasetRows.searchRows')}</span>
        <Input
          type="search"
          placeholder={t('data.datasetRows.searchRows')}
          value={props.query}
          className="h-[26px] text-label max-md:h-10"
          onChange={(e) => props.onSearch(e.target.value)}
        />
      </label>
      <label className="flex items-center gap-2 text-label max-md:min-h-10 sm:ml-2">
        <Checkbox
          checked={props.flagged}
          onCheckedChange={(v) => props.onFlagged(Boolean(v))}
        />
        {t('data.datasetRows.onlyFlaggedRows', {
          loadedFlaggedCount: props.loadedFlaggedCount,
        })}
      </label>
      <span className="flex-1" />
      <Muted className="max-lg:hidden">
        {props.liveValue
          ? t('data.datasetRows.liveValueReadOnly')
          : t('data.datasetRows.snapshotReadOnlyValues', {
              label: props.snapshotLabel ?? '',
            })}
      </Muted>
      <Button
        size="sm"
        nativeButton={false}
        render={<Link to="/import" search={{ dataset: props.datasetId }} />}
      >
        {t('data.datasetRows.correctReImport')}
      </Button>
    </div>
  )
}

/** What the grid is showing, and the control that loads the next window. */
function RowsFooter(props: {
  totalCount: number
  shownCount: number
  loadedCount: number
  selectedPosition: number | null
  hasNextPage: boolean
  loadingMore: boolean
  onLoadMore: () => void
}) {
  return (
    <div className="num flex flex-col gap-2 py-2 text-label text-fg-muted">
      <span>
        {[
          t('data.datasetRows.showing', {
            count: props.totalCount,
            shown: props.shownCount,
          }),
          props.loadedCount < props.totalCount
            ? t('data.datasetRows.loadedSoFar', { length: props.loadedCount })
            : null,
          props.selectedPosition
            ? t('data.datasetRows.rowSelected', {
                value: props.selectedPosition,
              })
            : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </span>
      {props.hasNextPage ? (
        <span className="font-sans">
          {t('data.datasetRows.searchFlaggedFilterLook')}
        </span>
      ) : null}
      <LoadMore
        label={t('data.datasetRows.moreDatasetRows')}
        hasMore={props.hasNextPage}
        loading={props.loadingMore}
        onLoadMore={props.onLoadMore}
      />
    </div>
  )
}

/** The right-hand details: the chosen column, or the selected row's values. */
function RowsInspector(props: {
  datasetId: string
  columnField: FieldWire | undefined
  selected: RowGridRow | undefined
  selectedField: FieldWire | undefined
  selectedValue: DatasetRowValues[string]
  selectedFlags: DatasetValueFlag[]
  fields: FieldWire[]
  flags: DatasetValueFlag[]
  flagIndex: ReadonlyMap<string, DatasetValueFlag>
  rows: RowGridRow[]
  totalCount: number
  selectedPosition: number | null
  canWrite: boolean
  sourceSample: RepeatSourceSample | null
  onSelectField: (fieldId: string) => void
  onChanged: () => void
}) {
  const { columnField, selected, selectedField } = props

  if (columnField)
    return (
      <Inspector
        aria-label={t('data.datasetRows.ariaColumnDetails')}
        className="w-[320px]"
      >
        <ColumnInspector
          datasetId={props.datasetId}
          field={columnField}
          values={props.rows.map((r) => r.values[columnField.field_id])}
          rowCount={props.totalCount}
          flags={props.flags}
          fields={props.fields}
          canWrite={props.canWrite}
        />
      </Inspector>
    )

  if (!selected) return null

  return (
    <Inspector
      aria-label={t('data.datasetRows.ariaRowDetails')}
      className="w-[320px]"
    >
      <InspectorSection
        title={t('data.datasetRows.row', {
          value: props.selectedPosition ?? 0,
        })}
      >
        <Muted className="mb-2">
          {t('data.datasetRows.rowNumbersShowPosition')}
        </Muted>
        <div className="flex flex-col">
          {props.fields.map((f) => {
            const value = selected.values[f.field_id]

            const cellFlag = props.flagIndex.get(
              flagKey(selected.rowId, f.field_id),
            )

            const isSelected = f.field_id === selectedField?.field_id

            return (
              <button
                key={f.field_id}
                type="button"
                aria-pressed={isSelected}
                onClick={() => props.onSelectField(f.field_id)}
                className={cn(
                  'flex cursor-pointer items-center justify-between gap-2 rounded-sm border-0 bg-transparent px-1.5 py-1 text-left text-label hover:bg-surface-hover',
                  isSelected && 'bg-selection font-medium',
                )}
              >
                <span className="text-fg-muted">{f.label}</span>
                <span
                  className={cn('num truncate', cellFlag && 'text-danger-text')}
                >
                  {formatSelectedValue(value)}
                  {cellFlag ? ' •' : ''}
                </span>
              </button>
            )
          })}
        </div>
      </InspectorSection>

      {selectedField ? (
        <InspectorSection title={t('data.datasetRows.selectedValue')}>
          <div className="mb-2 flex items-baseline gap-2">
            <span className="num text-title font-medium">
              {formatSelectedValue(props.selectedValue)}
            </span>
            <span className="text-label text-fg-muted">
              {selectedField.label}
            </span>
          </div>
          <ValueActions
            key={`${props.datasetId}:${selected.rowId}:${selectedField.field_id}`}
            datasetId={props.datasetId}
            rowId={selected.rowId}
            fieldId={selectedField.field_id}
            fieldLabel={selectedField.label}
            value={props.selectedValue}
            flags={props.selectedFlags}
            canWrite={props.canWrite}
            sourceSample={props.sourceSample}
            onChanged={props.onChanged}
          />
          <Muted className="mt-2">
            {rich('data.datasetRows.correctValue', {
              link: (text) => (
                <Link
                  to="/import"
                  search={{ dataset: props.datasetId }}
                  className="underline"
                >
                  {text}
                </Link>
              ),
            })}
          </Muted>
        </InspectorSection>
      ) : null}
    </Inspector>
  )
}

/** The newer snapshot a pane pinned to an older one should point at. */
function newerSnapshotLabel(
  pinned: string | undefined,
  current: string | undefined,
  newest: string | undefined,
): string | undefined {
  if (!pinned || !current || !newest) return undefined

  return current === newest ? undefined : newest
}

/** Which whole-screen state stands in for the grid, if any. */
function fallbackScreen(
  versions: { isPending: boolean; isError: boolean },
  hasVersion: boolean,
  liveValue: boolean,
): 'loading' | 'error' | 'no-snapshot' | null {
  if (liveValue) return null

  if (versions.isPending) return 'loading'

  if (versions.isError) return 'error'

  return hasVersion ? null : 'no-snapshot'
}

/** The line a live value read reports: how the read itself went. */
function liveValueStatus(context: {
  isError: boolean
  isLoading: boolean
  hasData: boolean
}): string {
  if (context.isError) return t('data.datasetRows.couldLoadValueReload')

  if (context.isLoading) return t('data.datasetRows.loadingLinkedValue')

  return context.hasData
    ? t('data.datasetRows.liveDatasetValueSelected')
    : t('data.datasetRows.rowLongerAvailableDo')
}

/** The screen before the grid can be drawn: loading, refused, or no snapshot. */
function RowsFallback(props: {
  kind: 'loading' | 'error' | 'no-snapshot'
  datasetId: string
  snapshot: string | undefined
  onRetry: () => void
}) {
  if (props.kind === 'loading')
    return (
      <p className="px-6 py-4 text-body text-fg-muted" role="status">
        {t('data.datasetRows.loadingSnapshots')}
      </p>
    )

  if (props.kind === 'error')
    return (
      <div className="px-6 py-4">
        <EmptyState
          icon="table"
          title={t('data.datasetRows.snapshotsCouldLoaded')}
          description={t('data.datasetRows.checkWorkspaceAccessConnection')}
          action={
            <Button onClick={props.onRetry}>
              {t('common.actions.tryAgain')}
            </Button>
          }
        />
      </div>
    )

  return (
    <div className="px-6 py-4">
      <EmptyState
        icon="table"
        title={
          props.snapshot
            ? t('data.datasetRows.citedSnapshotUnavailable')
            : t('data.datasetRows.snapshotReadRowsFrom')
        }
        description={
          props.snapshot
            ? t('data.datasetRows.requestedSnapshotCouldRead')
            : t('data.datasetRows.snapshotDatasetFreezeRows')
        }
        action={
          props.snapshot ? undefined : (
            <Button
              nativeButton={false}
              render={
                <Link
                  to="/datasets/$datasetId/snapshots"
                  params={{ datasetId: props.datasetId }}
                />
              }
            >
              {t('data.datasetRows.createSnapshot')}
            </Button>
          )
        }
      />
    </div>
  )
}
