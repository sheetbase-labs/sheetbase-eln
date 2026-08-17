import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { SheetbaseGrid } from '#/components/sheet/sheetbase-grid'
import { SheetRecordPicker } from '#/components/sheet/sheet-record-picker'
import { ComposedSheetRecordToolbar } from '#/components/sheet/composed-sheet-record-toolbar'
import { CanonicalSheetLifecyclePanel } from '#/components/sheet/canonical-sheet-lifecycle-panel'
import { ModelFieldInput } from '#/components/scientific/model-field-input'
import { Button, Input, Label } from '#/components/ui'
import { createDataClient } from '#/lib/data-client'
import { DataClientError } from '#/lib/data-client'
import {
  canonicalSheetGridMatrix,
  parseSheetCellInput,
  validateCanonicalCell,
} from '#/lib/canonical-sheet-grid'
import { fetchComposedSheetRows } from '#/lib/sheet-composition-data'
import { selectableFieldOptions } from '#/lib/field-presentation'
import {
  fetchSheetInstance,
  sheetInstanceDataClient,
  updateSheetInstance,
} from '#/lib/sheet-instance-data'
import type { SheetInstance } from '#/lib/sheet-instance-data'
import {
  createAdHocTextField,
  mutateSheetInstanceCalculations,
  mutateSheetLocalState,
  readSheetInstanceCalculationResults,
} from '#/lib/sheet-local-data'
import type { LocalFieldChange } from '#/lib/sheet-local-data'
import { resolveSheetRecordActions } from '#/lib/sheet-record-actions'
import {
  commitSheetRecordBatch,
  composedSheetRecordLinkBatchRows,
  createAndLinkSheetRecord,
  enrichSheetRecordWriteTarget,
} from '#/lib/sheet-record-commit'
import { sheetCalculationDependenciesFromExpression } from '#/lib/sheet-calculation'
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
import {
  resolveSheetWriteTarget,
  sheetCellWriteError,
  writeSheetCell,
} from '#/lib/sheet-write-back'
import { sheetRecordTargetModelKey } from '#/lib/sheet-record-target'

const client = createDataClient()

function errorText(error: unknown) {
  if (error instanceof DataClientError) return error.message
  if (error instanceof Error) return error.message
  return null
}

function handsontableType(column: {
  presentation: { kind: string }
  field: {
    category?: {
      kind: string
      options?: Array<{ key: string; lifecycle: string }>
    } | null
  } | null
}): { type: string; dateFormat?: string; source?: string[] } {
  const kind = column.presentation.kind
  if (kind === 'checkbox') return { type: 'checkbox' }
  if (kind === 'number') return { type: 'numeric' }
  if (kind === 'date') return { type: 'date', dateFormat: 'YYYY-MM-DD' }
  if (kind === 'category-select' && column.field) {
    return {
      type: 'dropdown',
      source: selectableFieldOptions(column.field as never, null).map(
        (option) => option.key,
      ),
    }
  }
  return { type: 'text' }
}

export function CanonicalSheetWorkspace({
  instanceId,
  projectId,
  readOnly = false,
}: {
  instanceId: string
  projectId: string | null
  readOnly?: boolean
}) {
  const instanceQuery = useQuery({
    queryKey: ['sheet-instance', instanceId],
    queryFn: () => fetchSheetInstance(instanceId, sheetInstanceDataClient),
  })
  if (instanceQuery.isPending) {
    return (
      <p className="p-3 text-sm text-muted-foreground" role="status">
        Loading Sheet…
      </p>
    )
  }
  if (instanceQuery.error || !instanceQuery.data) {
    return (
      <p className="p-3 text-sm text-destructive" role="alert">
        This Sheet could not be loaded.
      </p>
    )
  }
  return (
    <CanonicalSheetEditor
      instance={instanceQuery.data}
      projectId={projectId}
      readOnly={readOnly}
    />
  )
}

