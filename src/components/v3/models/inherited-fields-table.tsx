import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { Icon } from '#/components/v3/icons'
import { TableCell, TableRow } from '#/components/v3/ui/table'
import { Tooltip } from '#/components/v3/ui/tooltip'
import { cn } from '#/lib/utils'
import { bandRow } from '#/components/v3/inventory/registry-grid'
import type { BandRow } from '#/components/v3/inventory/registry-grid'
import { t } from '#/copy'

/** A field a subtype gets from a model above it: shown, never edited here. */
export interface InheritedRow {
  readonly __inherited: true
  id: string
  label: string
  /** The stored key, when the field has one (standard fields do not). */
  key: string | null
  type: string
  unit: string | null
  required: string
  source: { id: string; name: string }
}

export interface InheritedGroup {
  /** The model the fields come from, by its route id. */
  modelId: string
  modelName: string
  rows: Omit<InheritedRow, '__inherited' | 'source'>[]
}

export function isInherited(row: unknown): row is InheritedRow {
  return typeof row === 'object' && row !== null && '__inherited' in row
}

function ChangeOn({ source }: { source: InheritedRow['source'] }) {
  return (
    <Link
      to="/models/$modelId"
      params={{ modelId: source.id }}
      className="text-link hover:underline"
    >
      {t('library.models.inheritedFieldsTable.changeOn', { name: source.name })}
    </Link>
  )
}

/**
 * The inherited part of a fields table, from the top of the chain down: a
 * band per source model, then its fields. A screen puts its own fields after.
 */
export function inheritedRows(
  groups: readonly InheritedGroup[],
): (InheritedRow | BandRow)[] {
  return groups
    .filter((group) => group.rows.length > 0)
    .flatMap((group) => {
      const source = { id: group.modelId, name: group.modelName }
      return [
        bandRow(
          t('library.models.shared.fromName', { name: group.modelName }),
          group.rows.length,
          <ChangeOn source={source} />,
        ),
        ...group.rows.map((row): InheritedRow => ({
          ...row,
          __inherited: true,
          source,
        })),
      ]
    })
}

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
  return inheritedRows(groups).map((row) =>
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
  )
}
