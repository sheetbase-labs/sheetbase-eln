import { useMemo } from 'react'
import { Link } from '@tanstack/react-router'
import { useTable } from '@tanstack/react-table'
import type {
  ColumnDef,
  OnChangeFn,
  RowSelectionState,
  SortingState,
} from '@tanstack/react-table'

import {
  DataGrid,
  dataGridFeatures,
} from '#/components/reui/data-grid/data-grid'
import type { DataGridFeatures } from '#/components/reui/data-grid/data-grid'
import { DataGridScrollArea } from '#/components/reui/data-grid/data-grid-scroll-area'
import {
  DataGridTableRowSelect,
  DataGridTableRowSelectAll,
} from '#/components/reui/data-grid/data-grid-table'
import { DataGridTableVirtual } from '#/components/reui/data-grid/data-grid-table-virtual'
import { Frame, FrameFooter, FramePanel } from '#/components/reui/frame'
import { Status } from '#/components/v3/ui/status'
import type { Tone } from '#/components/v3/ui/status'
import type { NotebookRecord } from '#/lib/notebook-data'

/**
 * The protocols registry's grid: `@reui/frame` around `@reui/data-grid`, both
 * installed from the pinned base-nova registry (ADR-0055) and placed under
 * `src/components/reui/`. It replaces the bespoke `v3/ui/table` body the
 * registry screens hand-rolled, and the shared `ListFooter` the screen carried
 * below it.
 *
 * What the adoption buys on this screen: rows are virtualised, the identifier
 * column is pinned instead of a `sticky` utility, and a row can be selected
 * from the keyboard through the grid's checkbox column — the bespoke body's
 * selection was click-only.
 *
 * The grid's own sorting is off the columns' `enableSorting` path on purpose:
 * the route's toolbar owns the sort menu and writes the table's sorting state,
 * so there is one owner. The columns pass the registry's collation as a
 * `sortFn` rather than using the bundle's `alphanumeric` built-in, which orders
 * `AAV9…` before `AAV …` where the registry's en-GB collation does not.
 */

/** The status vocabulary the protocols list renders (ADR-0011's component). */
export function protocolStatus(status: string): { tone: Tone; label: string } {
  switch (status) {
    case 'active':
      return { tone: 'ok', label: 'Active' }
    case 'under_review':
      return { tone: 'review', label: 'In review' }
    case 'draft':
      return { tone: 'draft', label: 'Draft' }
    case 'archived':
      return { tone: 'stored', label: 'Archived' }
    default:
      return {
        tone: 'none',
        label:
          status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' '),
      }
  }
}

/** The registry's own collation: en-GB, with numbers in identifiers in their
 * numeric order (PRT-9 before PRT-10). */
function compareRegistryText(a: unknown, b: unknown): number {
  return String(a ?? '').localeCompare(String(b ?? ''), 'en-GB', {
    numeric: true,
  })
}

export interface ProtocolsRegistryGridProps {
  rows: NotebookRecord[]
  /** Total the tab holds, for the frame footer's "n of m" line. */
  total: number
  /** The tab's label, lowercased in the footer. */
  scopeLabel: string
  /** Owner column: user id to display name. */
  ownerLabel: (userId: string) => string
  isLoading?: boolean
  sorting: SortingState
  onSortingChange: OnChangeFn<SortingState>
  rowSelection: RowSelectionState
  onRowSelectionChange: OnChangeFn<RowSelectionState>
}

