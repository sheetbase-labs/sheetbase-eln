import type { ReactNode } from 'react'

import { Icon } from '#/components/icons'
import { TableCell, TableRow } from '#/components/ui/table'
import { Tooltip } from '#/components/ui/tooltip'
import { cn } from '#/lib/utils'
import { inheritedRows, isInherited } from './inherited-fields-data'
import type { InheritedRow, InheritedGroup } from './inherited-fields-data'
import { t } from '#/copy'

/** An inherited field's name: muted, with a lock that says where it lives. */
export function InheritedLabel({ row }: { row: InheritedRow }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-fg-muted">
      <Tooltip
        content={t(
          'library.models.inheritedFieldsTable.comesFromChangeItThere',
          { name: row.source.name },
        )}
      >
        <span className="inline-flex text-fg-faint">
          <Icon name="lock" size={12} />
        </span>
      </Tooltip>
      {row.label}
    </span>
  )
}

/** A group heading row in an editor's plain table, across every column. */
export function TableBand({
  label,
  count,
  action,
  colSpan,
  className,
}: {
  label: string
  count?: number
  action?: ReactNode
  colSpan: number
  className?: string
}) {
  return (
    <TableRow>
      <TableCell
        colSpan={colSpan}
        className={cn('bg-surface-muted', className)}
      >
        <span className="flex items-center justify-between gap-3 text-label">
          <span className="font-semibold">
            {label}
            {count !== undefined ? (
              <span className="ml-1 font-normal text-fg-muted">{count}</span>
            ) : null}
          </span>
          {action}
        </span>
      </TableCell>
    </TableRow>
  )
}

/**
 * The same rows for an editor's plain table: `cells` gives one inherited
 * field's cells, and each band spans `colSpan` columns.
 */
export function InheritedTableRows({
  groups,
  colSpan,
  cells,
  bandClassName,
}: {
  groups: readonly InheritedGroup[]
  colSpan: number
  cells: (row: InheritedRow) => ReactNode
  bandClassName?: string
}) {
  return (
    <>
      {inheritedRows(groups).map((row) =>
        isInherited(row) ? (
          <TableRow key={row.id}>{cells(row)}</TableRow>
        ) : (
          <TableBand
            key={row.id}
            label={row.__band}
            count={row.__count}
            action={row.__action}
            colSpan={colSpan}
            className={bandClassName}
          />
        ),
      )}
    </>
  )
}
