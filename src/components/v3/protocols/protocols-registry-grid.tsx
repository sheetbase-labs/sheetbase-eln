import { useMemo } from 'react'
import { Link } from '@tanstack/react-router'
import type {
  ColumnDef,
  OnChangeFn,
  RowSelectionState,
  SortingState,
} from '@tanstack/react-table'

import type { DataGridFeatures } from '#/components/reui/data-grid/data-grid'
import {
  RegistryGrid,
  rightAligned,
} from '#/components/v3/inventory/registry-grid'
import { Status } from '#/components/v3/ui/status'
import type { Tone } from '#/components/v3/ui/status'
import type { NotebookRecord } from '#/lib/notebook-data'

/**
 * The protocols registry's columns, rendered through the one registry grid
 * (`src/components/v3/inventory/registry-grid.tsx`). The screen's chrome — the
 * flush table, its header band and its `ListFooter` — is that component's, so
 * this file holds only what is specific to protocols.
 *
 * The route's toolbar owns the sort menu and writes the table's sorting state,
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
  /** Open a protocol: from its name link (with the click) or a row click. */
  onOpen: (row: NotebookRecord, event?: React.MouseEvent) => void
}

export function ProtocolsRegistryGrid({
  rows,
  ownerLabel,
  isLoading = false,
  sorting,
  onSortingChange,
  rowSelection,
  onRowSelectionChange,
  onOpen,
}: ProtocolsRegistryGridProps) {
  const columns = useMemo<ColumnDef<DataGridFeatures, NotebookRecord>[]>(
    () => [
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
            onClick={(event) => onOpen(row.original, event)}
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
          ...rightAligned<NotebookRecord>().meta,
          cellClassName: 'text-right text-fg-muted',
        },
        sortFn: (rowA, rowB, columnId) =>
          compareRegistryText(rowA.getValue(columnId), rowB.getValue(columnId)),
        cell: ({ row }) => row.original.updatedAt.slice(0, 10),
      },
    ],
    [ownerLabel, onOpen],
  )

  return (
    <RegistryGrid
      className="max-md:hidden"
      label="Protocols"
      rows={rows}
      columns={columns}
      getRowId={(p) => p.id}
      rowSelection={rowSelection}
      onRowSelectionChange={onRowSelectionChange}
      onRowClick={onOpen}
      sorting={sorting}
      onSortingChange={onSortingChange}
      isLoading={isLoading}
    />
  )
}
