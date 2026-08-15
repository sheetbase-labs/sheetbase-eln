import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { SheetbaseGrid } from '#/components/sheet/sheetbase-grid'
import { SheetRecordPicker } from '#/components/sheet/sheet-record-picker'
import { ComposedSheetRecordToolbar } from '#/components/sheet/composed-sheet-record-toolbar'
import { ModelFieldInput } from '#/components/scientific/model-field-input'
import { Button, Input, Label } from '#/components/ui'
import { createDataClient } from '#/lib/data-client'
import { composedSheetGridMatrix } from '#/lib/composed-sheet-grid'
import { fetchComposedSheetRows } from '#/lib/sheet-composition-data'
import { resolveSheetRecordActions } from '#/lib/sheet-record-actions'
import {
  commitSheetRecordBatch,
  composedSheetRecordLinkBatchRows,
  createAndLinkSheetRecord,
  enrichSheetRecordWriteTarget,
} from '#/lib/sheet-record-commit'
import {
  searchSheetRecords,
  sheetRecordSearchHitsAsNotebookRecords,
} from '#/lib/sheet-record-search'
import { linkSheetRecordReference } from '#/lib/sheet-record-link'
import { RECORD_REFERENCE_CELL_FORMAT } from '#/lib/record-reference-cell'
import {
  nextSheetRecordGridError,
  sheetRecordGridErrorsFromValidation,
} from '#/lib/sheet-record-grid-errors'
import { fetchModelFields } from '#/lib/model-fields'
import { validateSheetRecordBatch } from '#/lib/sheet-record-mapping'
import { resolveSheetWriteTarget } from '#/lib/sheet-write-back'

const client = createDataClient()
const GOLDEN_MODEL_KEY = 'sample'

