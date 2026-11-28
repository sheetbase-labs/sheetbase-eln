/**
 * How every list orders and groups its rows: a Sort menu and a Group menu in
 * the toolbar, the same two controls on every list.
 *
 * Nothing is listed per page. The choices come from the table's own columns
 * and the rows it holds: a column with a value sorts, and a column whose
 * values repeat (a status, an owner, a type, a project) groups. A new column
 * on a list is a new way to sort it, and to group it when its values repeat.
 *
 * Sorting is the table's own: the Sort menu and a click on a column header
 * write the same choice. Grouping draws a band above each group, ordered by
 * where its first row sits in the list's own order, with the rows inside in
 * the chosen order.
 */
import { useMemo, useState } from 'react'
import type { Row, RowData } from '@tanstack/react-table'

import { Icon } from '#/components/icons'
import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { t } from '#/copy'
import { useLocalListView } from '#/lib/list-views'
import type { ListView } from '#/lib/list-views'
import type { DataGridFeatures } from '#/components/reui/data-grid/data-grid'
import { bandRow, compareCells } from './registry-grid-data'
import type { RegistryColumn, RegistryRow } from './registry-grid-data'

export interface ArrangeOption {
  value: string
  label: string
}

/** The most groups a column may make and still read as groups, not a list. */
const MAX_GROUPS = 12

/**
 * A toolbar menu button that is its words on a desktop and only its icon on a
 * phone, so search and the view controls share one row there. The words stay
 * as its accessible name.
 */
const PHONE_ICON_TRIGGER = {
  variant: 'quiet',
  size: 'sm',
  className: 'max-md:size-10 max-md:px-0',
} as const

/** A label longer than this on average is prose (a summary), not a category. */
const MAX_GROUP_LABEL = 32

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/

// oxlint-disable-next-line anti-slop/no-unknown-returns -- TanStack accessors return the cell's raw native value; textOf and compareCells are the coercion boundary.
type Accessor<T> = (row: T, index: number) => unknown

/** How a column reads a row's value, when it has one. */
function accessorOf<T extends RowData>(
  column: RegistryColumn<T>,
): Accessor<T> | undefined {
  if ('accessorFn' in column) return column.accessorFn

  if ('accessorKey' in column) {
    const key = String(column.accessorKey)

    // oxlint-disable-next-line anti-slop/no-reflect-get -- A column's accessorKey names a field of the row type the table itself reads the same way.
    return (row) => Reflect.get(Object(row), key)
  }

  return undefined
}

/** The column's name as its header shows it. */
function headerOf<T extends RowData>(
  column: RegistryColumn<T>,
): string | undefined {
  const header = column.header

  if (header !== undefined && !(header instanceof Function))
    return String(header)

  return column.meta?.headerTitle
}

/** A value as a group's band names it; empty values have no name. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw TanStack cell values; this is where they become a band's name.
function textOf(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined

  if (Array.isArray(value)) return textOf(value.map(String).join(', '))

  if (value instanceof Date) return value.toISOString()

  // oxlint-disable-next-line typescript/no-base-to-string -- Cells hold strings, numbers and booleans; String() is how the table itself names them.
  const text = String(value).trim()

  return text === '' ? undefined : text
}

/** A value a person would sort but never group by: a date or a number. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw TanStack cell values, read only to decide whether a column groups.
function isMeasure(value: unknown): boolean {
  if (value instanceof Date) return true

  if (Number.isFinite(value)) return true

  const text = textOf(value)

  return text !== undefined && ISO_DATE.test(text)
}

interface ArrangeColumn<T extends RowData> {
  id: string
  label: string
  read: Accessor<T>
  column: RegistryColumn<T>
}

/** The columns that can order the list: each one with a value and a name. */
function arrangeColumns<T extends RowData>(
  columns: readonly RegistryColumn<T>[],
): ArrangeColumn<T>[] {
  return columns.flatMap((column) => {
    const read = accessorOf(column)
    const label = headerOf(column)
    const id = column.id

    if (!read || !label || !id || column.enableSorting === false) return []

    return [{ id, label, read, column }]
  })
}

/**
 * The columns whose values repeat across the rows, so a group holds more than
 * one of them: never the row's identity or name (the first two columns), a
 * date, a number, or prose.
 */
