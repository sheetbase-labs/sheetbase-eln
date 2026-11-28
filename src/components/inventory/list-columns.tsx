/**
 * The columns every record list ends with: Status, Owner and Updated, in that
 * order, drawn the same way on every list. A list names where each value lives
 * on its rows; how it reads, sorts, groups and exports is decided here once.
 *
 * Owner is a face and a name (`Person`), Updated is the workspace's date, and
 * Status is the ring and its word. Each column has a value, so the toolbar's
 * Sort and Group menus (`useListArrange`) offer it without anything more.
 */
import type { RowData } from '@tanstack/react-table'

import { Person } from '#/components/ui/person'
import { Status } from '#/components/ui/status'
import type { Tone } from '#/components/ui/status'
import { useWorkspaceMemberNames } from '#/components/projects/project-data'
import { t } from '#/copy'
import { formatDate } from '#/lib/format-date'
import type { RegistryColumn } from './registry-grid-data'

export interface ListStatus {
  label: string
  tone: Tone
}

/** A stored status word as a person reads it: "on_hold" reads "On hold". */
export function readableStatus(value: string): string {
  const spaced = value.replaceAll(/[_-]+/g, ' ').trim()

  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

export function statusColumn<T extends RowData>(
  read: (row: T) => ListStatus | null | undefined,
): RegistryColumn<T> {
  return {
    id: 'status',
    header: t('common.filter.status'),
    size: 160,
    accessorFn: (row) => read(row)?.label ?? '',
    cell: ({ row }) => {
      const status = read(row.original)

      return status ? (
        <Status tone={status.tone}>{status.label}</Status>
      ) : (
        <span className="text-fg-muted">—</span>
      )
    },
  }
}

/**
 * Who owns each row, by user id, named from the workspace's members. Pass
 * `names` when the list already holds them; otherwise they are looked up.
 */
export function ownerColumn<T extends RowData>(
  read: (row: T) => string | null | undefined,
  names: ReadonlyMap<string, string> | ((userId: string) => string) | undefined,
  /** What the list calls its owner, when it is not "Owner" ("Asked by"). */
  header: string = t('common.filter.owner'),
): RegistryColumn<T> {
  const nameOf = (row: T) => {
    const id = read(row)

    if (!id || !names) return ''

    return names instanceof Function ? names(id) : (names.get(id) ?? '')
  }

  return {
    id: 'owner',
    header,
    size: 140,
    accessorFn: nameOf,
    cell: ({ row }) => {
      const name = nameOf(row.original)

      return name ? (
        <Person name={name} userId={read(row.original)} />
      ) : (
        <span className="text-fg-muted">—</span>
      )
    },
  }
}

/** The workspace members' names by user id, for `ownerColumn`. */
export function useOwnerNames(): ReadonlyMap<string, string> | undefined {
  return useWorkspaceMemberNames().data
}

/** When the row last changed, as the workspace writes a date. */
export function updatedColumn<T extends RowData>(
  read: (row: T) => string | null | undefined,
  header: string = t('common.filter.updated'),
): RegistryColumn<T> {
  return {
    id: 'updated',
    header,
    size: 124,
    accessorFn: (row) => read(row) ?? '',
    cell: ({ row }) => (
      <span className="text-fg-muted">{formatDate(read(row.original))}</span>
    ),
  }
}