export function ProtocolsRegistryGrid({
  rows,
  total,
  scopeLabel,
  ownerLabel,
  isLoading = false,
  sorting,
  onSortingChange,
  rowSelection,
  onRowSelectionChange,
}: ProtocolsRegistryGridProps) {
  const columns = useMemo<ColumnDef<DataGridFeatures, NotebookRecord>[]>(
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
        accessorFn: (p) => p.identifier,
        header: 'ID',
        enableHiding: false,
        sortFn: (rowA, rowB, columnId) =>
          compareRegistryText(rowA.getValue(columnId), rowB.getValue(columnId)),
        cell: ({ row }) => (
          <span className="mono">{row.original.identifier}</span>
        ),
      },
      {
        id: 'title',
        accessorFn: (p) => p.title,
        header: 'Protocol',
        meta: { cellClassName: 'min-w-[220px]' },
        sortFn: (rowA, rowB, columnId) =>
          compareRegistryText(rowA.getValue(columnId), rowB.getValue(columnId)),
        cell: ({ row }) => (
          <Link
            to="/protocols/$protocolId"
            params={{ protocolId: row.original.id }}
            onClick={(event) => event.stopPropagation()}
          >
            {row.original.title}
          </Link>
        ),
      },
      {
        id: 'status',
        accessorFn: (p) => protocolStatus(p.status).label,
        header: 'Status',
        sortFn: (rowA, rowB, columnId) =>
          compareRegistryText(rowA.getValue(columnId), rowB.getValue(columnId)),
        cell: ({ row }) => {
          const status = protocolStatus(row.original.status)
          return <Status tone={status.tone}>{status.label}</Status>
        },
      },
      {
        id: 'owner',
        accessorFn: (p) => ownerLabel(p.createdByUserId),
        header: 'Owner',
        meta: { cellClassName: 'text-fg-muted' },
        sortFn: (rowA, rowB, columnId) =>
          compareRegistryText(rowA.getValue(columnId), rowB.getValue(columnId)),
      },
      {
        id: 'updatedAt',
        accessorFn: (p) => p.updatedAt,
        header: 'Updated',
        meta: {
          headerClassName: 'text-right',
          cellClassName: 'text-right text-fg-muted',
        },
        sortFn: (rowA, rowB, columnId) =>
          compareRegistryText(rowA.getValue(columnId), rowB.getValue(columnId)),
        cell: ({ row }) => row.original.updatedAt.slice(0, 10),
      },
    ],
    [ownerLabel],
  )

  const table = useTable({
    features: dataGridFeatures,
    columns,
    data: rows,
    state: { sorting, rowSelection },
    onSortingChange,
    onRowSelectionChange,
    getRowId: (p) => p.id,
    // A virtualised grid renders every row, so the paginated row model has to
    // be told the data already is the page; this route has no server paging.
    manualPagination: true,
    enableRowSelection: true,
    initialState: {
      columnPinning: { start: ['select', 'identifier'], end: [] },
    },
  })

  const selectedIds = Object.keys(rowSelection)

  return (
    <Frame spacing="sm" className="h-full max-lg:hidden">
      <FramePanel className="flex min-h-0 flex-col p-0">
        <DataGrid
          table={table}
          recordCount={rows.length}
          isLoading={isLoading}
          i18n={{ labels: { tableLabel: 'Protocols' } }}
          onRowClick={(p) => onRowSelectionChange({ [p.id]: true })}
          tableLayout={{
            width: 'auto',
            columnsPinnable: true,
            headerSticky: true,
          }}
          tableClassNames={{
            // The registry table never wraps: a row is one line, and the
            // scroll area carries the overflow (the v3 table's own rule).
            base: 'whitespace-nowrap',
          }}
        >
          <DataGridScrollArea orientation="both">
            <DataGridTableVirtual
              height="100%"
              estimateSize={33}
              overscan={12}
            />
          </DataGridScrollArea>
        </DataGrid>
      </FramePanel>
      <FrameFooter>
        <div className="flex items-center justify-between gap-4 text-label text-fg-muted">
          <span className="num">
            {rows.length} of {total} {scopeLabel}
          </span>
          {selectedIds.length ? (
            <span className="num text-fg">{selectedIds.length} selected</span>
          ) : null}
        </div>
      </FrameFooter>
    </Frame>
  )
}
