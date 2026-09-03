/**
 * PHASE 1 — SheetTableBlock: a Notebook `table` block that embeds a
 * Scientific Table rendered by the sheetbase-table engine. The block mounts
 * `TableSurface` with the typed filter controls as its bottom inspector
 * surface object, and runs under host calculation authority: `=...` inputs
 * stay inert and computed values arrive through hydration.
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  PagedSpreadsheet,
  TableControls,
  TableSurface,
  type DatasetQuery,
} from 'sheetbase-table/dev'
import { LockedSheetBadge } from '@sheetbase/table-eln'

import { Button, Input } from '#/components/ui'
import {
  fetchScientificTable,
  scientificDataClient,
} from '#/lib/scientific-sheet-data'
import type { ScientificTableWire } from '#/lib/scientific-sheet-data'
import { PostgrestPagedDataAdapter } from '#/lib/sheetbase-table/postgrest-paged-adapter'
import type { NotebookBlock } from '#/lib/notebook-data'

export function tableIdFromPayload(block: NotebookBlock): string {
  const value = block.payload.tableId
  return typeof value === 'string' ? value : ''
}

type EngineDataType = 'text' | 'number' | 'date' | 'boolean'

function toEngineDataType(
  logicalType: ScientificTableWire['columns'][number]['logical_type'],
): EngineDataType {
  if (logicalType === 'integer' || logicalType === 'decimal') return 'number'
  if (logicalType === 'boolean') return 'boolean'
  if (logicalType === 'date') return 'date'
  return 'text'
}

/** The column's unit jsonb carries the display symbol when a unit is set. */
function unitSymbol(unit: unknown): string | undefined {
  if (unit && typeof unit === 'object' && 'symbol' in unit) {
    const symbol = (unit as { symbol?: unknown }).symbol
    if (typeof symbol === 'string' && symbol.trim() !== '') return symbol
  }
  return undefined
}

/** Handsontable-style `0.00` formats map onto engine display precision. */
function precisionFromFormat(format: string | null | undefined): number | undefined {
  const match = /^0\.(0+)/.exec(format ?? '')
  return match ? match[1].length : undefined
}

export function NotebookTableBlock({
  block,
  readOnly = false,
  onSavePayload,
}: {
  block: NotebookBlock
  readOnly?: boolean
  onSavePayload(payload: Record<string, unknown>): void | Promise<void>
}) {
  const tableId = tableIdFromPayload(block)
  const [draftId, setDraftId] = useState(tableId)
  const [query, setQuery] = useState<DatasetQuery>({})

  const tableQuery = useQuery({
    queryKey: ['notebook-table-block', tableId],
    queryFn: () => fetchScientificTable(scientificDataClient, tableId),
    enabled: tableId !== '',
  })
  const table = tableQuery.data ?? null

  const adapter = useMemo(
    () =>
      table
        ? new PostgrestPagedDataAdapter({ client: scientificDataClient, table })
        : null,
    [table],
  )
  const fieldIds = useMemo(
    () => (table ? table.columns.map((column) => column.field_name) : []),
    [table],
  )
  const datasetHeader = useMemo(
    () =>
      table
        ? {
            fields: table.columns.map((column, index) => ({
              id: column.field_name,
              label: column.label || column.field_name,
              column: index,
              dataType: toEngineDataType(column.logical_type),
              writable: !readOnly,
              required: !column.nullable,
              options: column.options.map((option) => option.label),
              multiple: false,
              unit: unitSymbol(column.unit),
              precision: precisionFromFormat(column.format),
              numberFormat:
                column.logical_type === 'integer' || column.logical_type === 'decimal'
                  ? ('number' as const)
                  : undefined,
            })),
          }
        : undefined,
    [table],
  )

  if (tableId === '') {
    return (
      <form
        className="space-y-2 p-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (draftId.trim() === '') return
          void onSavePayload({ ...block.payload, tableId: draftId.trim() })
        }}
      >
        <p className="text-sm text-muted-foreground">
          Embed a Scientific Table, rendered by the table engine with live
          filters. Paste the table's ID to attach it.
        </p>
        <div className="flex items-center gap-2">
          <Input
            value={draftId}
            onChange={(event) => setDraftId(event.target.value)}
            placeholder="Scientific table ID"
            aria-label="Scientific table ID"
            className="h-8 w-72"
          />
          <Button type="submit" size="sm" disabled={draftId.trim() === ''}>
            Embed table
          </Button>
        </div>
      </form>
    )
  }

  if (!table || !adapter || !datasetHeader) {
    return (
      <p className="p-3 text-sm" role="status">
        {tableQuery.isPending
          ? 'Loading table…'
          : 'This table could not be loaded. Check the ID and your access.'}
      </p>
    )
  }

  const rowCount = 2_000_000

  return (
    <div className="space-y-1">
      {readOnly ? (
        <LockedSheetBadge label="Notebook · read-only" />
      ) : null}
      <div className="relative h-[28rem] overflow-hidden">
        <TableSurface
          theme="light"
          className="notebook-table-surface h-full"
          table={
            <div
              className="formatted-table"
              style={{ gridTemplateRows: 'minmax(0, 1fr)' }}
            >
              <PagedSpreadsheet
                adapter={adapter}
                datasetId={table.id}
                fieldIds={fieldIds}
                rowCount={rowCount}
                columnCount={fieldIds.length}
                datasetHeader={datasetHeader}
                query={query}
                onQueryChange={setQuery}
                calculationAuthority="host"
              />
            </div>
          }
          objects={[
            {
              id: `${block.id}-table-inspector`,
              placement: 'bottom' as const,
              size: 180,
              content: (
                <div style={{ padding: 12 }}>
                  <TableControls
                    fields={datasetHeader.fields}
                    query={query}
                    onQueryChange={setQuery}
                    columns={table.columns.map((column) => ({
                      fieldId: column.field_name,
                    }))}
                    onColumnsChange={() => {}}
                    theme="light"
                  />
                </div>
              ),
            },
          ]}
        />
      </div>
    </div>
  )
}
