import {
  columnVisibilityFeature,
  metaHelper,
  rowSortingFeature,
  tableFeatures,
} from '@tanstack/react-table'
import type { ColumnDef, RowData, TableFeatures } from '@tanstack/react-table'

import type {
  DataGridFilterOperator,
  DataGridScalar,
  DataGridValueFormat,
} from '#/lib/data-grid'

/**
 * The column hint this contract reads.
 *
 * v9 types `columnDef.meta` from the feature bundle's `columnMeta` slot, which
 * wins over the global `ColumnMeta` interface — a v8 `declare module`
 * augmentation is ignored by any table built from a bundle, so the type is
 * exported and registered instead. A grid built on another bundle registers
 * its own; see `DataGridFieldFeatures` below.
 */
export interface DataGridColumnMeta {
  dataGridFormat?: DataGridValueFormat
}

/**
 * The features a field-derived grid column needs: a field can be sorted, and a
 * field can be hidden. A grid that needs more declares its own bundle and
 * passes it as `DataGridField`'s second type argument.
 */
export const dataGridFieldFeatures = tableFeatures({
  columnVisibilityFeature,
  rowSortingFeature,
  columnMeta: metaHelper<DataGridColumnMeta>(),
})

/** The feature set `dataGridFieldFeatures` registers. */
export type DataGridFieldFeatures = typeof dataGridFieldFeatures

export interface DataGridFieldFilter {
  type: 'text' | 'select'
  placeholder?: string
  operators: { value: DataGridFilterOperator; label: string }[]
  options?: { value: DataGridScalar; label: string }[]
}

/** The single metadata contract used to derive grid columns and controls. */
export interface DataGridField<
  TData extends RowData,
  TFeatures extends TableFeatures = DataGridFieldFeatures,
> {
  id: string
  label: string
  column?: ColumnDef<TFeatures, TData, unknown> | false
  filter?: DataGridFieldFilter
  groupable: boolean
}

export interface DataGridIncrementalRows {
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
  loadError?: unknown
}
