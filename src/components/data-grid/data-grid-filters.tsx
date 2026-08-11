import * as React from 'react'

import { Filters } from '#/components/reui/filters'
import type { Filter as ReuiFilter } from '#/components/reui/filters'
import { Button } from '#/components/ui/button'
import { X } from 'lucide-react'
import type {
  DataGridFilterOperator,
  DataGridFilterValue,
  DataGridScalar,
} from '#/lib/data-grid'
import type { DataGridField } from './data-grid-types'

export interface DataGridFiltersProps<TData> {
  fields: DataGridField<TData>[]
  filters: DataGridFilterValue[]
  onFiltersChange: (filters: DataGridFilterValue[]) => void
  debounceMs?: number
}

export function DataGridFilters<TData>({
  fields,
  filters: controlledFilters,
  onFiltersChange,
  debounceMs = 0,
}: DataGridFiltersProps<TData>) {
  const definitions = fields.filter((field) => field.filter)
  const fromQuery = React.useCallback(
    (): ReuiFilter<DataGridScalar>[] =>
      controlledFilters.map((filter, index) => ({
        id: `data-grid-filter-${index}`,
        field: filter.fieldId,
        operator: filter.operator,
        values: filter.values,
      })),
    [controlledFilters],
  )
  const [filters, setFilters] = React.useState(fromQuery)
  const timeoutRef = React.useRef<number | undefined>(undefined)
  React.useEffect(() => setFilters(fromQuery()), [fromQuery])
  React.useEffect(() => () => window.clearTimeout(timeoutRef.current), [])

  const emit = React.useCallback(
    (next: ReuiFilter<DataGridScalar>[]) => {
      const dataGridFilters = next
        .filter(
          (filter) =>
            filter.values.length > 0 ||
            filter.operator === 'isNull' ||
            filter.operator === 'isNotNull',
        )
        .map((filter) => ({
          fieldId: filter.field,
          operator: filter.operator as DataGridFilterOperator,
          values: filter.values,
        }))
      if (JSON.stringify(dataGridFilters) !== JSON.stringify(controlledFilters))
        onFiltersChange(dataGridFilters)
    },
    [controlledFilters, onFiltersChange],
  )

  function handleChange(next: ReuiFilter<DataGridScalar>[]) {
    const previous = filters
    setFilters(next)
    window.clearTimeout(timeoutRef.current)
    const changed = next.find(
      (filter) =>
        filter.values[0] !==
        previous.find((candidate) => candidate.id === filter.id)?.values[0],
    )
    const definition = definitions.find(
      (candidate) => candidate.id === changed?.field,
    )
    if (changed && definition?.filter?.type === 'text' && debounceMs > 0)
      timeoutRef.current = window.setTimeout(() => emit(next), debounceMs)
    else emit(next)
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Filters
        filters={filters}
        fields={definitions.map((field) => ({
          key: field.id,
          label: field.label,
          placeholder: field.filter?.placeholder,
          type: field.filter?.type,
          options: field.filter?.options,
          operators: field.filter?.operators,
          defaultOperator: field.filter?.operators[0]?.value,
        }))}
        onChange={handleChange}
        allowMultiple={false}
        size="xs"
        i18n={{ addFilter: 'Add filter' }}
      />
      {controlledFilters.length > 0 ? (
        <Button
          variant="ghost"
          size="xs"
          className="text-muted-foreground"
          onClick={() => onFiltersChange([])}
        >
          <X className="size-3.5" />
          Clear all
        </Button>
      ) : null}
    </div>
  )
}
