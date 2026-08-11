import { formatCount } from './format-numbers'

export type DataGridScalar = string | number | boolean

export type DataGridFilterOperator =
  | 'eq'
  | 'contains'
  | 'neq'
  | 'startsWith'
  | 'lt'
  | 'lte'
  | 'gt'
  | 'gte'
  | 'between'
  | 'in'
  | 'notIn'
  | 'isNull'
  | 'isNotNull'

export interface DataGridFilterValue {
  fieldId: string
  operator: DataGridFilterOperator
  values: DataGridScalar[]
}

export type DataGridValueFormat =
  | { kind: 'text' }
  | { kind: 'scientific'; unit?: string }
  | { kind: 'date'; dateStyle?: 'short' | 'medium' | 'long' }

/** Sheetbase-owned formatting available to every shared data grid. */
export function formatDataGridValue(
  value: unknown,
  format: DataGridValueFormat = { kind: 'text' },
): string {
  if (value === null || value === undefined || value === '') return '—'
  if (format.kind === 'scientific') {
    const numeric = typeof value === 'number' ? value : Number(value)
    const rendered = Number.isFinite(numeric)
      ? formatCount(numeric)
      : String(value)
    return format.unit ? `${rendered} ${format.unit}` : rendered
  }
  if (format.kind === 'date') {
    const date = value instanceof Date ? value : new Date(String(value))
    if (Number.isNaN(date.getTime())) return String(value)
    return new Intl.DateTimeFormat('en-GB', {
      dateStyle: format.dateStyle ?? 'medium',
    }).format(date)
  }
  return String(value)
}
