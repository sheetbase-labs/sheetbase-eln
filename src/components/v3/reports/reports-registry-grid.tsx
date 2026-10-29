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
import { ObjectLink } from '#/components/v3/ui/object-link'
import { Status } from '#/components/v3/ui/status'
import { reportStatus } from '#/lib/reports'
import type { ReportListRow } from '#/lib/reports'
import { formatDate } from '#/lib/format-date'
import { t } from '#/copy'

function compareRegistryText(a: unknown, b: unknown): number {
  return String(a ?? '').localeCompare(String(b ?? ''), 'en-GB', {
    numeric: true,
  })
}

export interface ReportsRegistryGridProps {
  rows: ReportListRow[]
  ownerLabel: (userId: string) => string
  isLoading?: boolean
  sorting: SortingState
  onSortingChange: OnChangeFn<SortingState>
  rowSelection: RowSelectionState
  onRowSelectionChange: OnChangeFn<RowSelectionState>
  onOpen: (row: ReportListRow, event?: React.MouseEvent) => void
}

/** The reports list's columns, through the one registry grid. */
export function ReportsRegistryGrid({
  rows,
  ownerLabel,
  isLoading = false,
  sorting,
  onSortingChange,
  rowSelection,
  onRowSelectionChange,
  onOpen,
}: ReportsRegistryGridProps) {
  const columns = useMemo<ColumnDef<DataGridFeatures, ReportListRow>[]>(
    () => [
      {
        id: 'identifier',
        accessorFn: (r) => r.identifier,
        header: t('projects.reports.grid.id'),
        enableHiding: false,
        sortFn: (a, b, id) =>
          compareRegistryText(a.getValue(id), b.getValue(id)),
        cell: ({ row }) => (
          <ObjectLink
            kind="report"
            id={row.original.recordId}
            identifier={row.original.identifier}
          />
        ),
      },
      {
        id: 'title',
        accessorFn: (r) => r.title,
        header: t('projects.reports.grid.report'),
        meta: { cellClassName: 'min-w-[220px]' },
        sortFn: (a, b, id) =>
          compareRegistryText(a.getValue(id), b.getValue(id)),
        cell: ({ row }) => (
          <Link
            to="/reports/$reportId"
            params={{ reportId: row.original.recordId }}
            onClick={(event) => onOpen(row.original, event)}
          >
            {row.original.title}
          </Link>
        ),
      },
      {
        id: 'project',
        accessorFn: (r) => r.projectTitle ?? '',
        header: t('projects.reports.grid.project'),
        meta: { cellClassName: 'text-fg-muted' },
        sortFn: (a, b, id) =>
          compareRegistryText(a.getValue(id), b.getValue(id)),
      },
      {
        id: 'status',
        accessorFn: (r) => reportStatus(r.status).label,
        header: t('projects.reports.grid.status'),
        sortFn: (a, b, id) =>
          compareRegistryText(a.getValue(id), b.getValue(id)),
        cell: ({ row }) => {
          const status = reportStatus(row.original.status)
          return <Status tone={status.tone}>{status.label}</Status>
        },
      },
      {
        id: 'sections',
        accessorFn: (r) => r.sectionCount,
        header: t('projects.reports.grid.sections'),
        meta: {
          ...rightAligned<ReportListRow>().meta,
          cellClassName: 'num text-right text-fg-muted',
        },
      },
      {
        id: 'owner',
        accessorFn: (r) => ownerLabel(r.createdByUserId),
        header: t('projects.reports.grid.owner'),
        meta: { cellClassName: 'text-fg-muted' },
        sortFn: (a, b, id) =>
          compareRegistryText(a.getValue(id), b.getValue(id)),
      },
      {
        id: 'updatedAt',
        accessorFn: (r) => r.updatedAt,
        header: t('projects.reports.grid.updated'),
        meta: {
          ...rightAligned<ReportListRow>().meta,
          cellClassName: 'text-right text-fg-muted',
        },
        sortFn: (a, b, id) =>
          compareRegistryText(a.getValue(id), b.getValue(id)),
        cell: ({ row }) => formatDate(row.original.updatedAt),
      },
    ],
    [ownerLabel, onOpen],
  )

  return (
    <RegistryGrid
      className="max-md:hidden"
      label={t('projects.reports.grid.label')}
      rows={rows}
      columns={columns}
      getRowId={(r) => r.recordId}
      rowSelection={rowSelection}
      onRowSelectionChange={onRowSelectionChange}
      onRowClick={onOpen}
      sorting={sorting}
      onSortingChange={onSortingChange}
      isLoading={isLoading}
    />
  )
}
