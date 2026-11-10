import {
  columnVisibilityFeature,
  createPaginatedRowModel,
  createSortedRowModel,
  metaHelper,
  rowPaginationFeature,
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

// Column width/alignment hints consumed by the TableHead/TableCell renderers
// so the dense grid stays aligned without per-cell className repetition.
//
// v9 types `columnDef.meta` from the feature bundle's `columnMeta` slot, which
// wins over the global `ColumnMeta` interface — a v8 `declare module`
// augmentation is ignored by any table built from a bundle, so the type is
// exported and registered instead.
export interface DataTableColumnMeta {
  className?: string
}

/**
 * The features this table declares. v9 asks every table to name the features
 * it uses up front, and the bundle carries the row models and the `sortFns`
 * registry with them.
 *
 * `sortFns` is load-bearing, not decoration: a string `sortFn` resolves
 * against this registry alone, and the default `sortFn: 'auto'` infers one of
 * its names from the first rows' values — a partial map makes ordinary string
 * columns warn in development and fall back to unsorted order.
 */
export const dataTableFeatures = tableFeatures({
  columnVisibilityFeature,
  rowSortingFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    alphanumericCaseSensitive: sortFn_alphanumericCaseSensitive,
    basic: sortFn_basic,
    datetime: sortFn_datetime,
    text: sortFn_text,
    textCaseSensitive: sortFn_textCaseSensitive,
  },
  columnMeta: metaHelper<DataTableColumnMeta>(),
})

/** The feature set `dataTableFeatures` registers; annotate columns with it. */
export type DataTableFeatures = typeof dataTableFeatures
