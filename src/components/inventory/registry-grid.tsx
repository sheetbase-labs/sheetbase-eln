/**
 * The registry grid: the one table body every registry screen renders.
 *
 * It is `@reui/data-grid` from the pinned base-nova registry (ADR-0055), placed
 * under `src/components/reui/`, rendered flush — the same chrome the bespoke
 * `ui/table` body had before it: a muted header band, 33px rows, the app's
 * own footer band underneath, and no card around it. The swap is the table, not
 * the screen's look.
 *
 * What it adds over the copy it replaces, on every screen rather than one:
 * virtualised rows, and a per-row checkbox so selection is reachable from the
 * keyboard (the bespoke body's `onClick` row had no focusable control).
 *
 * A grouped list passes `bandRow(label)` in place of a record — the band a
 * grouped table draws across the width, e.g. `experiments.tsx`. Bands are not
 * selectable and no row renders behind them.
 *
 * Ordering: a route that sorts the array it passes keeps doing so, and the grid
 * leaves the order alone. A route that passes `view` (`useListView`) or
 * `sorting` gets sortable column headers (click to sort ascending, again for
 * descending, again for the route's own order), and `view` also adds the menu
 * at the end of the header: choose columns, export CSV or Excel. What a person
 * picks is remembered for them. Rows the route loads a page at a time sort
 * what is loaded unless the route reads `view.sorting` into its query.
 *
 * The component owns the cell geometry — 33px rows, 10px cell padding, the 24px
 * inset on the first data column — because that is what makes the swap
 * invisible. A column that needs its own padding states it imperatively
 * (`pr-6!`); a plain `pr-6` in `meta.cellClassName` loses to the component's
 * own cell rules and is silently ignored.
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useLayoutEffect,
  useRef,
} from 'react'
import { Icon } from '#/components/icons'
import { ListViewMenu } from './list-view-menu'
import type { ListView } from '#/lib/list-views'
import type { CSSProperties, ReactNode, RefObject } from 'react'
import { isFunction, useTable } from '@tanstack/react-table'
import type {
  Column,
  OnChangeFn,
  ColumnVisibilityState,
  RowData,
  RowSelectionState,
  SortingState,
  TableState,
  Table,
} from '@tanstack/react-table'

import {
  DataGrid,
  dataGridFeatures,
} from '#/components/reui/data-grid/data-grid'
import type {
  DataGridFeatures,
  DataGridTableInstance,
} from '#/components/reui/data-grid/data-grid'
import { DataGridScrollArea } from '#/components/reui/data-grid/data-grid-scroll-area'
import { DataGridTableVirtual } from '#/components/reui/data-grid/data-grid-table-virtual'
import { Checkbox } from '#/components/ui/checkbox'
import { cn } from '#/lib/utils'
import { t } from '#/copy'
import type { BulkSelection } from './bulk-selection'
import { compareCells, isBand } from './registry-grid-data'
import type { RegistryColumn, RegistryRow } from './registry-grid-data'
import {
  useLinkedRegistrySelection,
  useRegistryEvents,
  useRegistryRowKeys,
} from './registry-grid-effects'

export {
  bandRow,
  rightAligned,
  useRowFocus,
  compareCells,
} from './registry-grid-data'

export type { BandRow, RegistryColumn, RegistryRow } from './registry-grid-data'

/** The id of the column that holds the table's own menu (columns, export). */
const VIEW_COLUMN = '__view'

// Rendered labels follow the current render without replacing cell component types.
const RegistryRenderContext = createContext<{
  name: string
  view?: ListView
  labelForId: (id: string) => string
}>({ name: '', labelForId: (id) => id })

function RegistryMenu<T extends RowData>({
  table,
}: {
  table: Table<DataGridFeatures, T>
}) {
  const { name, view } = useContext(RegistryRenderContext)

  return <ListViewMenu table={table} name={name} view={view} />
}

function RegistryTick({ bulk, rowId }: { bulk: BulkSelection; rowId: string }) {
  const { labelForId } = useContext(RegistryRenderContext)

  return (
    <Checkbox
      aria-label={t('library.bulk.selectRow', { id: labelForId(rowId) })}
      checked={bulk.has(rowId)}
      onCheckedChange={() => bulk.toggle(rowId)}
      onClick={(event) => event.stopPropagation()}
    />
  )
}

