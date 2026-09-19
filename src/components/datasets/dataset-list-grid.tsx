/**
 * Shared Dataset catalogue grid: the `/datasets` list view and the dataset
 * picker dialog render the same searchable, filterable, groupable DataGrid
 * so selecting from a large catalogue never depends on a dropdown.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { functionalUpdate, useTable } from '@tanstack/react-table'

import {
  DataGrid,
  DataGridColumnSelector,
  DataGridFilters,
  DataGridGrouping,
} from '#/components/data-grid'
import type { DataGridField } from '#/components/data-grid'
import type { DataGridFilterValue, DataGridScalar } from '#/lib/data-grid'
import { appTableFeatures, createAppColumnHelper } from '#/lib/table-features'
import type { AppColumnDef } from '#/lib/table-features'
import { Badge, Input } from '#/components/ui'
import { formatRelativeTime } from '#/lib/notebook-data'
import { datasetLifecycleLabel } from '#/lib/dataset-explorer-data'
import type { CanonicalDatasetWire } from '#/lib/dataset-explorer-data'

const datasetListColumnHelper = createAppColumnHelper<CanonicalDatasetWire>()

/** Field accessor backing the list toolbar's filters and grouping. */
function datasetListFieldValue(
  dataset: CanonicalDatasetWire,
  fieldId: string,
): DataGridScalar | null {
  switch (fieldId) {
    case 'name':
      return dataset.name
    case 'schema':
      return dataset.dataset_schema?.name ?? null
    case 'lifecycle':
      return dataset.lifecycle
    case 'fields':
      return dataset.columns.length
    case 'created_at':
      return dataset.created_at ?? null
    default:
      return null
  }
}

/**
 * Client-side equivalent of the registry filter contract. The Dataset list
 * loads all summaries in one shot, so `DataGridFilters` output is applied
 * locally rather than translated into PostgREST params.
 */
function matchesDatasetListFilter(
  dataset: CanonicalDatasetWire,
  filter: DataGridFilterValue,
): boolean {
  const value = datasetListFieldValue(dataset, filter.fieldId)
  const values = filter.values
  switch (filter.operator) {
    case 'isNull':
      return value === null
    case 'isNotNull':
      return value !== null
    case 'eq':
      return values.some((candidate) => candidate === value)
    case 'neq':
      return values.every((candidate) => candidate !== value)
    case 'in':
      return value !== null && values.includes(value)
    case 'notIn':
      return value === null || !values.includes(value)
    case 'contains':
      return (
        value !== null &&
        values.some((candidate) =>
          String(value).toLowerCase().includes(String(candidate).toLowerCase()),
        )
      )
    case 'startsWith':
      return (
        value !== null &&
        values.some((candidate) =>
          String(value)
            .toLowerCase()
            .startsWith(String(candidate).toLowerCase()),
        )
      )
    case 'lt':
    case 'lte':
    case 'gt':
    case 'gte': {
      if (value === null || values.length === 0) return false
      const num = Number(value)
      const bound = Number(values[0])
      if (!Number.isFinite(num) || !Number.isFinite(bound)) return true
      if (filter.operator === 'lt') return num < bound
      if (filter.operator === 'lte') return num <= bound
      if (filter.operator === 'gt') return num > bound
      return num >= bound
    }
    case 'between': {
      if (value === null || values.length < 2) return false
      const num = Number(value)
      const low = Number(values[0])
      const high = Number(values[1])
      if (![num, low, high].every(Number.isFinite)) return true
      return num >= low && num <= high
    }
    default:
      return true
  }
}

