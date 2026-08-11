import type { ColumnDef } from '@tanstack/react-table'

import type {
  DataGridFilterOperator,
  DataGridScalar,
  DataGridValueFormat,
} from '#/lib/data-grid'

declare module '@tanstack/react-table' {
  interface ColumnMeta<TData, TValue> {
    dataGridFormat?: DataGridValueFormat
  }
}

export interface DataGridFieldFilter {
  type: 'text' | 'select'
  placeholder?: string
  operators: { value: DataGridFilterOperator; label: string }[]
  options?: { value: DataGridScalar; label: string }[]
}

/** The single metadata contract used to derive grid columns and controls. */
export interface DataGridField<TData> {
  id: string
  label: string
  column?: ColumnDef<TData, unknown> | false
  filter?: DataGridFieldFilter
  groupable: boolean
}

export interface DataGridIncrementalRows {
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
  loadError?: unknown
}
