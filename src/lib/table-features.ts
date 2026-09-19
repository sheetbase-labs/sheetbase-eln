import {
  aggregationFns,
  createColumnHelper,
  createExpandedRowModel,
  createFilteredRowModel,
  createGroupedRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  filterFns,
  sortFns,
  stockFeatures,
  tableFeatures,
} from '@tanstack/react-table'
import type { ColumnDef, RowData, Table } from '@tanstack/react-table'

import type { DataGridValueFormat } from '#/lib/data-grid'

/**
 * Shared TanStack Table v9 feature set. Table v9 parameterises column
 * definitions, table instances and column helpers by the features they
 * register, so every table uses this one set to keep them interchangeable.
 * Stock features plus the row models the app uses mirror Table v8 semantics;
 * registered row models only engage when their state slice is populated and
 * `manual*` options continue to defer work to the server.
 */
// Phantom value for the `columnMeta` feature slot: the object itself is
// ignored, only its type carries into `ColumnDef['meta']`.
const appColumnMeta: {
  className?: string
  dataGridFormat?: DataGridValueFormat
} = {}

export const appTableFeatures = tableFeatures({
  ...stockFeatures,
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  groupedRowModel: createGroupedRowModel(),
  expandedRowModel: createExpandedRowModel(),
  filterFns,
  sortFns,
  aggregationFns,
  columnMeta: appColumnMeta,
})

export type AppTableFeatures = typeof appTableFeatures
// Column defs are parameterised by their cell value type; `any` mirrors the
// v8 `ColumnDef<TData, any>` convention and v9's own `helper.columns()` so
// defs with concrete TValue inference stay assignable to `columns` options.
export type AppColumnDef<TData extends RowData, TValue = any> = ColumnDef<
  AppTableFeatures,
  TData,
  TValue
>
export type AppTable<TData extends RowData> = Table<AppTableFeatures, TData>
export const createAppColumnHelper = <TData extends RowData>() =>
  createColumnHelper<AppTableFeatures, TData>()
