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
import { Status } from '#/components/v3/ui/status'
import type { Tone } from '#/components/v3/ui/status'
import type { NotebookRecord } from '#/lib/notebook-data'

/**
 * The protocols registry's grid: `@reui/data-grid`, installed from the pinned
 * base-nova registry (ADR-0055) and placed under `src/components/reui/`. It
 * replaces the bespoke `v3/ui/table` body the registry screens hand-rolled.
 *
 * The grid is rendered flush, like every other table screen: no card, no
 * inset, and the screen keeps its own `ListFooter` underneath. The registry's
 * `Frame` wrapper is deliberately not used here — it framed the table as a
 * floating card, which is a redesign of the list chrome rather than a swap of
 * the table.
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
  })

  return (
    <div className="flex h-full min-h-0 flex-col max-lg:hidden">
      <DataGrid
        table={table}
        recordCount={rows.length}
        isLoading={isLoading}
        i18n={{ labels: { tableLabel: 'Protocols' } }}
        onRowClick={(p) => onRowSelectionChange({ [p.id]: true })}
        tableLayout={{
          width: 'auto',
          headerSticky: true,
        }}
        tableClassNames={{
          // The registry table never wraps: a row is one line, and the
          // scroll area carries the overflow (the v3 table's own rule).
          base: 'w-full whitespace-nowrap',
          // The v3 table's header band: the app's lists have a muted header
          // across the full width, not a white sticky header with a blur.
          headerRow: 'bg-surface-muted',
          header: 'text-fg-muted',
        }}
      >
        <DataGridScrollArea orientation="both">
          <DataGridTableVirtual height="100%" estimateSize={33} overscan={12} />
        </DataGridScrollArea>
      </DataGrid>
    </div>
  )
}