function groupColumns<T extends RowData>(
  candidates: readonly ArrangeColumn<T>[],
  columns: readonly RegistryColumn<T>[],
  rows: readonly T[],
): ArrangeColumn<T>[] {
  const identity = new Set(columns.slice(0, 2).map((c) => c.id))

  return candidates.filter(({ id, read }) => {
    if (identity.has(id) || rows.length === 0) return false
    const values = rows.map((row, index) => read(row, index))

    if (values.some(isMeasure)) return false
    const texts = values.flatMap((value) => textOf(value) ?? [])

    if (texts.length === 0) return false
    const distinct = new Set(texts)
    const length = texts.reduce((sum, text) => sum + text.length, 0)

    return (
      distinct.size <= MAX_GROUPS &&
      length / texts.length <= MAX_GROUP_LABEL &&
      (distinct.size < texts.length || rows.length <= MAX_GROUPS)
    )
  })
}

/** A row shaped enough for a column's own `sortFn` to read. */
function sortRow<T extends RowData>(
  original: T,
  index: number,
  read: Accessor<T>,
): Row<DataGridFeatures, T> {
  // SAFETY: A column's sortFn reads `original` and `getValue` of the rows it
  // compares; the grouped list sorts outside the table, so it hands it rows
  // with exactly those two.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- A partial Row is all a sortFn reads (see above).
  return {
    original,
    index,
    getValue: () => read(original, index),
  } as unknown as Row<DataGridFeatures, T>
}

/** The comparison the table itself would use for the column. */
function comparer<T extends RowData>(
  { id, read, column }: ArrangeColumn<T>,
  desc: boolean,
): (a: [T, number], b: [T, number]) => number {
  const own = column.sortFn instanceof Function ? column.sortFn : undefined

  return ([a, ia], [b, ib]) => {
    const order = own
      ? own(sortRow(a, ia, read), sortRow(b, ib, read), id)
      : compareCells(read(a, ia), read(b, ib))

    return desc ? -order : order
  }
}

export interface ListArrange<T extends RowData> {
  sort: {
    options: ArrangeOption[]
    value: string | undefined
    desc: boolean
    onChange: (value: string | undefined, desc?: boolean) => void
  }
  group: {
    options: ArrangeOption[]
    value: string | undefined
    onChange: (value: string | undefined) => void
  }
  /** The rows to hand the table: the list's rows, with group bands when grouped. */
  rows: RegistryRow<T>[]
  /** The table's sorting and columns; hand it to the grid as `view`. */
  view: ListView
  /**
   * What the list's `RegistryGrid` takes: the arranged rows, the view, and
   * fixed column widths, under which the row's name takes the spare width.
   */
  grid: {
    rows: RegistryRow<T>[]
    view: ListView
    stableWidths: true
    keepColumns: readonly string[]
  }
}

/** The closing columns every list shares: dropped last when space runs out. */
const KEEP = ['status', 'owner', 'updated', 'updatedAt'] as const

/**
 * The Sort and Group menus' choices for a list, and the rows to show. Pass
 * the list's remembered `view` when it has one; otherwise the choice lasts
 * the visit, as a header click does.
 */
export function useListArrange<T extends RowData>({
  rows,
  columns,
  view: remembered,
}: {
  rows: readonly T[]
  columns: readonly RegistryColumn<T>[]
  view?: ListView
}): ListArrange<T> {
  const visit = useLocalListView()
  const view = remembered ?? visit
  const [groupId, setGroupId] = useState<string>()

  const sortable = useMemo(() => arrangeColumns(columns), [columns])

  const groupable = useMemo(
    () => groupColumns(sortable, columns, rows),
    [sortable, columns, rows],
  )

  const sorted = view.sorting.at(0)
  const sortBy = sortable.find((c) => c.id === sorted?.id)
  const groupBy = groupable.find((c) => c.id === groupId)
  const desc = sorted?.desc === true

  const arranged = useMemo((): RegistryRow<T>[] => {
    if (!groupBy) return [...rows]

    const groups = new Map<string, [T, number][]>()

    rows.forEach((row, index) => {
      const key = textOf(groupBy.read(row, index)) ?? ''
      const members = groups.get(key)

      if (members) members.push([row, index])
      else groups.set(key, [[row, index]])
    })

    const order = sortBy ? comparer(sortBy, desc) : undefined

    const none = t('common.list.notSet', {
      column: groupBy.label.toLowerCase(),
    })

    return [...groups].flatMap(([key, members]) => [
      bandRow(key || none, members.length),
      ...(order ? [...members].sort(order) : members).map(([row]) => row),
    ])
  }, [rows, groupBy, sortBy, desc])

  return {
    sort: {
      options: sortable.map(({ id, label }) => ({ value: id, label })),
      value: sortBy?.id,
      desc,
      onChange: (value, nextDesc) => {
        if (!value) {
          view.setSorting([])

          return
        }

        // A date or a number starts newest or largest first; text from A.
        const column = sortable.find((c) => c.id === value)

        const first = rows.find((row, index) =>
          textOf(column?.read(row, index)),
        )

        const measure =
          column && first !== undefined
            ? isMeasure(column.read(first, rows.indexOf(first)))
            : false

        view.setSorting([{ id: value, desc: nextDesc ?? measure }])
      },
    },
    group: {
      options: groupable.map(({ id, label }) => ({ value: id, label })),
      value: groupBy?.id,
      onChange: setGroupId,
    },
    rows: arranged,
    view,
    grid: { rows: arranged, view, stableWidths: true, keepColumns: KEEP },
  }
}

