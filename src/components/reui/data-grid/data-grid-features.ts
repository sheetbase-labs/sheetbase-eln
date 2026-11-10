/**
 * The column contracts, feature bundle and table type of the ReUI data grid,
 * moved out of `data-grid.tsx` by the strict-lint migration (ADR-0057).
 *
 * They live here because a React component module may export only components
 * and hooks (`react-doctor/only-export-components`): these are values and
 * types, so they get their own module and `data-grid.tsx` re-exports them,
 * keeping every existing import path working.
 */

import type { ReactNode } from 'react'
import type { ReactTable } from '@tanstack/react-table'
import {
  cellSelectionFeature,
  columnFacetingFeature,
  columnFilteringFeature,
  columnOrderingFeature,
  columnPinningFeature,
  columnResizingFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  createExpandedRowModel,
  createFacetedRowModel,
  createFacetedUniqueValues,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  globalFilteringFeature,
  metaHelper,
  rowExpandingFeature,
  rowPaginationFeature,
  rowPinningFeature,
  rowSelectionFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_alphanumericCaseSensitive,
  sortFn_basic,
  sortFn_datetime,
  sortFn_text,
  sortFn_textCaseSensitive,
  tableFeatures,
} from '@tanstack/react-table'
import type { DataGridValue } from '#/lib/data-grid'

/**
 * Per-column extras the grid reads off `columnDef.meta`.
 *
 * TanStack v9 resolves this through the `columnMeta` slot on the feature
 * bundle below instead of a global `declare module` augmentation, so
 * installing the data grid no longer widens `ColumnMeta` for every other
 * table in the consuming app.
 */
/**
 * Per-column write contract for the spreadsheet operations (paste, fill,
 * clear, cut). Presence marks the column writable; every write still flows
 * through `onCellsChange`, so the consumer's state stays the only data owner.
 */
export interface DataGridColumnCellEdit<TData> {
  /**
   * Set false for a column that formats clipboard output but is never
   * written; a function decides per row, so locked rows (archived, another
   * user's, a totals row) reject like any read-only cell. Defaults to true.
   */
  editable?: boolean | ((row: TData) => boolean)
  /**
   * Clipboard or fill string to typed value. Return undefined to reject the
   * cell into `rejected`. Without it the raw string passes through unchanged -
   * a deliberate non-coercion, so a number column receives strings only when
   * the consumer chose not to parse.
   */
  parse?: (raw: string, row: TData) => DataGridValue
  /** Typed value to clipboard string. Fallback: String(value ?? ""). */
  format?: (value: DataGridValue, row: TData) => string
  /** Value dispatched by Delete/Backspace and cut. Defaults to null. */
  clearValue?: unknown
  /**
   * Opt into the grid's built-in free-text editor: an overlay input (or
   * auto-growing textarea) flush over the focused cell, opened by Enter, F2,
   * typing, or double-click, committing through `onCellsChange` as source
   * `"edit"` with `parse` applied. Columns without it stay consumer-edited
   * via `onCellEditRequest` or their own cell renderers.
   */
  control?: 'text' | 'textarea'
}

export interface DataGridColumnMeta<TData> {
  headerTitle?: string
  headerClassName?: string
  cellClassName?: string
  skeleton?: ReactNode
  expandedContent?: (row: TData) => ReactNode
  autoSize?: boolean
  /**
   * What an export writes for this column's cell, when the cell shows more
   * than the column's value (a link, a status chip). Without it the export
   * writes the column's accessor value; a column with neither is left out.
   */
  exportValue?: (row: TData) => string | number | boolean | null | undefined
  /** Header spans this many leaves: this one and its next adjacent siblings. */
  headerColSpan?: number
  cellEdit?: DataGridColumnCellEdit<TData>
  /**
   * Under `columnsResizable`, this column absorbs the free space the filler
   * strip would otherwise hold, so the grid always reads full-width and the
   * built-in editor covers the whole cell. One column per grid; while free
   * space remains, manual resizing of this column is visually a no-op (the
   * absorbed space compensates), the flex-column trade-off.
   */
  fillWidth?: boolean
}

/**
 * The batteries-included feature bundle every ReUI data-grid example builds
 * on. v9 requires each table to declare its features up front, and the grid's
 * render path needs the ones registered here: `columnVisibilityFeature` alone
 * gates `row.getVisibleCells()`, so even a grid that never hides a column
 * needs it to render at all.
 *
 * Pass it straight through for the full grid:
 *
 * ```tsx
 * const table = useTable({ features: dataGridFeatures, columns, data })
 * ```
 *
 * Extend it when a grid needs more, keeping each prerequisite feature ahead of
 * the slot that depends on it:
 *
 * ```tsx
 * const features = tableFeatures({
 *   ...dataGridFeatures,
 *   columnGroupingFeature,
 *   groupedRowModel: createGroupedRowModel(),
 * })
 * ```
 *
 * Or drop it entirely and hand `<DataGrid>` a leaner table - the components
 * accept any bundle, so you keep full ownership of the TanStack core.
 */
export const dataGridFeatures = tableFeatures({
  columnVisibilityFeature,
  columnOrderingFeature,
  columnPinningFeature,
  columnSizingFeature,
  // columnResizingFeature requires columnSizingFeature, declared above.
  columnResizingFeature,
  columnFilteringFeature,
  // Powers DataGridColumnFilter's column.getFacetedUniqueValues(). On v8 an
  // unregistered facet silently returned an empty map; on v9 the method would
  // not exist at all, so the faceted row models below are required, not
  // optional.
  columnFacetingFeature,
  // globalFilteringFeature requires columnFilteringFeature, declared above.
  globalFilteringFeature,
  rowSortingFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  rowExpandingFeature,
  rowPinningFeature,
  // Registration alone is inert: it seeds a `cellSelection: []` slice and
  // prototype methods but binds no DOM handlers, so grids without
  // `tableLayout.cellSelection` render and behave exactly as before.
  cellSelectionFeature,
  sortedRowModel: createSortedRowModel(),
  filteredRowModel: createFilteredRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  expandedRowModel: createExpandedRowModel(),
  facetedRowModel: createFacetedRowModel(),
  facetedUniqueValues: createFacetedUniqueValues(),
  // Every built-in v9 ships. A string `sortFn` resolves against this map
  // alone, and `sortFn: "auto"` infers a name ("alphanumeric", "text" or
  // "datetime") from the first row's value - so a partial map makes auto
  // sorting warn and silently fall back on ordinary string columns.
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    alphanumericCaseSensitive: sortFn_alphanumericCaseSensitive,
    basic: sortFn_basic,
    datetime: sortFn_datetime,
    text: sortFn_text,
    textCaseSensitive: sortFn_textCaseSensitive,
  },
  columnMeta: metaHelper<DataGridColumnMeta<any>>(),
})

/** The feature set `dataGridFeatures` registers. */
export type DataGridFeatures = typeof dataGridFeatures

/**
 * The grid's internal view of the table.
 *
 * `TFeatures` is invariant in v9 and an unresolved generic one collapses to a
 * union that includes the bare core arm, so no generic signature can call
 * `getVisibleCells()`, `getStartVisibleLeafColumns()` and friends. The public
 * components stay generic so consumers can pass any bundle they like; the
 * table is widened to this concrete type exactly once, on the way into
 * context, and every internal component reads it from there.
 */
export type DataGridTableInstance<TData extends object> = ReactTable<
  DataGridFeatures,
  TData
>
