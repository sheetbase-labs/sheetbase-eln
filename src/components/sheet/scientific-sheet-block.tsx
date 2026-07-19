import { useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CellChange, ChangeSource, ColumnSettings } from 'handsontable'
import type { NotebookBlock } from '#/lib/notebook-data'
import { DataClientError } from '#/lib/data-client'
import { SheetbaseGrid } from './sheetbase-grid'
import {
  applyScientificRowChanges,
  decodeScientificValue,
  fetchScientificRows,
  fetchScientificTable,
  SCIENTIFIC_PAGE_SIZE,
  scientificDataClient,
  scientificQueryKeys,
} from '#/lib/scientific-sheet-data'
import type {
  ScientificColumnWire,
  ScientificRowWire,
} from '#/lib/scientific-sheet-data'

interface PendingCell {
  rowIndex: number
  rowId: string | null
  columnId: string
  fieldName: string
  raw: unknown
}

interface ChangeBatch {
  generation: number
  cells: PendingCell[]
}

interface DraftCell extends PendingCell {
  generation: number
}

function columnSettings(column: ScientificColumnWire): ColumnSettings {
  const base: ColumnSettings = { data: column.field_name }
  if (column.logical_type === 'integer' || column.logical_type === 'decimal')
    return { ...base, type: 'numeric' }
  if (column.logical_type === 'boolean') return { ...base, type: 'checkbox' }
  if (column.logical_type === 'date')
    return {
      ...base,
      type: 'date',
      dateFormat: 'YYYY-MM-DD',
      correctFormat: false,
    }
  if (column.logical_type === 'category')
    return {
      ...base,
      type: 'dropdown',
      source: column.options.map((o) => o.label),
    }
  return { ...base, type: 'text' }
}