export function ComposedSheetWorkspace({
  instanceId,
  projectId,
}: {
  instanceId: string
  projectId: string
}) {
  const queryClient = useQueryClient()
  const composition = useQuery({
    queryKey: ['composed-sheet', instanceId],
    queryFn: () => fetchComposedSheetRows(instanceId, { limit: 200 }, client),
  })
  const fields = useQuery({
    queryKey: ['model-fields', GOLDEN_MODEL_KEY],
    queryFn: () => fetchModelFields(client, GOLDEN_MODEL_KEY),
  })
  const [query, setQuery] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [custom, setCustom] = useState<Record<string, string | boolean>>({})
  const [selectedRowIndex, setSelectedRowIndex] = useState(0)
  const [pendingValues, setPendingValues] = useState<
    Record<string, Record<string, unknown>>
  >({})
  const [errors, setErrors] = useState(
    sheetRecordGridErrorsFromValidation({ rows: [] }),
  )
  const [errorCursor, setErrorCursor] = useState<
    (typeof errors)[number] | null
  >(null)
  const search = useQuery({
    queryKey: ['sheet-record-search', query],
    queryFn: () =>
      searchSheetRecords({ modelKey: GOLDEN_MODEL_KEY, query }, client),
    enabled: pickerOpen,
  })

  const matrix = useMemo(
    () => (composition.data ? composedSheetGridMatrix(composition.data) : null),
    [composition.data],
  )
  const actions = resolveSheetRecordActions(
    composition.data?.definitionConfiguration ?? null,
  )
  const selectedColumn = matrix?.columns.find(
    (column) => column.presentation.kind === 'record-picker' && column.editable,
  )
  const selectedRowKey = matrix?.rowKeys[selectedRowIndex] ?? matrix?.rowKeys[0]

  const link = useMutation({
    mutationFn: async (recordId: string) => {
      if (!composition.data || !selectedColumn || !selectedRowKey) return
      const resolved = resolveSheetWriteTarget({
        composition: composition.data,
        rowKey: selectedRowKey,
        columnId: selectedColumn.id,
      })
      return linkSheetRecordReference(
        {
          composition: composition.data,
          rowKey: selectedRowKey,
          columnId: selectedColumn.id,
          retryToken: crypto.randomUUID(),
          contract: {
            format: RECORD_REFERENCE_CELL_FORMAT,
            targetModelKey: GOLDEN_MODEL_KEY,
            nullable: true,
            cardinality: 'one',
            readOnly: false,
            writeTarget: { kind: resolved.kind },
          },
          record: {
            recordId,
            modelKey: GOLDEN_MODEL_KEY,
            archived: false,
            deleted: false,
          },
        },
        client,
      )
    },
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['composed-sheet', instanceId],
      }),
  })

  const create = useMutation({
    mutationFn: async () => {
      if (!composition.data || !selectedColumn || !selectedRowKey) return
      const resolved = resolveSheetWriteTarget({
        composition: composition.data,
        rowKey: selectedRowKey,
        columnId: selectedColumn.id,
      })
      return createAndLinkSheetRecord(
        {
          projectId,
          modelKey: GOLDEN_MODEL_KEY,
          title,
          customFields: custom,
          writeTarget: enrichSheetRecordWriteTarget(
            composition.data,
            selectedRowKey,
            resolved,
          ),
        },
        client,
      )
    },
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['composed-sheet', instanceId],
      }),
  })

  if (composition.isLoading) return <p>Loading composed Sheet…</p>
  if (composition.error) {
    return (
      <p role="alert">
        {composition.error instanceof Error
          ? composition.error.message
          : 'Unable to load composed Sheet.'}
      </p>
    )
  }
  if (!matrix || !composition.data) return null

  const snapshot = composition.data

  return (
    <div className="flex h-full flex-col">
      <ComposedSheetRecordToolbar
        actions={actions}
        errors={errors}
        onLink={() => setPickerOpen(true)}
        onCreate={() => setCreateOpen(true)}
        onValidate={async () => {
          const rows = composedSheetRecordLinkBatchRows(snapshot, pendingValues)
          if (rows.length === 0) {
            setErrors([])
            setErrorCursor(null)
            return
          }
          const result = await validateSheetRecordBatch(
            { projectId, modelKey: GOLDEN_MODEL_KEY, rows },
            client,
          )
          const next = sheetRecordGridErrorsFromValidation(
            result as {
              rows?: Array<{
                rowKey: string
                errors?: Array<{
                  code?: string
                  fieldName?: string
                  message?: string
                }>
              }>
            },
          )
          setErrors(next)
          setErrorCursor(next[0] ?? null)
        }}
        onCommit={async () => {
          const rows = composedSheetRecordLinkBatchRows(snapshot, pendingValues)
          if (rows.length === 0) return
          await commitSheetRecordBatch(
            {
              projectId,
              modelKey: GOLDEN_MODEL_KEY,
              rows,
              idempotencyKey: crypto.randomUUID(),
            },
            client,
          )
          await queryClient.invalidateQueries({
            queryKey: ['composed-sheet', instanceId],
          })
        }}
        onNextError={() =>
          setErrorCursor(nextSheetRecordGridError(errors, errorCursor))
        }
      />
      <div className="min-h-0 flex-1">
        <SheetbaseGrid
          ariaLabel="Composed Sheet"
          settings={{
            data: matrix.data,
            colHeaders: matrix.columns.map((column) => column.label),
            columns: matrix.columns.map((column) => ({
              readOnly: !column.editable,
            })),
            rowHeaders: true,
            stretchH: 'all',
            height: '100%',
            afterSelectionEnd: (row) => {
              if (row >= 0) setSelectedRowIndex(row)
            },
            afterChange: (changes, source) => {
              if (!changes || source === 'loadData') return
              setPendingValues((current) => {
                const next = { ...current }
                for (const change of changes) {
                  const rowKey = matrix.rowKeys[change[0]]
                  const columnId = matrix.columns[change[1] as number]?.id
                  if (!rowKey || !columnId) continue
                  next[rowKey] = { ...next[rowKey], [columnId]: change[3] }
                }
                return next
              })
            },
          }}
        />
      </div>
      {errorCursor ? (
        <p className="border-t px-3 py-2 text-sm" role="status">
          {errorCursor.rowKey}: {errorCursor.message}
        </p>
      ) : null}
      {pickerOpen ? (
        <div className="border-t">
          <SheetRecordPicker
            modelKey={GOLDEN_MODEL_KEY}
            results={sheetRecordSearchHitsAsNotebookRecords(
              search.data ?? [],
              projectId,
            )}
            loading={search.isLoading}
            onSearch={setQuery}
            onSelect={(result) => {
              link.mutate(result.id)
              setPickerOpen(false)
            }}
          />
        </div>
      ) : null}
      {createOpen ? (
        <form
          className="space-y-2 border-t px-3 py-2"
          onSubmit={(event) => {
            event.preventDefault()
            create.mutate()
            setCreateOpen(false)
          }}
        >
          <Label>
            Name
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Label>
          {(fields.data ?? [])
            .filter((field) => field.lifecycle === 'active')
            .map((field) => (
              <ModelFieldInput
                key={field.id}
                definition={field}
                value={custom[field.fieldName] ?? ''}
                onChange={(value) =>
                  setCustom((current) => ({
                    ...current,
                    [field.fieldName]: value,
                  }))
                }
              />
            ))}
          <Button type="submit">Create and link</Button>
        </form>
      ) : null}
    </div>
  )
}
