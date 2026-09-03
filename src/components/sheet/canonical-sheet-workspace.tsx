import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  PagedSpreadsheet,
  parseAddress,
  type SpreadsheetCellRenderContext,
  type SpreadsheetCustomEditor,
  type DatasetQuery,
} from 'sheetbase-table/dev'
import {
  createElnCellRenderer,
  createRecordMenuActions,
  type ElnColumnConfig,
} from '@sheetbase/table-eln'

import type { FieldDefinition } from '#/lib/field-definition'
import { SheetRecordPicker } from '#/components/sheet/sheet-record-picker'
import { ComposedSheetRecordToolbar } from '#/components/sheet/composed-sheet-record-toolbar'
import { CanonicalSheetLifecyclePanel } from '#/components/sheet/canonical-sheet-lifecycle-panel'
import { ModelFieldInput } from '#/components/scientific/model-field-input'
import { Button, Input, Label } from '#/components/ui'
import { createDataClient, DataClientError } from '#/lib/data-client'
import {
  applySheetPresentation,
  canonicalSheetColumnHeader,
  canonicalSheetGridMatrix,
} from '#/lib/canonical-sheet-grid'
import {
  presentationFiltersToQueryFilters,
  presentationSortsToQuerySorts,
  SheetInstancePagedAdapter,
} from '#/lib/sheetbase-table/sheet-instance-paged-adapter'
import { fetchComposedSheetRows } from '#/lib/sheet-composition-data'
import { selectableFieldOptions } from '#/lib/field-presentation'
import {
  fetchSheetInstance,
  sheetInstanceDataClient,
  updateSheetInstance,
} from '#/lib/sheet-instance-data'
import type { SheetPresentation } from '#/lib/sheet-instance'
import {
  hasSavedSheetView,
  loadSheetView,
  sanitizeSheetPresentation,
  saveSheetView,
} from '#/lib/sheet-presentation-view'
import { ExportMenu } from '#/components/export/export-menu'
import { ObjectHistoryDialog } from '#/components/audit'
import type { BoundColumnProvenance } from '#/lib/sheet-bound-columns'
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
import {
  formatRecordReferenceLabel,
  RECORD_REFERENCE_CELL_FORMAT,
} from '#/lib/record-reference-cell'
import {
  nextSheetRecordGridError,
  sheetRecordGridErrorsFromValidation,
} from '#/lib/sheet-record-grid-errors'
import { fetchModelFields } from '#/lib/model-fields'
import { validateSheetRecordBatch } from '#/lib/sheet-record-mapping'
import {
  resolveSheetWriteTarget,
  SheetBatchValidationError,
  SheetMixedAuthorityWriteError,
  sheetCellWriteError,
  writeSheetCells,
} from '#/lib/sheet-write-back'
import { sheetRecordTargetModelKey } from '#/lib/sheet-record-target'

const client = createDataClient()

function errorText(error: unknown) {
  if (error instanceof DataClientError) return error.message
  if (error instanceof Error) return error.message
  return null
}

/** GRID-04: keep persisted column widths inside the canonical 40–2000 range. */
function clampColumnWidth(width: number): number {
  return Math.min(2_000, Math.max(40, Math.round(width)))
}

/**
 * GRID-03 — the target Model key of a Record-reference field's relationship,
 * or null when the field is not a Model-scoped reference.
 */
export function recordPickerTargetModelKey(
  field: FieldDefinition | null,
): string | null {
  const target = field?.relationship?.target
  return target?.kind === 'model' ? target.modelKey : null
}

/**
 * GRID-03 — display-only text for a Record-reference cell. The canonical
 * stored value is the Record UUID; a known pick's human label
 * (`RECORD_REFERENCE_CELL_FORMAT` label/identity form) is shown instead.
 * Unknown or persisted-without-session-label values render the UUID as-is —
 * the display never invents identity that the server did not confirm.
 */