export function CanonicalSheetEditor({
  instance,
  projectId,
  readOnly = false,
}: {
  instance: SheetInstance
  projectId: string | null
  readOnly?: boolean
}) {
  const queryClient = useQueryClient()
  const instanceRef = useRef(instance)
  instanceRef.current = instance
  const composed = Boolean(instance.sourceDefinitionVersionId)
  const canWrite =
    Boolean(projectId) && !readOnly && instance.lifecycle === 'active'
  const [columnLabel, setColumnLabel] = useState('')
  const [formula, setFormula] = useState('')
  const [formulaLabel, setFormulaLabel] = useState('Calculated')
  const [selected, setSelected] = useState<{ row: number; col: number }>({
    row: 0,
    col: 0,
  })
  const [writeStatus, setWriteStatus] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [custom, setCustom] = useState<Record<string, string | boolean>>({})
  const [query, setQuery] = useState('')
  const [pendingValues, setPendingValues] = useState<
    Record<string, Record<string, unknown>>
  >({})
  const [errors, setErrors] = useState(
    sheetRecordGridErrorsFromValidation({ rows: [] }),
  )
  const [errorCursor, setErrorCursor] = useState<
    (typeof errors)[number] | null
  >(null)

  const composition = useQuery({
    queryKey: ['composed-sheet', instance.id],
    queryFn: () => fetchComposedSheetRows(instance.id, { limit: 200 }, client),
    enabled: composed,
  })

  const rowKeysForCalc = useMemo(() => {
    if (composition.data) return composition.data.rows.map((row) => row.rowKey)
    return Object.keys(instance.state.localValues)
  }, [composition.data, instance.state.localValues])

  const calculations = useQuery({
    queryKey: [
      'sheet-calc-results',
      instance.id,
      instance.revision,
      rowKeysForCalc,
    ],
    enabled: rowKeysForCalc.length > 0,
    queryFn: async () => {
      const raw = await readSheetInstanceCalculationResults(
        instance.id,
        rowKeysForCalc,
        client,
      )
      const rows =
        (
          raw as {
            results?: Array<{
              calculationId: string
              rowKey: string
              calculatedValue: unknown
              calculationStatus?: string
            }>
          }
        ).results ?? []
      const mapped: Record<string, Record<string, unknown>> = {}
      for (const row of rows) {
        mapped[row.rowKey] ??= {}
        mapped[row.rowKey][row.calculationId] = row.calculatedValue
      }
      return { mapped, rows }
    },
  })

  const matrix = useMemo(
    () =>
      canonicalSheetGridMatrix({
        instance,
        composition: composition.data ?? null,
        calculationResults: calculations.data?.mapped,
      }),
    [instance, composition.data, calculations.data],
  )
  const matrixRef = useRef(matrix)
  matrixRef.current = matrix
  const compositionRef = useRef(composition.data ?? null)
  compositionRef.current = composition.data ?? null

  const modelKey = sheetRecordTargetModelKey(
    composition.data?.definitionConfiguration,
  )
  const fields = useQuery({
    queryKey: ['model-fields', modelKey],
    queryFn: () => fetchModelFields(client, modelKey!),
    enabled: Boolean(modelKey) && createOpen,
  })
  const search = useQuery({
    queryKey: ['sheet-record-search', modelKey, query],
    queryFn: () => searchSheetRecords({ modelKey: modelKey!, query }, client),
    enabled: Boolean(modelKey) && pickerOpen,
  })
  const actions = resolveSheetRecordActions(
    composition.data?.definitionConfiguration ?? null,
  )
  const selectedColumn = matrix.columns[selected.col]
  const selectedRowKey = matrix.rowKeys[selected.row]
  const provenance =
    composition.data?.boundProjection?.rows.find(
      (row) => row.rowKey === selectedRowKey,
    )?.values[selectedColumn?.id ?? ''] ?? null

  const localMutate = useMutation({
    mutationFn: (input: Parameters<typeof mutateSheetLocalState>[0]) =>
      mutateSheetLocalState(input, client),
    onSuccess: (next) => {
      queryClient.setQueryData(['sheet-instance', instance.id], next)
    },
  })

  async function persistLocalCells(
    cells: Array<{ rowKey: string; fieldId: string; value: unknown }>,
    extra?: {
      fieldChanges?: LocalFieldChange[]
      rows?: Parameters<typeof mutateSheetLocalState>[0]['rows']
    },
  ) {
    const current = instanceRef.current
    const next = await localMutate.mutateAsync({
      instanceId: current.id,
      expectedRevision: current.revision,
      retryToken: crypto.randomUUID(),
      fieldChanges: extra?.fieldChanges,
      rows: extra?.rows,
      cells,
    })
    instanceRef.current = next
    return next
  }

  async function addColumn() {
    const fields = instance.state.localFields.filter(
      (field) => field.lifecycle === 'active',
    )
    const field = createAdHocTextField(
      columnLabel,
      fields.map((item) => item.key),
    )
    await persistLocalCells([], {
      fieldChanges: [{ operation: 'add', field }],
    })
    setColumnLabel('')
  }

  async function addRow() {
    const fields = instance.state.localFields.filter(
      (field) => field.lifecycle === 'active',
    )
    const fieldChanges: LocalFieldChange[] = []
    const existing = fields[0]
    const field =
      existing ??
      createAdHocTextField(
        columnLabel,
        fields.map((item) => item.key),
      )
    if (!existing) fieldChanges.push({ operation: 'add', field })
    const rowKey = crypto.randomUUID()
    await persistLocalCells([{ rowKey, fieldId: field.fieldId, value: null }], {
      fieldChanges,
      rows: [{ kind: 'local', rowKey }],
    })
    setColumnLabel('')
  }

  async function deleteSelectedRow() {
    const rowKey = matrix.rowKeys[selected.row]
    if (!rowKey || matrix.rowKinds[selected.row] !== 'local') return
    const current = instanceRef.current
    const nextValues = { ...current.state.localValues }
    delete nextValues[rowKey]
    const next = await updateSheetInstance(
      current.id,
      current.revision,
      { ...current.state, localValues: nextValues },
      sheetInstanceDataClient,
    )
    queryClient.setQueryData(['sheet-instance', instance.id], next)
  }

  async function deleteSelectedColumn() {
    const column = matrix.columns[selected.col]
    if (!column || column.origin === 'bound') return
    await persistLocalCells([], {
      fieldChanges: [{ operation: 'retire', fieldId: column.id }],
    })
  }

  const addCalculation = useMutation({
    mutationFn: async () => {
      const id = crypto.randomUUID()
      const keyBase = formulaLabel
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 40)
      const key = /^[a-z]/.test(keyBase) ? keyBase || 'calc' : `calc_${keyBase}`
      const outputField = {
        fieldId: id,
        key,
        label: formulaLabel.trim() || 'Calculated',
        description: null,
        logicalType: 'decimal' as const,
        nullable: true,
        defaultValue: null,
        cardinality: 'one' as const,
        quantity: null,
        validation: {},
        category: null,
        relationship: null,
        computation: { mode: 'computed' as const, expressionId: id },
        lifecycle: 'active' as const,
      }
      return mutateSheetInstanceCalculations(
        {
          instanceId: instance.id,
          expectedRevision: instance.revision,
          retryToken: crypto.randomUUID(),
          changes: [
            {
              operation: 'add',
              calculation: {
                id,
                key,
                label: outputField.label,
                lifecycle: 'active',
                outputField,
                dependencies: sheetCalculationDependenciesFromExpression({
                  source: formula,
                  columns: matrix.columns.map((column) => ({
                    id: column.id,
                    origin: column.origin,
                  })),
                  rowCount: matrix.rowKeys.length,
                }),
                expression: {
                  language: 'sheetbase-formula-v1',
                  source: formula.trim(),
                },
              },
            },
          ],
        },
        client,
      )
    },
    onSuccess: (next) => {
      queryClient.setQueryData(['sheet-instance', instance.id], next)
      setFormula('')
    },
  })

  const writeBack = useMutation({
    mutationFn: async () => {
      const snapshot = compositionRef.current
      if (!snapshot) return
      const entries = Object.entries(pendingValues)
      for (const [rowKey, cells] of entries) {
        for (const [columnId, value] of Object.entries(cells)) {
          await writeSheetCell(
            {
              composition: snapshot,
              rowKey,
              columnId,
              retryToken: crypto.randomUUID(),
              value,
            },
            client,
          )
        }
      }
    },
    onSuccess: async () => {
      setPendingValues({})
      setWriteStatus('Write-back saved.')
      await queryClient.invalidateQueries({
        queryKey: ['composed-sheet', instance.id],
      })
      await queryClient.invalidateQueries({
        queryKey: ['sheet-instance', instance.id],
      })
    },
    onError: (error) => {
      setWriteStatus(`Write-back ${sheetCellWriteError(error)}.`)
    },
  })

  const link = useMutation({
    mutationFn: async (recordId: string) => {
      const snapshot = composition.data
      const column = matrix.columns.find(
        (item) => item.presentation.kind === 'record-picker' && item.editable,
      )
      if (!snapshot || !column || !selectedRowKey || !modelKey) return
      const resolved = resolveSheetWriteTarget({
        composition: snapshot,
        rowKey: selectedRowKey,
        columnId: column.id,
      })
      return linkSheetRecordReference(
        {
          composition: snapshot,
          rowKey: selectedRowKey,
          columnId: column.id,
          retryToken: crypto.randomUUID(),
          contract: {
            format: RECORD_REFERENCE_CELL_FORMAT,
            targetModelKey: modelKey,
            nullable: true,
            cardinality: 'one',
            readOnly: false,
            writeTarget: { kind: resolved.kind },
          },
          record: {
            recordId,
            modelKey,
            archived: false,
            deleted: false,
          },
        },
        client,
      )
    },
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['composed-sheet', instance.id],
      }),
  })

  const create = useMutation({
    mutationFn: async () => {
      const snapshot = composition.data
      const column = matrix.columns.find(
        (item) => item.presentation.kind === 'record-picker' && item.editable,
      )
      if (!snapshot || !column || !selectedRowKey || !projectId || !modelKey)
        return
      const resolved = resolveSheetWriteTarget({
        composition: snapshot,
        rowKey: selectedRowKey,
        columnId: column.id,
      })
      return createAndLinkSheetRecord(
        {
          projectId,
          modelKey,
          title,
          customFields: custom,
          writeTarget: enrichSheetRecordWriteTarget(
            snapshot,
            selectedRowKey,
            resolved,
          ),
        },
        client,
      )
    },
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['composed-sheet', instance.id],
      }),
  })

  const addRowRef = useRef(addRow)
  const addColumnRef = useRef(addColumn)
  const deleteRowRef = useRef(deleteSelectedRow)
  const deleteColumnRef = useRef(deleteSelectedColumn)
  addRowRef.current = addRow
  addColumnRef.current = addColumn
  deleteRowRef.current = deleteSelectedRow
  deleteColumnRef.current = deleteSelectedColumn

  const settings = useMemo(
    () => ({
      data: matrix.data,
      colHeaders: matrix.columns.map((column) => column.label),
      columns: matrix.columns.map((column) => ({
        ...handsontableType(column),
        readOnly: !canWrite || !column.editable,
      })),
      rowHeaders: true,
      stretchH: 'all' as const,
      height: '100%',
      copyPaste: true,
      fillHandle: true,
      minSpareRows: canWrite ? 1 : 0,
      columnSorting: true,
      filters: true,
      dropdownMenu: true,
      manualColumnFreeze: true,
      fixedColumnsStart: instance.state.presentation.frozenColumnCount,
      autoWrapRow: false,
      contextMenu: {
        items: {
          insert_row: {
            name: 'Insert row',
            callback: () => {
              void addRowRef.current()
            },
          },
          insert_column: {
            name: 'Insert column',
            callback: () => {
              void addColumnRef.current()
            },
          },
          remove_row: {
            name: 'Delete local row',
            callback: () => {
              void deleteRowRef.current()
            },
          },
          remove_col: {
            name: 'Retire local column',
            callback: () => {
              void deleteColumnRef.current()
            },
          },
          sp1: { name: '---------' },
          copy: {},
          cut: {},
        },
      },
      afterSelectionEnd: (row: number, col: number) => {
        if (row >= 0 && col >= 0) setSelected({ row, col })
      },
      afterChange: (
        changes: Array<[number, string | number, unknown, unknown]> | null,
        source: string,
      ) => {
        if (!changes || source === 'loadData' || !canWrite) return
        const currentMatrix = matrixRef.current
        const snapshot = compositionRef.current
        const localCells: Array<{
          rowKey: string
          fieldId: string
          value: unknown
        }> = []
        const pending: Record<string, Record<string, unknown>> = {}
        const created = new Map<number, string>()
        for (const change of changes) {
          const columnIndex =
            typeof change[1] === 'number' ? change[1] : Number(change[1])
          const column = currentMatrix.columns[columnIndex]
          if (!column || !column.editable) continue
          let rowKey =
            currentMatrix.rowKeys[change[0]] ?? created.get(change[0])
          if (!rowKey) {
            rowKey = crypto.randomUUID()
            created.set(change[0], rowKey)
          }
          const value = parseSheetCellInput(column.field, change[3])
          const invalid = validateCanonicalCell(column.field, value)
          if (invalid) {
            setWriteStatus(`Invalid value (${invalid}) in ${column.label}.`)
            continue
          }
          if (column.origin === 'bound' && snapshot) {
            pending[rowKey] = { ...pending[rowKey], [column.id]: value }
          } else {
            localCells.push({ rowKey, fieldId: column.id, value })
          }
        }
        if (Object.keys(pending).length > 0) {
          setPendingValues((current) => {
            const next = { ...current }
            for (const [rowKey, cells] of Object.entries(pending)) {
              next[rowKey] = { ...next[rowKey], ...cells }
            }
            return next
          })
        }
        if (localCells.length > 0) {
          const newRows = [...created.values()].map((rowKey) => ({
            kind: 'local' as const,
            rowKey,
          }))
          void persistLocalCells(localCells, {
            rows: newRows.length > 0 ? newRows : undefined,
          }).catch((error: unknown) => {
            setWriteStatus(
              errorText(error) ?? `Local write ${sheetCellWriteError(error)}.`,
            )
          })
        }
      },
    }),
    [matrix, canWrite, instance.state.presentation.frozenColumnCount],
  )

  useEffect(() => {
    if (composition.error) {
      setWriteStatus(
        'This Sheet could not be composed from its Dataset or Record bindings.',
      )
    }
  }, [composition.error])

  const staleCalc = calculations.data?.rows.some(
    (row) => row.calculationStatus === 'stale',
  )

  return (
    <div className="flex h-full min-h-[24rem] flex-col">
      {canWrite ? (
        <div className="flex flex-wrap items-end gap-2 border-b px-2 py-2">
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">New column</span>
            <Input
              value={columnLabel}
              onChange={(event) => setColumnLabel(event.target.value)}
              placeholder="Column name"
              className="h-8 w-40"
            />
          </label>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={localMutate.isPending}
            onClick={() => void addColumn()}
          >
            Add column
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={localMutate.isPending}
            onClick={() => void addRow()}
          >
            Add row
          </Button>
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">Formula</span>
            <Input
              value={formula}
              onChange={(event) => setFormula(event.target.value)}
              placeholder="=A1*2"
              className="h-8 w-32"
              aria-label="Calculation formula"
            />
          </label>
          <Input
            value={formulaLabel}
            onChange={(event) => setFormulaLabel(event.target.value)}
            placeholder="Label"
            className="h-8 w-28"
            aria-label="Calculation label"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={addCalculation.isPending}
            onClick={() => addCalculation.mutate()}
          >
            Add calculation
          </Button>
          {composed ? (
            <Button
              type="button"
              size="sm"
              disabled={
                writeBack.isPending || Object.keys(pendingValues).length === 0
              }
              onClick={() => writeBack.mutate()}
            >
              Write back
            </Button>
          ) : null}
        </div>
      ) : null}
      {composed && canWrite ? (
        <ComposedSheetRecordToolbar
          actions={actions}
          errors={errors}
          onLink={() => setPickerOpen(true)}
          onCreate={() => setCreateOpen(true)}
          onValidate={async () => {
            if (!projectId || !composition.data || !modelKey) return
            const rows = composedSheetRecordLinkBatchRows(
              composition.data,
              pendingValues,
            )
            if (rows.length === 0) {
              setErrors([])
              setErrorCursor(null)
              return
            }
            const result = await validateSheetRecordBatch(
              { projectId, modelKey, rows },
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
            if (!projectId || !composition.data || !modelKey) return
            const rows = composedSheetRecordLinkBatchRows(
              composition.data,
              pendingValues,
            )
            if (rows.length === 0) return
            await commitSheetRecordBatch(
              {
                projectId,
                modelKey,
                rows,
                idempotencyKey: crypto.randomUUID(),
              },
              client,
            )
            await queryClient.invalidateQueries({
              queryKey: ['composed-sheet', instance.id],
            })
          }}
          onNextError={() =>
            setErrorCursor(nextSheetRecordGridError(errors, errorCursor))
          }
        />
      ) : null}
      {matrix.columns.length === 0 ? (
        <p className="p-3 text-sm text-muted-foreground" role="status">
          This Sheet has no columns yet. Add a column to start entering data.
        </p>
      ) : composition.isLoading ? (
        <p className="p-3 text-sm text-muted-foreground" role="status">
          Loading composed Sheet…
        </p>
      ) : (
        <div className="min-h-0 flex-1">
          <SheetbaseGrid
            ariaLabel="Sheet"
            description="Spreadsheet editor. Arrow keys move, Enter edits, Ctrl+C/V copy and paste, fill handle fills."
            settings={settings}
          />
        </div>
      )}
      <div className="space-y-1 border-t px-3 py-2 text-xs text-muted-foreground">
        {staleCalc ? (
          <p role="status">
            Calculation results are stale. Recalculate after edits.
          </p>
        ) : null}
        {writeStatus ? <p role="status">{writeStatus}</p> : null}
        {errorText(localMutate.error) || errorText(addCalculation.error) ? (
          <p className="text-destructive" role="alert">
            {errorText(localMutate.error) ?? errorText(addCalculation.error)}
          </p>
        ) : null}
        {errorCursor ? (
          <p role="status">
            {errorCursor.rowKey}: {errorCursor.message}
          </p>
        ) : null}
        {selectedColumn ? (
          <p role="status">
            {selectedColumn.label}
            {selectedColumn.origin === 'bound'
              ? ' · governed'
              : ` · ${selectedColumn.origin}`}
            {provenance && 'kind' in provenance
              ? provenance.kind === 'present'
                ? ` · ${provenance.provenance.sourceKind} provenance`
                : ' · unmatched source'
              : ''}
            {provenance &&
            provenance.kind === 'present' &&
            provenance.provenance.sourceKind === 'dataset'
              ? ` · dataset ${provenance.provenance.sourceDatasetId}`
              : ''}
          </p>
        ) : null}
      </div>
      {canWrite ? (
        <CanonicalSheetLifecyclePanel
          instance={instance}
          onInstance={(next) =>
            queryClient.setQueryData(['sheet-instance', instance.id], next)
          }
        />
      ) : null}
      {canWrite && pickerOpen && modelKey ? (
        <div className="border-t">
          <SheetRecordPicker
            modelKey={modelKey}
            results={sheetRecordSearchHitsAsNotebookRecords(
              search.data ?? [],
              projectId ?? '',
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
      {canWrite && createOpen && modelKey ? (
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

export function AdHocSheetWorkspace({
  instance,
  readOnly = false,
}: {
  instance: SheetInstance
  readOnly?: boolean
}) {
  return (
    <CanonicalSheetEditor
      instance={instance}
      projectId={instance.projectId}
      readOnly={readOnly}
    />
  )
}

export function ComposedSheetWorkspace({
  instanceId,
  projectId,
  readOnly = false,
}: {
  instanceId: string
  projectId: string | null
  readOnly?: boolean
}) {
  return (
    <CanonicalSheetWorkspace
      instanceId={instanceId}
      projectId={projectId}
      readOnly={readOnly}
    />
  )
}