export function DatasetsListGrid({
  datasets,
  loading,
  error,
  onSelect,
  selectedId = null,
  emptyFallback,
}: {
  datasets: CanonicalDatasetWire[]
  loading: boolean
  error: unknown
  onSelect: (id: string) => void
  selectedId?: string | null
  /** Rendered while loading, on error, or when there is nothing to list. */
  emptyFallback?: ReactNode
}) {
  const [searchDraft, setSearchDraft] = useState('')
  const [search, setSearch] = useState('')
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  )
  const [filters, setFilters] = useState<DataGridFilterValue[]>([])
  const [grouping, setGrouping] = useState<string[]>([])
  useEffect(() => () => clearTimeout(searchTimer.current), [])

  const fields = useMemo<DataGridField<CanonicalDatasetWire>[]>(() => {
    const schemaNames = [
      ...new Set(
        datasets
          .map((dataset) => dataset.dataset_schema?.name)
          .filter((name): name is string => Boolean(name)),
      ),
    ].sort()
    return [
      {
        id: 'name',
        label: 'Name',
        groupable: false,
        filter: {
          type: 'text',
          placeholder: 'Name contains',
          operators: [{ value: 'contains', label: 'contains' }],
        },
      },
      {
        id: 'schema',
        label: 'Schema',
        groupable: true,
        filter: {
          type: 'select',
          placeholder: 'All schemas',
          operators: [{ value: 'eq', label: 'is' }],
          options: schemaNames.map((name) => ({ value: name, label: name })),
        },
      },
      {
        id: 'lifecycle',
        label: 'Status',
        groupable: true,
        filter: {
          type: 'select',
          placeholder: 'All statuses',
          operators: [{ value: 'eq', label: 'is' }],
          options: [
            { value: 'active', label: 'Live' },
            { value: 'archived', label: 'Archived' },
            { value: 'retired', label: 'Retired' },
          ],
        },
      },
      { id: 'fields', label: 'Fields', groupable: false },
      { id: 'created_at', label: 'Created', groupable: false },
    ]
  }, [datasets])

  const filteredDatasets = useMemo(() => {
    const query = search.trim().toLowerCase()
    return datasets.filter((dataset) => {
      if (query) {
        const haystack =
          `${dataset.name} ${dataset.description ?? ''} ${dataset.dataset_schema?.name ?? ''}`.toLowerCase()
        if (!haystack.includes(query)) return false
      }
      return filters.every((filter) =>
        matchesDatasetListFilter(dataset, filter),
      )
    })
  }, [datasets, search, filters])

  const columns = useMemo<AppColumnDef<CanonicalDatasetWire>[]>(
    () => [
      datasetListColumnHelper.accessor('name', {
        id: 'name',
        header: 'Name',
        size: 320,
        minSize: 200,
        cell: (info) => {
          const dataset = info.row.original
          return (
            <span className="block min-w-0">
              <span className="block truncate text-sm font-medium">
                {dataset.name}
              </span>
              {dataset.description ? (
                <span className="block truncate text-xs text-muted-foreground">
                  {dataset.description}
                </span>
              ) : null}
            </span>
          )
        },
      }),
      datasetListColumnHelper.accessor(
        (dataset) =>
          dataset.dataset_schema
            ? `${dataset.dataset_schema.name} v${dataset.schema_version}`
            : null,
        {
          id: 'schema',
          header: 'Schema',
          size: 200,
          cell: (info) => (
            <span className="text-xs text-muted-foreground">
              {info.getValue() ?? '—'}
            </span>
          ),
        },
      ),
      datasetListColumnHelper.accessor((dataset) => dataset.columns.length, {
        id: 'fields',
        header: 'Fields',
        size: 72,
        cell: (info) => (
          <span className="text-xs tabular-nums text-muted-foreground">
            {info.getValue()}
          </span>
        ),
      }),
      datasetListColumnHelper.accessor('lifecycle', {
        id: 'lifecycle',
        header: 'Status',
        size: 104,
        cell: (info) => (
          <Badge variant="outline">
            {datasetLifecycleLabel(info.getValue())}
          </Badge>
        ),
      }),
      datasetListColumnHelper.accessor('created_at', {
        id: 'created_at',
        header: 'Created',
        size: 104,
        cell: (info) => (
          <span className="text-xs text-muted-foreground">
            {formatRelativeTime(info.getValue())}
          </span>
        ),
      }),
    ],
    [],
  )

  const table = useTable({
    features: appTableFeatures,
    data: filteredDatasets,
    columns,
    getRowId: (dataset) => dataset.id,
    state: { grouping },
    onGroupingChange: (updater) =>
      setGrouping(functionalUpdate(updater, grouping)),
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          aria-label="Search datasets"
          placeholder="Search datasets…"
          className="h-8 w-full sm:w-64"
          value={searchDraft}
          onChange={(event) => {
            const next = event.target.value
            setSearchDraft(next)
            clearTimeout(searchTimer.current)
            searchTimer.current = setTimeout(() => setSearch(next), 300)
          }}
        />
        <DataGridFilters
          fields={fields.filter((field) => field.id !== 'name')}
          filters={filters}
          onFiltersChange={setFilters}
          debounceMs={300}
        />
        <div className="flex items-center gap-2">
          <DataGridGrouping
            fields={fields}
            grouping={grouping}
            onGroupingChange={setGrouping}
          />
          <DataGridColumnSelector table={table} />
        </div>
      </div>
      <DataGrid
        table={table}
        title="Datasets"
        getRowId={(dataset) => dataset.id}
        selectedId={selectedId}
        onRowOpen={onSelect}
        fallback={
          loading || error || datasets.length === 0 ? (
            (emptyFallback ?? null)
          ) : filteredDatasets.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-10 text-center text-sm text-muted-foreground">
              No datasets match the current search or filters.
            </div>
          ) : undefined
        }
      />
    </div>
  )
}