export function recordCellDisplayText(
  labels: Record<string, { identifier: string; title: string } | undefined>,
  value: unknown,
): string {
  const recordId = typeof value === 'string' ? value : null
  if (recordId === null) return ''
  const snapshot = labels[recordId]
  return snapshot ? formatRecordReferenceLabel(snapshot) : recordId
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
  // GRID-04: saved working view lives in localStorage per Sheet Instance and
  // is re-validated against the active columns before restore (untrusted
  // persisted state, Dataset Explorer saved-view pattern).
  const [savedViewExists, setSavedViewExists] = useState(() =>
    hasSavedSheetView(instance.id),
  )
  // GRID-03: the shared Record picker serves both the toolbar link flow and
  // record-picker cell edits. `cell` is set when the edit originated in a
  // specific cell (the pick writes that cell's UUID); null means the toolbar
  // link flow. The label map feeds the display renderer only — display never
  // changes stored state.
  const [picker, setPicker] = useState<{
    modelKey: string
    cell: { row: number; col: number } | null
  } | null>(null)
  const recordLabelsRef = useRef<
    Record<string, { identifier: string; title: string } | undefined>
  >({})
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

  const canonicalMatrix = useMemo(
    () =>
      canonicalSheetGridMatrix({
        instance,
        composition: composition.data ?? null,
        calculationResults: calculations.data?.mapped,
      }),
    [instance, composition.data, calculations.data],
  )
  // GRID-04: presentation (sort/filter/freeze/hide/widths/order) is local
  // working state. It resequences the *display* columns only — the canonical
  // matrix, row identity and write attribution are untouched, and the Dataset
  // explorer / ChartSpec analysis filters are entirely separate surfaces.
  const presentation = instance.state.presentation
  const matrix = useMemo(
    () => applySheetPresentation(canonicalMatrix, presentation),
    [canonicalMatrix, presentation],
  )
  const matrixRef = useRef(matrix)
  matrixRef.current = matrix
  // GRID-04 #113: the canonical matrix behind the display projection —
  // filters resolve condition column IDs through it so a saved filter on a
  // hidden column survives.
  const canonicalMatrixRef = useRef(canonicalMatrix)
  canonicalMatrixRef.current = canonicalMatrix
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
    queryKey: ['sheet-record-search', picker?.modelKey, query],
    queryFn: () =>
      searchSheetRecords({ modelKey: picker!.modelKey, query }, client),
    enabled: picker !== null && Boolean(picker.modelKey),
  })
  const actions = resolveSheetRecordActions(
    composition.data?.definitionConfiguration ?? null,
  )
  const selectedColumn = matrix.columns.at(selected.col)
  const selectedRowKey = matrix.rowKeys.at(selected.row)
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

  // GRID-04: presentation writes go through the existing sheet-instance state
  // mutation path (`update_sheet_instance` with an expected revision), which
  // is the same optimistic-revision contract the rest of the editor uses. The
  // server rejects any change to localFields/localValues here, so a
  // presentation write can never smuggle scientific data changes through.
  async function persistPresentation(
    patch: Partial<SheetPresentation>,
    attempt = 0,
  ): Promise<boolean> {
    const current = instanceRef.current
    try {
      const next = await updateSheetInstance(
        current.id,
        current.revision,
        {
          ...current.state,
          presentation: { ...current.state.presentation, ...patch },
        },
        sheetInstanceDataClient,
      )
      instanceRef.current = next
      queryClient.setQueryData(['sheet-instance', instance.id], next)
      return true
    } catch (error) {
      // GRID-04 review fix: rapid view controls read the same expected
      // revision, so a stale-revision rejection would silently drop the
      // second write. Re-read the authoritative instance and retry once.
      const message = errorText(error) ?? ''
      if (attempt === 0 && /stale/i.test(message)) {
        const fresh = await queryClient.fetchQuery({
          queryKey: ['sheet-instance', instance.id],
          queryFn: () =>
            fetchSheetInstance(instance.id, sheetInstanceDataClient),
        })
        if (fresh) {
          instanceRef.current = fresh
          return persistPresentation(patch, attempt + 1)
        }
      }
      setWriteStatus(
        message || 'The working view could not be saved to the Sheet state.',
      )
      return false
    }
  }

  async function addColumn() {
    const activeFields = instance.state.localFields.filter(
      (field) => field.lifecycle === 'active',
    )
    const field = createAdHocTextField(
      columnLabel,
      activeFields.map((item) => item.key),
    )
    await persistLocalCells([], {
      fieldChanges: [{ operation: 'add', field }],
    })
    setColumnLabel('')
  }

  async function addRow() {
    const activeFields = instance.state.localFields.filter(
      (field) => field.lifecycle === 'active',
    )
    const fieldChanges: LocalFieldChange[] = []
    const existing = activeFields.at(0)
    const field =
      existing ??
      createAdHocTextField(
        columnLabel,
        activeFields.map((item) => item.key),
      )
    if (!existing) fieldChanges.push({ operation: 'add', field })
    const rowKey = crypto.randomUUID()
    await persistLocalCells([{ rowKey, fieldId: field.fieldId, value: null }], {
      fieldChanges,
      rows: [{ kind: 'local', rowKey }],
    })
    setColumnLabel('')
  }

  async function deleteLocalRow(rowKey: string) {
    const current = instanceRef.current
    const nextValues = { ...current.state.localValues }
    delete nextValues[rowKey]
    const next = await updateSheetInstance(
      current.id,
      current.revision,
      { ...current.state, localValues: nextValues },
      sheetInstanceDataClient,
    )
    queryClient.setQueryData(['sheet-instance', current.id], next)
  }



  // GRID-04 — saved working views. The snapshot is the presentation object
  // only: sorts, filters, freeze, hidden columns, widths, order, density. It
  // never carries scientific values, definitions or analysis specs.
  function saveView() {
    saveSheetView(instance.id, instanceRef.current.state.presentation)
    setSavedViewExists(true)
    setWriteStatus('Working view saved on this device.')
  }

  function restoreView() {
    const raw = loadSheetView(instance.id)
    // Validate against the canonical column set, not the display matrix:
    // columns the view itself hides are absent from the display matrix but
    // remain restorable canonical columns.
    const columnIds = new Set(
      canonicalMatrix.columns.map((column) => column.id),
    )
    const restored = raw ? sanitizeSheetPresentation(raw, columnIds) : null
    if (!restored) {
      setWriteStatus('No usable saved view for this Sheet on this device.')
      return
    }
    void persistPresentation(restored).then((saved) => {
      if (!saved) return
      setWriteStatus('Working view restored.')
    })
  }

  function resetView() {
    void persistPresentation({
      columnOrder: [],
      hiddenColumnIds: [],
      columnWidths: {},
      frozenColumnCount: 0,
      filters: [],
      sorts: [],
    }).then((saved) => {
      if (!saved) return
      setWriteStatus('Working view reset to the canonical layout.')
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
      // PLAT-05: one grouped dispatch per dataset/record instead of one RPC
      // per cell — a multi-cell paste over bound columns is a single batch.
      const cells = Object.entries(pendingValues).flatMap(
        ([rowKey, rowCells]) =>
          Object.entries(rowCells).map(([columnId, value]) => ({
            rowKey,
            columnId,
            value,
          })),
      )
      if (cells.length === 0) return
      await writeSheetCells(
        {
          composition: snapshot,
          cells,
          retryToken: crypto.randomUUID(),
        },
        client,
      )
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
      if (error instanceof SheetBatchValidationError) {
        // GRID-02: the server rejected the batch before any authoritative
        // write. Surface the canonical reason; nothing was committed.
        setWriteStatus(
          `Write-back rejected before commit: ${
            error.errors[0]?.code ?? 'validation_failed'
          }. Nothing was written.`,
        )
        return
      }
      if (error instanceof SheetMixedAuthorityWriteError) {
        // GRID-02: the range operation spanned more than one authoritative
        // target and was rejected before any write. Keep the pending values
        // so the scientist can split the edit; do not claim all-or-nothing
        // semantics that were never attempted.
        setWriteStatus(error.message)
        return
      }
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
  addRowRef.current = addRow
  addColumnRef.current = addColumn

  // GRID-03: editing a record-picker cell opens the shared Record picker
  // scoped to the column's own relationship target. The opener only reads
  // refs, so it stays identity-stable across renders.
  const openPickerForCell = useCallback(
    (cell: { row: number; col: number }) => {
      const column = matrixRef.current.columns.at(cell.col)
      const targetModelKey = recordPickerTargetModelKey(column?.field ?? null)
      if (
        !column ||
        column.presentation.kind !== 'record-picker' ||
        !column.editable ||
        !targetModelKey
      ) {
        return
      }
      setPicker({ modelKey: targetModelKey, cell })
    },
    [],
  )

  // Engine cutover — the Sheet Instance planes feed the paged adapter; the
  // engine slices viewport pages, its editor pipeline produces field writes
  // (coerced and validated by the adapter before any authoritative write),
  // and every grid callback maps back onto the GRID-04 presentation working
  // state with stable column ids. Calculation columns render server-computed
  // values: the sheet runs under host calculation authority.
  const engineAdapter = useMemo(
    () =>
      new SheetInstancePagedAdapter({
        instance,
        composition: composition.data ?? null,
        calculationResults: calculations.data?.mapped,
      }),
    [instance, composition.data, calculations.data],
  )
  const engineQuery = useMemo<DatasetQuery>(
    () => ({
      filters: presentationFiltersToQueryFilters(presentation.filters),
      sort: presentationSortsToQuerySorts(presentation.sorts),
    }),
    [presentation.filters, presentation.sorts],
  )
  const engineFields = useMemo(
    () =>
      matrix.columns.map((column, index) => ({
        id: column.id,
        label: canonicalSheetColumnHeader(column),
        column: index,
        dataType:
          column.presentation.kind === 'record-picker'
            ? ('relationship' as const)
            : column.presentation.kind === 'number'
              ? ('number' as const)
              : column.presentation.kind === 'date'
                ? ('date' as const)
                : column.presentation.kind === 'checkbox'
                  ? ('boolean' as const)
                  : ('text' as const),
        writable: canWrite && column.editable,
        required: column.field ? !column.field.nullable : false,
        options:
          column.presentation.kind === 'category-select' && column.field
            ? selectableFieldOptions(column.field, null).map(
                (option) => option.label,
              )
            : undefined,
      })),
    [matrix.columns, canWrite],
  )
  const readOnlyRowSet = useMemo(
    () =>
      canWrite
        ? new Set<number>()
        : new Set(matrix.rowKeys.map((_, index) => index)),
    [canWrite, matrix.rowKeys],
  )
  const initialColumnWidths = useMemo(
    () =>
      matrix.columns.map(
        (column) =>
          instanceRef.current.state.presentation.columnWidths[column.id] ?? 180,
      ),
    [matrix.columns],
  )

  const persistQuery = useCallback(
    (next: DatasetQuery) => {
      const filters: SheetPresentation['filters'] = []
      for (const filter of next.filters ?? []) {
        const persistable =
          filter.value == null ||
          typeof filter.value === 'string' ||
          typeof filter.value === 'number' ||
          typeof filter.value === 'boolean'
        if (filter.operator === 'eq' && persistable)
          filters.push({
            columnId: filter.fieldId,
            operator: 'equals',
            value: filter.value,
          })
        else if (filter.operator === 'neq' && persistable)
          filters.push({
            columnId: filter.fieldId,
            operator: 'not-equals',
            value: filter.value,
          })
        else if (filter.operator === 'isNull')
          filters.push({ columnId: filter.fieldId, operator: 'is-empty' })
        else if (filter.operator === 'notNull')
          filters.push({ columnId: filter.fieldId, operator: 'is-not-empty' })
        // Richer engine conditions stay session-visual: the persisted working
        // view keeps only what the presentation schema can restore (GRID-04).
      }
      const sorts = (next.sort ?? []).map((sort) => ({
        columnId: sort.fieldId,
        direction: sort.direction,
      }))
      void persistPresentation({ filters, sorts })
    },
    [persistPresentation],
  )
  const handleFrozenColumnsChange = useCallback(
    (count: number) => {
      void persistPresentation({ frozenColumnCount: count })
    },
    [persistPresentation],
  )
  const handleColumnWidthsChange = useCallback(
    (widths: readonly number[]) => {
      const columnWidths = {
        ...instanceRef.current.state.presentation.columnWidths,
      }
      matrixRef.current.columns.forEach((column, index) => {
        const width = widths[index]
        if (typeof width === 'number' && width > 0)
          columnWidths[column.id] = clampColumnWidth(width)
      })
      void persistPresentation({ columnWidths })
    },
    [persistPresentation],
  )
  const handleColumnMove = useCallback(
    (from: number, to: number) => {
      const order = matrixRef.current.columns.map((column) => column.id)
      const [moved] = order.splice(from, 1)
      if (!moved) return
      order.splice(Math.max(0, Math.min(to, order.length)), 0, moved)
      void persistPresentation({ columnOrder: order })
    },
    [persistPresentation],
  )
  const handleColumnVisibilityChange = useCallback(
    (fieldId: string, visible: boolean) => {
      const hidden = new Set(
        instanceRef.current.state.presentation.hiddenColumnIds,
      )
      if (visible) hidden.delete(fieldId)
      else hidden.add(fieldId)
      void persistPresentation({ hiddenColumnIds: [...hidden] })
    },
    [persistPresentation],
  )
  const handleWriteStateChange = useCallback(
    (
      _address: string,
      status: 'pending' | 'saved' | 'conflict' | 'failed',
    ) => {
      if (status === 'failed')
        setWriteStatus(
          'That cell could not be saved — the value was rejected.',
        )
      else if (status === 'conflict')
        setWriteStatus(
          'That cell changed on the server. Reload the Sheet to pick up the current values.',
        )
      else if (status === 'saved') setWriteStatus('Saved.')
    },
    [],
  )
  const handleSelectionChange = useCallback(
    (selection: { address: string }) => {
      const parsed = parseAddress(selection.address)
      setSelected({ row: parsed.row, col: parsed.column })
    },
    [],
  )

  // GRID-03 display seams through the Phase 1 extension layer: category cells
  // show the human option label and Record-reference cells show the picked
  // label — the canonical stored value (option id / Record UUID) never changes
  // in display.
  const elnRenderer = useMemo(() => {
    const columns: Record<string, ElnColumnConfig> = {}
    for (const column of matrix.columns) {
      if (
        column.presentation.kind === 'category-select' &&
        column.field?.category?.kind === 'embedded'
      ) {
        columns[column.id] = {
          kind: 'category',
          labels: Object.fromEntries(
            column.field.category.options
              .filter((option) => option.lifecycle === 'active')
              .map((option) => [option.id, option.label]),
          ),
        }
      } else if (column.presentation.kind === 'record-picker') {
        columns[column.id] = { kind: 'record-reference' }
      }
    }
    return createElnCellRenderer({
      columns,
      recordLabels: () => {
        const mapped: Record<string, string> = {}
        for (const [recordId, snapshot] of Object.entries(
          recordLabelsRef.current,
        )) {
          if (snapshot) mapped[recordId] = formatRecordReferenceLabel(snapshot)
        }
        return mapped
      },
    })
  }, [matrix.columns])
  const renderCell = useCallback(
    (context: SpreadsheetCellRenderContext) =>
      elnRenderer({
        ...context,
        // The package renderer is field-driven; project the display column's
        // canonical identity so callers need not carry datasetHeader fields.
        field: (() => {
          const column = matrixRef.current.columns[context.point.column]
          return column
            ? {
                id: column.id,
                label: canonicalSheetColumnHeader(column),
                column: context.point.column,
              }
            : context.field
        })(),
      }),
    [elnRenderer],
  )

  // GRID-03: Record-reference cells edit through the shared Record picker.
  // The engine's custom-editor seam opens the same workspace picker panel;
  // the pick persists through the cell's authoritative write path.
  const recordPickerEditors = useMemo(
    () =>
      [
        {
          matches: ({ field }) => field?.dataType === 'relationship',
          render: ({ point, cancel }) => (
            <div className="flex items-center gap-1" role="group" aria-label="Record picker">
              <button
                type="button"
                className="rounded border px-2 py-1 text-xs"
                onClick={() => {
                  openPickerForCell({ row: point.row, col: point.column })
                  cancel()
                }}
              >
                Choose a record…
              </button>
              <button
                type="button"
                className="rounded border px-2 py-1 text-xs"
                onClick={cancel}
              >
                Cancel
              </button>
            </div>
          ),
        },
      ] as SpreadsheetCustomEditor[],
    [openPickerForCell],
  )

  const navigate = useNavigate()
  const elnMenuActions = useMemo(
    () =>
      createRecordMenuActions({
        // The column menu operates on the focused cell: resolve its stored
        // Record UUID from the display matrix.
        recordIdAt: () => {
          const column = matrixRef.current.columns.at(selected.col)
          if (!column || column.presentation.kind !== 'record-picker') return null
          const value = matrixRef.current.data[selected.row]?.[selected.col]
          return typeof value === 'string' && value !== '' ? value : null
        },
        openRecord: (recordId) =>
          void navigate({ to: '/records/$recordId', params: { recordId } }),
      }),
    [navigate, selected.row, selected.col],
  )

  const contextMenuActions = useMemo(
    () => [
      {
        label: 'Insert local row',
        onSelect: ({ axis }: { axis: 'row' | 'column'; index: number }) => {
          if (axis === 'row') void addRowRef.current()
        },
      },
      {
        label: 'Delete local row',
        onSelect: ({ axis, index }: { axis: 'row' | 'column'; index: number }) => {
          if (axis !== 'row') return
          const rowKey = matrixRef.current.rowKeys[index]
          if (!rowKey || matrixRef.current.rowKinds[index] !== 'local') {
            setWriteStatus('Only local rows can be deleted from the Sheet.')
            return
          }
          void deleteLocalRow(rowKey)
        },
      },
      {
        label: 'Add column',
        onSelect: ({ axis }: { axis: 'row' | 'column'; index: number }) => {
          if (axis === 'column') void addColumnRef.current()
        },
      },
      {
        label: 'Retire local column',
        onSelect: ({ axis, index }: { axis: 'row' | 'column'; index: number }) => {
          if (axis !== 'column') return
          const column = matrixRef.current.columns.at(index)
          if (!column || column.origin === 'bound') {
            setWriteStatus('Only local columns can be retired.')
            return
          }
          void persistLocalCells([], {
            fieldChanges: [{ operation: 'retire', fieldId: column.id }],
          })
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const allContextMenuActions = useMemo(
    () => [...contextMenuActions, ...elnMenuActions],
    [contextMenuActions, elnMenuActions],
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
  const visualiseDatasetId = composition.data?.rows
    .flatMap((row) => row.sources)
    .find((source) => source.sourceKind === 'dataset')?.datasetId

  return (
    <div className="flex h-full min-h-[24rem] flex-col">
      <div className="flex shrink-0 items-center justify-end gap-2 border-b px-2 py-1">
        {visualiseDatasetId ? (
          <Button asChild size="sm" variant="outline">
            <Link to="/analysis" search={{ dataset: visualiseDatasetId }}>
              Visualise
            </Link>
          </Button>
        ) : null}
        <ObjectHistoryDialog objectId={instance.id} objectLabel="Sheet" />
        <ExportMenu
          path={`/api/export/sheet-instance/${instance.id}`}
          formats={[
            { format: 'json', label: 'JSON (full state)' },
            { format: 'csv', label: 'CSV (local grid)' },
            { format: 'xlsx', label: 'XLSX (local grid)' },
          ]}
        />
      </div>
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
      {canWrite && matrix.columns.length > 0 ? (
        <div
          className="flex flex-wrap items-center gap-2 border-b px-2 py-1 text-xs"
          role="group"
          aria-label="Working view controls"
        >
          <span className="text-muted-foreground">Working view</span>
          <span className="flex items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-label="Freeze one fewer column"
              disabled={presentation.frozenColumnCount === 0}
              onClick={() =>
                void persistPresentation({
                  frozenColumnCount: Math.max(
                    0,
                    presentation.frozenColumnCount - 1,
                  ),
                })
              }
            >
              −
            </Button>
            <span aria-live="polite">
              {presentation.frozenColumnCount} frozen
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-label="Freeze one more column"
              disabled={presentation.frozenColumnCount >= matrix.columns.length}
              onClick={() =>
                void persistPresentation({
                  frozenColumnCount: Math.min(
                    matrix.columns.length,
                    presentation.frozenColumnCount + 1,
                  ),
                })
              }
            >
              +
            </Button>
          </span>
          {presentation.hiddenColumnIds.length > 0 ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void persistPresentation({ hiddenColumnIds: [] })}
            >
              Show {presentation.hiddenColumnIds.length} hidden column
              {presentation.hiddenColumnIds.length === 1 ? '' : 's'}
            </Button>
          ) : null}
          <span className="ml-auto flex items-center gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={saveView}>
              Save view
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={!savedViewExists}
              onClick={restoreView}
            >
              Restore view
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={resetView}>
              Reset view
            </Button>
          </span>
        </div>
      ) : null}
      {composed && canWrite ? (
        <ComposedSheetRecordToolbar
          actions={actions}
          errors={errors}
          onLink={() => setPicker({ modelKey: modelKey ?? '', cell: null })}
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
          <PagedSpreadsheet
            adapter={engineAdapter}
            datasetId={engineAdapter.datasetId}
            fieldIds={matrix.columns.map((column) => column.id)}
            rowCount={matrix.rowKeys.length}
            columnCount={matrix.columns.length}
            calculationAuthority="host"
            datasetHeader={{
              datasetId: engineAdapter.datasetId,
              fields: engineFields,
            }}
            query={engineQuery}
            onQueryChange={persistQuery}
            frozenColumns={Math.min(
              presentation.frozenColumnCount,
              matrix.columns.length,
            )}
            onFrozenColumnsChange={handleFrozenColumnsChange}
            initialColumnWidths={initialColumnWidths}
            onColumnWidthsChange={handleColumnWidthsChange}
            readOnlyRows={readOnlyRowSet}
            onSelectionChange={handleSelectionChange}
            onWriteStateChange={handleWriteStateChange}
            onColumnMove={handleColumnMove}
            onColumnVisibilityChange={handleColumnVisibilityChange}
            renderCell={renderCell}
            customEditors={recordPickerEditors}
            contextMenuActions={allContextMenuActions}
          />
        </div>
      )}
      <div className="space-y-1 border-t px-3 py-2 text-xs text-muted-foreground">
        <p>
          Sorting, filters, freezing, hidden columns and sizes are a
          display-only working view. They never change the Dataset, the Sheet's
          data or the filters used by analysis (Dataset Explorer and charts keep
          their own scientific query filters).
        </p>
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
          <SheetProvenanceLine
            columnLabel={selectedColumn.label}
            columnOrigin={selectedColumn.origin}
            provenance={provenance}
          />
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
      {canWrite && picker && picker.modelKey ? (
        <div className="border-t">
          <SheetRecordPicker
            modelKey={picker.modelKey}
            results={sheetRecordSearchHitsAsNotebookRecords(
              search.data ?? [],
              projectId ?? '',
            )}
            loading={search.isLoading}
            onSearch={setQuery}
            onSelect={(result) => {
              // Record the human label for the display renderer, then persist
              // the canonical Record UUID. A cell-edit pick flows through the
              // grid's own change pipeline (beforeChange → afterChange →
              // parse → validate → authoritative target); the toolbar link
              // flow keeps its dedicated write path. The server remains the
              // authority on whether the Record exists and is accessible.
              recordLabelsRef.current[result.id] = {
                identifier: result.identifier,
                title: result.title,
              }
              if (picker.cell) {
                // Engine cutover: the pick persists through the cell's
                // authoritative write path (bound → write-back pending batch,
                // local → sheet-instance state mutation) and the queries
                // invalidate so the engine refetches the fresh values.
                const column = matrixRef.current.columns[picker.cell.col]
                const rowKey = matrixRef.current.rowKeys[picker.cell.row]
                if (column && rowKey) {
                  if (column.origin === 'bound' && compositionRef.current) {
                    setPendingValues((current) => ({
                      ...current,
                      [rowKey]: { ...current[rowKey], [column.id]: result.id },
                    }))
                    setWriteStatus(
                      'Record linked. Use Write back to persist governed cells.',
                    )
                  } else {
                    void persistLocalCells([
                      { rowKey, fieldId: column.id, value: result.id },
                    ])
                  }
                }
              } else {
                link.mutate(result.id)
              }
              setPicker(null)
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

/**
 * NAV-02 — provenance line for the selected cell. Bound provenance resolves
 * to the canonical related object: Dataset provenance links to the Dataset
 * explorer, Record provenance to the owning Record — always via stable UUID
 * destinations from the canonical routes, never label-derived paths.
 */
export function SheetProvenanceLine({
  columnLabel,
  columnOrigin,
  provenance,
}: {
  columnLabel: string
  columnOrigin: 'bound' | 'local' | 'calculation'
  provenance:
    | { kind: 'present'; provenance: BoundColumnProvenance }
    | { kind: 'unmatched'; provenance: unknown }
    | null
}) {
  return (
    <p role="status">
      {columnLabel}
      {columnOrigin === 'bound' ? ' · governed' : ` · ${columnOrigin}`}
      {provenance && 'kind' in provenance
        ? provenance.kind === 'present'
          ? ` · ${provenance.provenance.sourceKind} provenance`
          : ' · unmatched source'
        : ''}
      {provenance &&
      provenance.kind === 'present' &&
      provenance.provenance.sourceKind === 'dataset' ? (
        <>
          {' · dataset '}
          <Link
            className="underline underline-offset-2 hover:text-foreground"
            to="/datasets"
            // NAV-02 review fix: the link carries only the stable Dataset
            // ID. The explorer resolves the Dataset's lifecycle itself and
            // flips to the archived view — the link must not claim the
            // active-only filter for a Dataset it knows nothing about.
            search={{ dataset: provenance.provenance.sourceDatasetId }}
          >
            {provenance.provenance.sourceDatasetId}
          </Link>
        </>
      ) : null}
      {provenance &&
      provenance.kind === 'present' &&
      provenance.provenance.sourceKind === 'record' ? (
        <>
          {' · record '}
          <Link
            className="underline underline-offset-2 hover:text-foreground"
            to="/records/$recordId"
            params={{ recordId: provenance.provenance.sourceRecordId }}
          >
            {provenance.provenance.sourceRecordId}
          </Link>
        </>
      ) : null}
    </p>
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
