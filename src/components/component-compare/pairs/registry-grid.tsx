import * as React from 'react'
import { useTable } from '@tanstack/react-table'
import type {
  ColumnDef,
  RowSelectionState,
  SortingState,
} from '@tanstack/react-table'

import {
  ComparisonEmptyState,
  ComparisonErrorState,
  ComparisonLoadingRows,
  ComparisonRestrictedNotice,
} from '#/components/component-compare/surface'
import type {
  ComparisonColumnProps,
  ComparisonPair,
  ComparisonRow,
} from '#/components/component-compare/types'
import {
  DataGrid,
  dataGridFeatures,
} from '#/components/reui/data-grid/data-grid'
import type { DataGridFeatures } from '#/components/reui/data-grid/data-grid'
import { DataGridTableVirtual } from '#/components/reui/data-grid/data-grid-table-virtual'
import {
  DataGridTableRowSelect,
  DataGridTableRowSelectAll,
} from '#/components/reui/data-grid/data-grid-table'
import { Frame, FrameFooter, FramePanel } from '#/components/reui/frame'
import { stickyCell, stickyHead } from '#/components/v3/inventory/list'
import { Select } from '#/components/v3/ui/select'
import { Status } from '#/components/v3/ui/status'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'

/**
 * Pair 2 — the registry table.
 *
 * Ours: the registry body as the seven untouched registry screens still ship
 * it — `src/routes/samples.tsx` and its siblings render this markup by hand,
 * inside the shared chrome in `src/components/v3/inventory/list.tsx`: a
 * `v3/ui/table` with a sticky first column, a click-to-select row, and no
 * keyboard path to a selection at all. Sorting is the route's, applied to the
 * array before it reaches the table. This column reproduces that body
 * verbatim, because `/protocols` no longer renders it: the adoption deleted
 * the copy, and the remaining seven screens are the implementation that is
 * still shipped.
 *
 * Theirs: `@reui/data-grid` from the pinned base-nova registry, placed under
 * `src/components/reui/` and wrapped in `@reui/frame`. The grid replaces the
 * body and carries virtualised rows, a pinned identifier column and a row
 * row that a keyboard can select; the frame carries the footer count the
 * screen's `ListFooter` used to.
 *
 * Both columns render the same toolbar control (the shipped `Select`-based
 * sort picker is not the component under comparison) and the same fixture
 * rows, so what differs is the body.
 */

const COLUMNS = ['ID', 'Protocol', 'Status', 'Owner', 'Updated'] as const

/** The registry's collation, as the screen passes it to the grid. */
function compareText(a: unknown, b: unknown): number {
  return String(a ?? '').localeCompare(String(b ?? ''), 'en-GB', {
    numeric: true,
  })
}

const sortFns = {
  registry: (
    rowA: { getValue: (id: string) => unknown },
    rowB: { getValue: (id: string) => unknown },
    columnId: string,
  ) => compareText(rowA.getValue(columnId), rowB.getValue(columnId)),
}

function rowStatus(row: ComparisonRow): string {
  return row.kind ?? '—'
}

/** The sort picker both columns carry: the screen's own control, not the
 * component under comparison. */
function SortPicker({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (next: string) => void
  disabled?: boolean
}) {
  return (
    <label className="flex items-center gap-2 text-label text-fg-muted">
      Sort
      <Select
        aria-label="Sort rows"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="w-[140px]"
      >
        <option value="id">ID</option>
        <option value="name">Protocol</option>
        <option value="kind">Kind</option>
      </Select>
    </label>
  )
}

/** The same value each side sorts on, so the picker means the same thing. */
function sortValue(row: ComparisonRow, key: string): string {
  if (key === 'id') return row.id
  if (key === 'name') return row.name
  return row.kind ?? ''
}

function sortRows(rows: readonly ComparisonRow[], key: string) {
  return [...rows].sort((a, b) =>
    compareText(sortValue(a, key), sortValue(b, key)),
  )
}

/** Ours — the shipped registry body: `v3/ui/table`, sticky first column,
 * click-only row selection. */