/** A header the person can click to sort by its column. */
function SortHeader<T extends RowData>({
  column,
  right,
  children,
}: {
  column: Column<DataGridFeatures, T>
  right: boolean
  children: ReactNode
}) {
  const dir = column.getIsSorted()

  return (
    <button
      type="button"
      className={cn(
        'group/sort -mx-1 inline-flex cursor-pointer items-center gap-1 rounded-sm border-0 bg-transparent px-1 py-0.5 font-[inherit] text-inherit hover:text-fg',
        right && 'flex-row-reverse',
      )}
      onClick={() => {
        if (!dir) column.toggleSorting(false)
        else if (dir === 'asc') column.toggleSorting(true)
        else column.clearSorting()
      }}
    >
      {children}
      <Icon
        name="arrowUp"
        size={12}
        className={cn(
          'shrink-0 transition-opacity',
          dir === 'desc' && 'rotate-180',
          dir ? 'opacity-100' : 'opacity-0 group-hover/sort:opacity-40',
        )}
      />
    </button>
  )
}

export interface RegistryGridProps<T extends RowData> {
  /** The table's accessible name, e.g. "Samples". */
  label: string
  rows: RegistryRow<T>[]
  columns: RegistryColumn<T>[]
  getRowId: (row: T) => string
  /** Required only when `selectable`; omit it on a screen whose rows are links. */
  rowSelection?: RowSelectionState
  onRowSelectionChange?: OnChangeFn<RowSelectionState>
  /** The single row the inspector shows; clicking a row selects it. */
  onRowClick?: (row: T) => void
  /**
   * Whether a row can be selected (click or keyboard) to drive the screen's
   * inspector. A detail table whose rows are not a selection passes false.
   */
  selectable?: boolean
  /**
   * Tick boxes for bulk actions. Adds a leading checkbox column whose header
   * ticks every row shown; the bar that acts on the ticked rows is the
   * screen's (`RecordBulkBar`). Separate from `rowSelection`, which is the one
   * row the inspector shows.
   */
  bulk?: BulkSelection
  /** What a row's tick box is called, e.g. its identifier; defaults to its id. */
  rowLabel?: (row: T) => string
  /** Ordering the route owns and writes into the grid (the sort toolbar). */
  sorting?: SortingState
  onSortingChange?: OnChangeFn<SortingState>
  /**
   * The person's remembered sorting and hidden columns (`useListView`). Turns
   * on sortable headers and the columns-and-export menu.
   */
  view?: ListView
  /**
   * Whether a click on a column header sorts. A list whose own Sort and Group
   * menus order the rows passes false, so the two do not fight over the order.
   */
  sortable?: boolean
  /** What the list is called in an export's file name; defaults to `label`. */
  exportName?: string
  isLoading?: boolean
  /** Row height in px for a table whose rows hold a picture; default 33. */
  rowHeight?: number
  /** The extra classes a screen's row needs (e.g. a muted cell). */
  rowClassName?: string
  /**
   * The wrapper's own classes. A registry list passes `max-md:hidden` because
   * it has a `MobileList` underneath; a detail-screen table renders at every
   * width, which is what it did before it moved onto the grid.
   */
  className?: string
}

/**
 * What a column needs to take part in header sorting: the shared comparison,
 * and a header that is a button. A column with no value to sort (a menu, a row
 * of buttons) does not sort, and its header stays as the screen wrote it.
 */
function sortingFor<T extends RowData>(
  column: RegistryColumn<T>,
  sortable: boolean,
): Partial<RegistryColumn<T>> {
  const hasValue = 'accessorFn' in column || 'accessorKey' in column
  const canSort = sortable && hasValue && column.enableSorting !== false
  const label = isFunction(column.header) ? undefined : column.header

  const meta = label
    ? { ...column.meta, headerTitle: column.meta?.headerTitle ?? label }
    : column.meta

  if (!canSort) {
    const result: Partial<RegistryColumn<T>> = { enableSorting: false }

    if (label) result.meta = meta

    return result
  }

  const right = Boolean(column.meta?.headerClassName?.includes('text-right'))
  const header = column.header

  return {
    sortFn:
      column.sortFn ??
      ((rowA, rowB, columnId) =>
        compareCells(rowA.getValue(columnId), rowB.getValue(columnId))),
    sortUndefined: 'last',
    meta,
    header: (context) => (
      <SortHeader column={context.column} right={right}>
        {isFunction(header) ? header(context) : header}
      </SortHeader>
    ),
  }
}

