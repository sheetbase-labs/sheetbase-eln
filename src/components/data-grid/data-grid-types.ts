import type { RowData } from '@tanstack/react-table'

import type { AppColumnDef } from '#/lib/table-features'
import type {
  DataGridFilterOperator,
  DataGridScalar,
} from '#/lib/data-grid'

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
  column?: AppColumnDef<TData> | false
  filter?: DataGridFieldFilter
  groupable: boolean
}

export interface DataGridIncrementalRows {
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
  loadError?: unknown
}