function RegistryTableColumn({ scenario }: ComparisonColumnProps) {
  const rows = scenario.fixture.rows
  const [sort, setSort] = React.useState('id')
  const [selected, setSelected] = React.useState<string | null>(null)
  const visible = React.useMemo(() => sortRows(rows, sort), [rows, sort])

  if (scenario.state === 'loading') return <ComparisonLoadingRows />
  if (scenario.state === 'error') {
    return <ComparisonErrorState onRetry={scenario.onRetry} />
  }

  return (
    <div className="flex min-w-0 flex-col gap-2" data-comparison-grid="ours">
      {scenario.state === 'restricted' ? <ComparisonRestrictedNotice /> : null}
      <SortPicker
        value={sort}
        onChange={setSort}
        disabled={scenario.state !== 'ready'}
      />
      {rows.length === 0 ? <ComparisonEmptyState /> : null}
      <div className="min-w-0 overflow-x-auto rounded-md border border-border">
        <Table aria-label="Registry rows">
          <TableHeader>
            <TableRow>
              {COLUMNS.map((label, index) => (
                <TableHead
                  key={label}
                  className={index === 0 ? stickyHead : undefined}
                  align={index === COLUMNS.length - 1 ? 'right' : undefined}
                >
                  {label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((row) => (
              <TableRow
                key={row.id}
                selected={row.id === selected}
                className="cursor-pointer"
                onClick={() => setSelected(row.id)}
              >
                <TableCell className={stickyCell}>
                  <span className="mono">{row.id}</span>
                </TableCell>
                <TableCell className="max-w-[240px] truncate" title={row.name}>
                  {row.name}
                </TableCell>
                <TableCell>
                  <Status tone="ok">{rowStatus(row)}</Status>
                </TableCell>
                <TableCell className="text-fg-muted">
                  {typeof row.value === 'number'
                    ? String(row.value)
                    : (row.value ?? '—')}
                </TableCell>
                <TableCell align="right" className="text-fg-muted">
                  {row.note ?? '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

/** Theirs — `@reui/frame` + `@reui/data-grid`. */
function ReuiDataGridColumn({ scenario }: ComparisonColumnProps) {
  const rows = scenario.fixture.rows
  const [sorting, setSorting] = React.useState<SortingState>([
    { id: 'identifier', desc: false },
  ])
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({})

  const columns = React.useMemo<ColumnDef<DataGridFeatures, ComparisonRow>[]>(
    () => [
      {
        id: 'select',
        header: () => <DataGridTableRowSelectAll />,
        cell: ({ row }) => <DataGridTableRowSelect row={row} />,
        enableSorting: false,
        enableHiding: false,
        size: 40,
      },
      {
        id: 'identifier',
        accessorFn: (row) => row.id,
        header: 'ID',
        sortFn: sortFns.registry,
        cell: ({ row }) => <span className="mono">{row.original.id}</span>,
      },
      {
        id: 'name',
        accessorFn: (row) => row.name,
        header: 'Protocol',
        sortFn: sortFns.registry,
        meta: { cellClassName: 'max-w-[240px] truncate' },
      },
      {
        id: 'kind',
        accessorFn: (row) => row.kind ?? '—',
        header: 'Status',
        sortFn: sortFns.registry,
        cell: ({ row }) => <Status tone="ok">{rowStatus(row.original)}</Status>,
      },
      {
        id: 'value',
        accessorFn: (row) =>
          typeof row.value === 'number'
            ? String(row.value)
            : (row.value ?? '—'),
        header: 'Owner',
        sortFn: sortFns.registry,
        meta: { cellClassName: 'text-fg-muted' },
      },
      {
        id: 'note',
        accessorFn: (row) => row.note ?? '—',
        header: 'Updated',
        sortFn: sortFns.registry,
        meta: {
          headerClassName: 'text-right',
          cellClassName: 'text-right text-fg-muted',
        },
      },
    ],
    [],
  )

  const table = useTable({
    features: dataGridFeatures,
    columns,
    data: [...rows],
    state: { sorting, rowSelection },
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    getRowId: (row) => row.id,
    // The virtual renderer draws every row; the paginated row model would
    // otherwise slice it to a page.
    manualPagination: true,
    enableRowSelection: true,
    initialState: {
      columnPinning: { start: ['select', 'identifier'], end: [] },
    },
  })

  if (scenario.state === 'loading') return <ComparisonLoadingRows />
  if (scenario.state === 'error') {
    return <ComparisonErrorState onRetry={scenario.onRetry} />
  }

  const selectedIds = Object.keys(rowSelection)

  return (
    <div
      className="flex min-w-0 flex-col gap-2"
      data-comparison-grid="theirs"
      data-grid-mechanism="tanstack-table-v9"
    >
      {scenario.state === 'restricted' ? <ComparisonRestrictedNotice /> : null}
      <SortPicker
        value={
          sorting[0]?.id === 'name'
            ? 'name'
            : sorting[0]?.id === 'kind'
              ? 'kind'
              : 'id'
        }
        onChange={(next) =>
          setSorting([{ id: next === 'id' ? 'identifier' : next, desc: false }])
        }
        disabled={scenario.state !== 'ready'}
      />
      {rows.length === 0 ? <ComparisonEmptyState /> : null}
      <Frame spacing="sm" className="min-w-0 overflow-x-auto">
        <FramePanel className="p-0">
          <DataGrid
            table={table}
            recordCount={rows.length}
            i18n={{ labels: { tableLabel: 'Registry rows' } }}
            onRowClick={(row) => setRowSelection({ [row.id]: true })}
            tableLayout={{
              width: 'auto',
              columnsPinnable: true,
              headerSticky: true,
            }}
            tableClassNames={{ base: 'whitespace-nowrap' }}
          >
            <DataGridTableVirtual
              height={420}
              estimateSize={33}
              overscan={12}
            />
          </DataGrid>
        </FramePanel>
        <FrameFooter>
          <div className="flex items-center justify-between gap-4 text-label text-fg-muted">
            <span className="num">{rows.length} rows</span>
            {selectedIds.length ? (
              <span className="num text-fg">{selectedIds.length} selected</span>
            ) : null}
          </div>
        </FrameFooter>
      </Frame>
    </div>
  )
}

export const registryGridPair: ComparisonPair = {
  id: 'registry-grid',
  title: 'Registry table',
  job: 'Render a registry list of rows with sorting, row selection and a pinned first column',
  controls: ['sort', 'select'],
  ours: {
    id: 'ours',
    label:
      'Ours — hand-rolled v3 table body (as the other seven registry screens ship it)',
    source: 'src/routes/samples.tsx (v3/ui/table + v3/inventory/list chrome)',
    Column: RegistryTableColumn,
  },
  theirs: {
    id: 'theirs',
    label: 'Theirs — ReUI Frame + Data Grid (base-nova)',
    source:
      'src/components/reui/frame.tsx, src/components/reui/data-grid/** (registry: @reui/frame, @reui/data-grid)',
    Column: ReuiDataGridColumn,
  },
}