export function RegistryGrid<T extends RowData>({
  label,
  rows,
  columns,
  getRowId,
  rowSelection = {},
  onRowSelectionChange,
  onRowClick,
  selectable = true,
  className,
  sorting: sortingProp,
  onSortingChange: onSortingChangeProp,
  view,
  sortable: sortableProp = true,
  exportName,
  rowHeight = 33,
  bulk,
  rowLabel,
  isLoading = false,
}: RegistryGridProps<T>) {
  const sorting = sortingProp ?? view?.sorting

  const onSortingChange: OnChangeFn<SortingState> | undefined =
    onSortingChangeProp ?? view?.setSorting

  // A grouped list's bands are headings between records; ordering the rows
  // would scatter them, so a grouped table keeps the route's order.
  const grouped = rows.some((row) => isBand(row))
  const sortable = sortableProp && sorting !== undefined && !grouped
  const hidden = view?.hidden

  const columnVisibility = useMemo<ColumnVisibilityState>(
    () => Object.fromEntries((hidden ?? []).map((id) => [id, false])),
    [hidden],
  )

  const events = useRegistryEvents({
    getRowId,
    onRowClick,
    onRowSelectionChange,
    onSortingChange,
    view,
  })

  useLinkedRegistrySelection({
    rows,
    getRowId,
    selectable,
    rowSelection,
    onRowSelectionChange,
  })
  const gridRef = useRegistryRowKeys(selectable, rows)

  const recordIdKey = rows
    .flatMap((row) => (isBand(row) ? [] : [getRowId(row)]))
    .join('\u0000')

  const recordIds = useMemo(
    () => (recordIdKey ? recordIdKey.split('\u0000') : []),
    [recordIdKey],
  )

  // The header tick reads these when clicked, so new rows do not rebuild the
  // columns (which would remount every cell).
  const recordIdsRef = useRef(recordIds)
  useLayoutEffect(() => {
    recordIdsRef.current = recordIds
  }, [recordIds])
  // A row that left the list (another tab, a search) is no longer ticked.
  const retain = bulk?.retain
  useEffect(() => {
    // react-doctor-disable-next-line no-pass-data-to-parent -- Committed settled lists prune disappeared bulk IDs; loading lists must retain them.
    if (!isLoading) retain?.(recordIds)
  }, [retain, recordIds, isLoading])
  const bulkIds = new Set(bulk?.ids)
  const ticked = recordIds.filter((id) => bulkIds.has(id))
  const allTicked = recordIds.length > 0 && ticked.length === recordIds.length
  const hasView = Boolean(view)

  const rowById = useMemo(
    () =>
      new Map(
        rows.flatMap((row): [string, T][] =>
          isBand(row) ? [] : [[getRowId(row), row]],
        ),
      ),
    [rows, getRowId],
  )

  const allColumns = useMemo<RegistryColumn<RegistryRow<T>>[]>(() => {
    // SAFETY: The decorated cell below intercepts every band before invoking a record column's renderer.
    const body = columns as RegistryColumn<RegistryRow<T>>[]

    // The menu sits at the end of the header, where it stays put as the
    // table scrolls sideways.
    const tools: RegistryColumn<RegistryRow<T>>[] = hasView
      ? [
          {
            id: VIEW_COLUMN,
            enableSorting: false,
            enableHiding: false,
            enableResizing: false,
            size: 44,
            minSize: 44,
            maxSize: 44,
            meta: {
              headerClassName: 'w-11 text-right',
              cellClassName: 'w-11',
            },
            header: ({ table: instance }) => <RegistryMenu table={instance} />,
            cell: () => null,
          },
        ]
      : []

    if (!bulk) return [...body, ...tools]

    const tick: RegistryColumn<RegistryRow<T>> = {
      id: '__bulk',
      enableSorting: false,
      enableResizing: false,
      // Just wide enough for the box and the table's edge inset.
      size: 48,
      minSize: 48,
      maxSize: 48,
      meta: { headerClassName: 'w-9', cellClassName: 'w-9' },
      header: () => (
        <Checkbox
          aria-label={t('library.bulk.selectAll')}
          checked={allTicked}
          indeterminate={ticked.length > 0 && !allTicked}
          onCheckedChange={(on) => bulk.setMany(recordIdsRef.current, on)}
          onClick={(event) => event.stopPropagation()}
        />
      ),
      cell: ({ row }) => <RegistryTick bulk={bulk} rowId={row.id} />,
    }

    return [tick, ...body, ...tools]
    // `ticked.length` and `allTicked` change the header; the row cells read
    // `bulk.has`, which changes with `bulk`.
  }, [columns, bulk, allTicked, ticked.length, hasView])

  /**
   * A band renders as the muted strip the grouped screens draw: every cell
   * paints it, and the first data column carries the label. Each cell paints
   * its own strip, so the band is continuous across the row — which an HTML
   * table cannot otherwise express without a spanning cell.
   */
  // The tick column carries no label, so a band's label sits in the next one.
  const labelIndex = bulk ? 1 : 0

  const decorated = useMemo<RegistryColumn<RegistryRow<T>>[]>(
    () =>
      allColumns.map((column, index): RegistryColumn<RegistryRow<T>> => {
        const result = { ...column }
        Object.assign(result, sortingFor(column, sortable))
        result.cell = (context) => {
          const original = context.row.original

          if (!isBand(original)) {
            const cell = column.cell

            return isFunction(cell)
              ? cell(context)
              : (context.getValue<ReactNode>() ?? null)
          }

          // Every cell paints the strip, so it reads as one band across the
          // row; the first data column carries the label.
          // The strip reaches over the cell's own padding: 24px at the table's
          // outer edges, 10px between cells.
          const left = index === 0 ? '-ml-6 pl-6' : '-ml-2.5'

          const right = index === allColumns.length - 1 ? '-mr-6' : '-mr-2.5'

          const paint = `block h-[33px] bg-surface-muted ${left} ${right}`

          if (index === labelIndex) {
            return (
              <span
                className={`${paint} flex items-center text-label font-medium text-fg-muted`}
              >
                {original.__band}
                {original.__count !== undefined ? (
                  <span className="ml-1 font-normal">{original.__count}</span>
                ) : null}
              </span>
            )
          }

          if (index === allColumns.length - 1 && original.__action) {
            return (
              <span
                className={`${paint} flex items-center justify-end pr-6 text-label`}
              >
                {original.__action}
              </span>
            )
          }

          return <span className={paint} />
        }

        return result
      }),
    [allColumns, labelIndex, sortable],
  )

  // When a table is wider than its pane, the row's identity and its state
  // should not scroll away from each other: the first column (the ID) holds
  // the start edge and Status holds the end edge. Only columns already at an
  // edge are pinned, because pinning also moves a column to its edge.
  const columnPinning = useMemo(() => {
    const all = allColumns.map((column) => column.id)
    // With tick boxes the ID column is the second one; both hold the edge.
    const first = bulk ? all.slice(0, 2) : all.slice(0, 1)
    // The menu column is always the last; Status holds the edge before it.
    const ids = all.filter((id) => id !== VIEW_COLUMN)
    const last = ids.at(-1)

    return {
      start: first.filter((id): id is string => Boolean(id)),
      end: [
        ...(last === 'status' && ids.length > 2 ? [last] : []),
        ...(all.includes(VIEW_COLUMN) ? [VIEW_COLUMN] : []),
      ],
    }
  }, [allColumns, bulk])

  const state: Partial<TableState<DataGridFeatures>> = {
    rowSelection,
    columnPinning,
  }

  if (sortable) state.sorting = sorting

  if (view) state.columnVisibility = columnVisibility

  const table = useTable({
    features: dataGridFeatures,
    columns: decorated,
    data: rows,
    state,
    onRowSelectionChange: onRowSelectionChange
      ? events.onRowSelectionChange
      : undefined,
    onSortingChange:
      sortable && onSortingChange ? events.onSortingChange : undefined,
    onColumnVisibilityChange: view
      ? events.onColumnVisibilityChange
      : undefined,
    // Bands carry their own id; records go through the screen's own resolver.
    getRowId: (row) => (isBand(row) ? row.id : getRowId(row)),
    // A virtualised grid renders every row, so the paginated row model has to
    // be told the data already is the page; these screens have no server paging.
    manualPagination: true,
    // A band is a heading, not a record: it cannot be selected or clicked.
    enableRowSelection: (row) => !isBand(row.original),
  })

  const renderContext = useMemo(
    () => ({
      name: exportName ?? label,
      view,
      labelForId: (id: string) => {
        const row = rowById.get(id)

        return rowLabel && row ? rowLabel(row) : id
      },
    }),
    [exportName, label, view, rowById, rowLabel],
  )

  return (
    <RegistryRenderContext value={renderContext}>
      <RegistryTable
        table={table}
        gridRef={gridRef}
        rowHeight={rowHeight}
        className={className}
        recordCount={rows.length}
        isLoading={isLoading}
        label={label}
        onRowClick={events.onRowClick}
      />
    </RegistryRenderContext>
  )
}