function MenuItem({
  on,
  onClick,
  children,
}: {
  on: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <DropdownMenuItem
      icon={on ? 'check' : undefined}
      className={on ? '' : 'pl-[30px]'}
      onClick={onClick}
    >
      {children}
    </DropdownMenuItem>
  )
}

/**
 * "Sort: Updated". Lists that keep an order of their own (`listOrder`) offer
 * it first; picking a column again keeps it and the direction items flip it.
 */
export function SortMenu({
  options,
  value,
  desc = false,
  onChange,
  listOrder = false,
}: {
  options: readonly ArrangeOption[]
  value: string | undefined
  desc?: boolean
  onChange: (value: string | undefined, desc?: boolean) => void
  /** Offer the list's own order, for a list that has one. */
  listOrder?: boolean
}) {
  if (options.length === 0) return null
  const current = options.find((o) => o.value === value)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button {...PHONE_ICON_TRIGGER} />}>
        <Icon name="arrowUpDown" size={14} className="md:hidden" />
        <span className="max-md:sr-only">
          {current
            ? t('common.list.sortBy', { by: current.label })
            : t('common.list.sort')}
        </span>
        <Icon name="chevronDown" size={10} className="max-md:hidden" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="max-h-[360px] w-[200px] overflow-auto">
        {listOrder ? (
          <MenuItem on={!current} onClick={() => onChange(undefined)}>
            {t('common.list.listOrder')}
          </MenuItem>
        ) : null}
        {options.map((o) => (
          <MenuItem
            key={o.value}
            on={o.value === value}
            onClick={() =>
              onChange(o.value, o.value === value ? desc : undefined)
            }
          >
            {o.label}
          </MenuItem>
        ))}
        {current && listOrder ? (
          <>
            <DropdownMenuSeparator />
            <MenuItem on={!desc} onClick={() => onChange(current.value, false)}>
              {t('common.list.ascending')}
            </MenuItem>
            <MenuItem on={desc} onClick={() => onChange(current.value, true)}>
              {t('common.list.descending')}
            </MenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** "Group: Status", or "Group" while the list is not grouped. */
export function GroupMenu({
  options,
  value,
  onChange,
}: {
  options: readonly ArrangeOption[]
  value: string | undefined
  onChange: (value: string | undefined) => void
}) {
  if (options.length === 0) return null
  const current = options.find((o) => o.value === value)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button {...PHONE_ICON_TRIGGER} />}>
        <Icon name="layers" size={14} className="md:hidden" />
        <span className="max-md:sr-only">
          {current
            ? t('common.list.groupBy', { by: current.label })
            : t('common.list.group')}
        </span>
        <Icon name="chevronDown" size={10} className="max-md:hidden" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="max-h-[360px] w-[200px] overflow-auto">
        <MenuItem on={!current} onClick={() => onChange(undefined)}>
          {t('common.list.noGroups')}
        </MenuItem>
        {options.map((o) => (
          <MenuItem
            key={o.value}
            on={o.value === value}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </MenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Both menus for a list that uses `useListArrange`. */
export function ArrangeMenus<T extends RowData>({
  arrange,
}: {
  arrange: ListArrange<T>
}) {
  return (
    <>
      <SortMenu {...arrange.sort} listOrder />
      <GroupMenu {...arrange.group} />
    </>
  )
}