export function ScientificSheetBlock({
  block,
  readOnly = false,
}: {
  block: NotebookBlock
  readOnly?: boolean
}) {
  const tableId =
    typeof block.payload.tableId === 'string' ? block.payload.tableId : ''
  const [page, setPage] = useState(0)
  const [issues, setIssues] = useState<Array<{ key: string; message: string }>>(
    [],
  )
  const [drafts, setDrafts] = useState<Record<string, DraftCell>>({})
  const nextGeneration = useRef(0)
  const queryClient = useQueryClient()
  const tableQuery = useQuery({
    queryKey: scientificQueryKeys.table(tableId),
    queryFn: () => fetchScientificTable(scientificDataClient, tableId),
    enabled: !!tableId,
  })
  const table = tableQuery.data
  const rowsKey = scientificQueryKeys.rows(tableId, page)
  const rowsQuery = useQuery({
    queryKey: rowsKey,
    queryFn: () => fetchScientificRows(scientificDataClient, table!, page),
    enabled: !!table,
  })
  // HOT mutates its data. Never expose canonical query-cache objects.
  const localRows = useMemo(() => {
    const detached: Array<Record<string, unknown>> = (rowsQuery.data ?? []).map(
      (row) => {
        const copy = { ...row }
        for (const column of table?.columns ?? [])
          if (column.logical_type === 'category')
            copy[column.field_name] =
              column.options.find((o) => o.id === row[column.field_name])
                ?.label ?? row[column.field_name]
        return copy
      },
    )
    for (const draft of Object.values(drafts)) {
      const rowIndex = draft.rowId
        ? detached.findIndex((row) => row.id === draft.rowId)
        : draft.rowIndex
      if (rowIndex < 0) continue
      detached[rowIndex] ??= {}
      detached[rowIndex][draft.fieldName] = draft.raw
    }
    return detached
  }, [drafts, rowsQuery.data, table])
  const terminal = (rowsQuery.data?.length ?? 0) < SCIENTIFIC_PAGE_SIZE

  const mutation = useMutation({
    scope: { id: `scientific-table:${tableId}` },
    mutationFn: async (batch: ChangeBatch) => {
      if (readOnly || !table) return []
      const canonical =
        queryClient.getQueryData<ScientificRowWire[]>(rowsKey) ?? []
      const canonicalById = new Map(canonical.map((row) => [row.id, row]))
      const edits = new Map<
        string,
        {
          rowId: string
          expectedVersion: number
          values: Record<string, unknown>
        }
      >()
      const inserts = new Map<number, Record<string, unknown>>()
      const errors: Array<{ key: string; message: string }> = []
      for (const cell of batch.cells) {
        const { rowIndex, rowId, columnId, raw } = cell
        const column = table.columns.find((c) => c.id === columnId)
        if (!column) continue
        let value: unknown
        try {
          value = decodeScientificValue(column, raw)
        } catch (error) {
          errors.push({
            key: `${rowIndex}:${column.id}`,
            message: error instanceof Error ? error.message : 'Invalid value.',
          })
          continue
        }
        const row = rowId ? canonicalById.get(rowId) : undefined
        if (row) {
          const edit = edits.get(row.id) ?? {
            rowId: row.id,
            expectedVersion: row.version,
            values: {},
          }
          edit.values[column.id] = value
          edits.set(row.id, edit)
        } else
          inserts.set(rowIndex, {
            ...(inserts.get(rowIndex) ?? {}),
            [column.id]: value,
          })
      }
      if (errors.length) {
        setIssues(errors)
        throw Object.assign(new Error('Some cells are invalid.'), {
          localValidation: true,
        })
      }
      const result = await applyScientificRowChanges(
        scientificDataClient,
        table.id,
        table.schema_version,
        [...edits.values()],
        [...inserts.values()],
      )
      if (!result.ok) {
        setIssues(
          result.errors.map((e) => ({
            key: `${e.rowId}:${e.columnId}`,
            message: e.message,
          })),
        )
        throw Object.assign(new Error('Some cells were rejected.'), {
          validation: true,
        })
      }
      return result.rows
    },
    onSuccess: (rows, batch) => {
      queryClient.setQueryData<ScientificRowWire[]>(rowsKey, (old = []) => {
        const map = new Map(old.map((r) => [r.id, r]))
        for (const row of rows) map.set(row.id, row)
        return [...map.values()]
      })
      setDrafts((current) => {
        const next = { ...current }
        for (const cell of batch.cells) {
          const key = `${cell.rowId ?? `new:${cell.rowIndex}`}:${cell.columnId}`
          if (next[key]?.generation === batch.generation) delete next[key]
        }
        return next
      })
      setIssues([])
    },
    onError: (error, batch) => {
      if (!(error as { localValidation?: boolean }).localValidation)
        void queryClient.invalidateQueries({
          queryKey: ['scientific-rows', tableId],
        })
      if (error instanceof DataClientError && error.code === 'stale_version') {
        const affected = new Map<string, { key: string; message: string }>()
        for (const cell of batch.cells) {
          const rowKey = cell.rowId ?? `new:${cell.rowIndex}`
          affected.set(rowKey, {
            key: `${rowKey}:conflict`,
            message: `Row ${cell.rowIndex + 1} changed elsewhere. Your entered values remain in the grid.`,
          })
        }
        setIssues([...affected.values()])
      }
    },
  })
  const settings = table
    ? {
        data: localRows,
        columns: table.columns.map(columnSettings),
        colHeaders: table.columns.map(
          (c) =>
            `${c.label}${c.unit && typeof c.unit === 'object' && 'symbol' in c.unit ? ` (${String(c.unit.symbol)})` : ''}`,
        ),
        rowHeaders: true,
        minSpareRows: !readOnly && terminal ? 1 : 0,
        readOnly,
        fillHandle: !readOnly,
        contextMenu: !readOnly,
        afterChange: (changes: CellChange[] | null, source: ChangeSource) => {
          if (readOnly || !changes || source === 'loadData') return
          const generation = ++nextGeneration.current
          const cells: PendingCell[] = changes.flatMap(
            ([rowIndex, property, , raw]) => {
              const column = table.columns.find(
                (candidate) => candidate.field_name === String(property),
              )
              if (!column) return []
              const rowId =
                typeof localRows[rowIndex]?.id === 'string'
                  ? String(localRows[rowIndex].id)
                  : null
              return [
                {
                  rowIndex,
                  rowId,
                  columnId: column.id,
                  fieldName: column.field_name,
                  raw,
                },
              ]
            },
          )
          setDrafts((current) => {
            const next = { ...current }
            for (const cell of cells) {
              const key = `${cell.rowId ?? `new:${cell.rowIndex}`}:${cell.columnId}`
              next[key] = { ...cell, generation }
            }
            return next
          })
          mutation.mutate({ generation, cells })
        },
      }
    : null
  if (!tableId) return <p role="alert">Invalid sheet block.</p>
  if (tableQuery.isPending || (table && rowsQuery.isPending))
    return <p role="status">Loading scientific sheet…</p>
  if (tableQuery.isError || rowsQuery.isError)
    return <p role="alert">Could not load scientific sheet.</p>
  if (!table || !settings)
    return <p role="alert">Scientific sheet not found.</p>
  return (
    <div>
      {issues.length ? (
        <ul role="alert" className="mb-2 text-xs text-destructive">
          {issues.map((issue) => (
            <li key={issue.key} data-cell={issue.key}>
              {issue.message}
            </li>
          ))}
        </ul>
      ) : null}
      <SheetbaseGrid settings={settings} ariaLabel={table.name} />
      <nav aria-label="Sheet pages" className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={page === 0 || rowsQuery.isFetching}
          onClick={() => setPage((p) => p - 1)}
        >
          Previous
        </button>
        <span>Page {page + 1}</span>
        <button
          type="button"
          disabled={terminal || rowsQuery.isFetching}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </button>
      </nav>
    </div>
  )
}