function RegistryTable<T extends RowData>({
  table,
  gridRef,
  rowHeight,
  className,
  recordCount,
  isLoading,
  label,
  onRowClick,
}: {
  table: DataGridTableInstance<T>
  gridRef: RefObject<HTMLDivElement | null>
  rowHeight: number
  className?: string
  recordCount: number
  isLoading: boolean
  label: string
  onRowClick: (row: T) => void
}) {
  const style: CSSProperties & { '--grid-row-h'?: string } = {}

  if (rowHeight !== 33) style['--grid-row-h'] = `${rowHeight}px`

  return (
    // `[&>*]` stretches the grid's own scroll container: it sizes itself to
    // its rows, which on a short list leaves the horizontal scrollbar floating
    // under the last row instead of at the list area's edge.
    <div
      ref={gridRef}
      style={style}
      className={cn(
        'flex h-full min-h-0 flex-col [&>*]:min-h-0 [&>*]:flex-1',
        className,
      )}
    >
      <DataGrid
        className="min-h-0 flex-1"
        table={table}
        recordCount={recordCount}
        isLoading={isLoading}
        i18n={{ labels: { tableLabel: label } }}
        onRowClick={onRowClick}
        // The rows scroll inside the grid, so a sticky header would hold the
        // band at the top of the list area while scrolling — a behaviour the
        // tables it replaces never had. The header scrolls with the rows.
        tableLayout={{
          width: 'auto',
          headerSticky: false,
          columnsPinnable: true,
        }}
        tableClassNames={{
          // The registry table never wraps: a row is one line, and the scroll
          // area carries the overflow (the v3 table's own rule).
          base: 'num w-full whitespace-nowrap',
          // The v3 table's own geometry, so the swap is invisible: a 31px
          // muted header band, 33px rows, 10px cell padding with the first
          // cell inset to 24px.
          headerRow: 'bg-surface-muted',
          // The th carries its own font and colour, so the header's own
          // classes have to reach it: `text-label` (12px, medium) in
          // `text-fg-muted`, as the v3 table head renders.
          header:
            '[&_th]:h-[31px] [&_th]:px-2.5 [&_th:first-child]:pl-6 [&_th:last-child]:pr-6 [&_th]:text-label [&_th]:text-fg-muted',
          body: '[&_td]:h-[var(--grid-row-h,33px)] [&_td]:py-0 [&_td]:px-2.5 [&_td:first-child]:pl-6 [&_td:last-child]:pr-6',
        }}
      >
        <DataGridScrollArea orientation="both" className="h-full">
          <DataGridTableVirtual
            height="100%"
            estimateSize={rowHeight}
            overscan={12}
          />
        </DataGridScrollArea>
      </DataGrid>
    </div>
  )
}
