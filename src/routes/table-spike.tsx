/**
 * SPIKE — sheetbase-table integration (spike/table-engine-integration).
 *
 * Renders one Scientific Table through the `sheetbase-table` engine
 * (`PagedSpreadsheet` + `TableSurface` + `TableControls`) backed by the
 * PostgrestPagedDataAdapter, as a working comparison against the
 * Handsontable surface. Pick a table by ID with `?table=<uuid>`.
 */
import { useMemo, useState } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { useShell } from '#/components/app-shell'
import { scientificDataClient, fetchScientificTable } from '#/lib/scientific-sheet-data'
import type { ScientificTableWire } from '#/lib/scientific-sheet-data'
import { PostgrestPagedDataAdapter } from '#/lib/sheetbase-table/postgrest-paged-adapter'
import {
  PagedSpreadsheet,
  TableControls,
  TableSurface,
  type DatasetQuery,
} from 'sheetbase-table/dev'
import 'sheetbase-table/dev/styles.css'
export const Route = createFileRoute('/table-spike')({
  validateSearch: (search: Record<string, unknown>): { table: string } => ({
    table: typeof search.table === 'string' ? search.table : '',
  }),
  beforeLoad: async ({ context: rootContext }) => {
    if (!rootContext.auth) throw redirect({ to: '/sign-in' })
    return { context: rootContext.auth }
  },
  component: TableSpikeRoute,
})

type EngineDataType = 'text' | 'number' | 'date' | 'boolean'

function toEngineDataType(logicalType: ScientificTableWire['columns'][number]['logical_type']): EngineDataType {
  if (logicalType === 'integer' || logicalType === 'decimal') return 'number'
  if (logicalType === 'boolean') return 'boolean'
  if (logicalType === 'date') return 'date'
  return 'text'
}

function TableSpikeRoute() {
  const { context } = Route.useRouteContext()
  const search = Route.useSearch()
  const tableId = search.table
  const [query, setQuery] = useState<DatasetQuery>({})

  useShell({
    context,
    breadcrumbs: [
      { label: 'Home', to: '/' },
      { label: 'Table engine spike', to: '/table-spike' },
    ],
    fullBleed: true,
  })

  const tableQuery = useQuery({
    queryKey: ['table-spike', tableId],
    queryFn: () => fetchScientificTable(scientificDataClient, tableId),
    enabled: tableId !== '',
  })
  const table = tableQuery.data ?? null

  const adapter = useMemo(
    () => (table ? new PostgrestPagedDataAdapter({ client: scientificDataClient, table }) : null),
    [table],
  )

  const fieldIds = useMemo(() => (table ? table.columns.map((column) => column.field_name) : []), [table])
  const datasetHeader = useMemo(
    () =>
      table
        ? {
            fields: table.columns.map((column, index) => ({
              id: column.field_name,
              label: column.label || column.field_name,
              column: index,
              dataType: toEngineDataType(column.logical_type),
              required: !column.nullable,
              options: column.options.map((option) => option.label),
              multiple: false,
            })),
          }
        : undefined,
    [table],
  )
  const fieldColumns = useMemo(() => new Set(table ? table.columns.map((_, index) => index) : []), [table])

  if (!tableId || !table || !adapter || !datasetHeader) {
    return (
      <main className="stage" style={{ padding: 24 }}>
        <h1 style={{ fontSize: 16, marginBottom: 12 }}>Table engine spike</h1>
        <p style={{ marginBottom: 12, color: '#666' }}>
          Paste a Scientific Table ID to render it with the sheetbase-table engine.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const value = new FormData(event.currentTarget).get('table')
            if (typeof value === 'string' && value.trim() !== '') {
              window.location.search = `?table=${encodeURIComponent(value.trim())}`
            }
          }}
        >
          <input
            name="table"
            placeholder="Scientific table ID"
            style={{ padding: '6px 8px', width: 320, border: '1px solid #ccc', borderRadius: 6 }}
          />{' '}
          <button type="submit">Open</button>
        </form>
        {tableId !== '' && tableQuery.isError && <p style={{ color: '#a23131' }}>Table not found.</p>}
      </main>
    )
  }

  return (
    <main className="stage">
      <TableSurface
        theme="light"
        className="table-spike-surface"
        table={
          <div className="formatted-table">
            <PagedSpreadsheet
              adapter={adapter}
              datasetId={table.id}
              fieldIds={fieldIds}
              rowCount={2_000_000}
              columnCount={fieldIds.length}
              fieldColumns={fieldColumns}
              datasetHeader={datasetHeader}
              query={query}
              onQueryChange={setQuery}
              showLoadTimings
            />
          </div>
        }
        objects={
          [
            {
              id: 'table-spike-query',
              placement: 'bottom' as const,
              size: 180,
              content: (
                <div style={{ padding: 12 }}>
                  <TableControls
                    fields={datasetHeader.fields}
                    query={query}
                    onQueryChange={setQuery}
                    columns={table.columns.map((column) => ({ fieldId: column.field_name }))}
                    onColumnsChange={() => {}}
                    theme="light"
                  />
                  <pre style={{ fontSize: 10, marginTop: 8, whiteSpace: 'pre-wrap' }}>
                    {JSON.stringify(query)}
                  </pre>
                </div>
              ),
            },
          ]
        }
      />
    </main>
  )
}
