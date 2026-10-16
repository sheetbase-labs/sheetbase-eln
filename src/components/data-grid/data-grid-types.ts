import {
  columnVisibilityFeature,
  metaHelper,
  tableFeatures,
} from '@tanstack/react-table'
import type { CellData, ColumnDef, RowData } from '@tanstack/react-table'

import type {
  DataGridFilterOperator,
  DataGridScalar,
  DataGridValueFormat,
} from '#/lib/data-grid'

/**
 * The column metadata the shared grid's renderers read. v9 has no global
 * column-meta augmentation, so the contract is declared here and registered by
 * the grid's own feature bundle; a table sees it only when built with that
 * bundle.
 */
export interface DataGridColumnMeta {
  dataGridFormat?: DataGridValueFormat
}

/**
 * The feature set every column definition in this module is typed against.
 * A grid extends it by spreading its bundle and overriding `columnMeta` with a
 * superset of `DataGridColumnMeta`, keeping the prerequisite features ahead of
 * the slots that need them.
 */
export const dataGridFeatures = tableFeatures({
  // `enableHiding` on a column needs the visibility feature, and it also gates
  // `row.getVisibleCells()`, so every grid bundle carries it.
  columnVisibilityFeature,
  columnMeta: metaHelper<DataGridColumnMeta>(),
})

/** The features `dataGridFeatures` registers. */
export type DataGridFeatures = typeof dataGridFeatures

export interface DataGridFieldFilter {
  type: 'text' | 'select'
  placeholder?: string
  operators: { value: DataGridFilterOperator; label: string }[]
  options?: { value: DataGridScalar; label: string }[]
}

/** The single metadata contract used to derive grid columns and controls. */
export interface DataGridField<TData extends RowData> {
  id: string
  label: string
  column?: ColumnDef<DataGridFeatures, TData, CellData> | false
  filter?: DataGridFieldFilter
  groupable: boolean
}

export interface DataGridIncrementalRows {
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
  loadError?: unknown
}
