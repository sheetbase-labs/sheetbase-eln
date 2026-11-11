import { useCallback, useMemo } from 'react'
import type { ReactNode } from 'react'
import { functionalUpdate } from '@tanstack/react-table'
import type {
  ColumnDef,
  OnChangeFn,
  RowData,
  RowSelectionState,
} from '@tanstack/react-table'
import type { DataGridFeatures } from '#/components/reui/data-grid/data-grid'

/** A column of a registry table. */
export type RegistryColumn<T extends RowData> = ColumnDef<DataGridFeatures, T>

/** A non-selectable heading between groups of records. */
export interface BandRow {
  readonly __band: string
  readonly __count?: number
  readonly __action?: ReactNode
  readonly id: string
}

export type RegistryRow<T> = T | BandRow

export function bandRow(
  label: string,
  count?: number,
  action?: ReactNode,
): BandRow {
  return {
    __band: label,
    __count: count,
    __action: action,
    id: `band:${label}`,
  }
}

/** __band is reserved for headings in the registry's row contract. */
export function isBand<T extends RowData>(row: RegistryRow<T>): row is BandRow {
  return '__band' in row
}

export function rightAligned<T extends RowData>(): Pick<
  RegistryColumn<T>,
  'meta'
> {
  return {
    meta: { headerClassName: 'text-right', cellClassName: 'text-right' },
  }
}

/** Follow the row just turned on, not the first row of a merged selection. */
export function useRowFocus(
  selectedId: string | null,
  setSelectedId: (id: string | null) => void,
) {
  const rowSelection = useMemo<RowSelectionState>(
    () => (selectedId ? { [selectedId]: true } : {}),
    [selectedId],
  )

  const onRowSelectionChange = useCallback<OnChangeFn<RowSelectionState>>(
    (next) => {
      const value = functionalUpdate(next, rowSelection)
      const ids = Object.keys(value)
      const turnedOn = ids.find((id) => !Object.hasOwn(rowSelection, id))
      setSelectedId(turnedOn ?? ids.at(-1) ?? null)
    },
    [rowSelection, setSelectedId],
  )

  return { rowSelection, onRowSelectionChange }
}

/** Native numeric order, otherwise the registry's numeric, case-insensitive collation. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- TanStack cells expose raw native values; preserve the comparator's public coercion boundary.
export function compareCells(a: unknown, b: unknown): number {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Native number pairs deliberately retain NaN and Infinity subtraction, not finite-number validation.
  if (typeof a === 'number' && typeof b === 'number') return a - b

  // oxlint-disable-next-line typescript/no-base-to-string -- Native left-before-right String coercion, including user-defined coercion and throws, is the sorting contract.
  return String(a ?? '').localeCompare(String(b ?? ''), 'en-GB', {
    numeric: true,
    sensitivity: 'base',
  })
}

/**
 * The height of a grid that shows `count` rows but stops at `max` px and
 * scrolls inside: a header band, the rows, and room for the scrollbar. A grid
 * has no height of its own to fill, so a box that only caps it clips its rows.
 */
export function gridHeight(count: number, max: number, rowHeight = 33): number {
  return Math.min(max, 31 + count * rowHeight + 14)
}
