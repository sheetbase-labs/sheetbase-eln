import { useEffect, useCallback, useMemo, useRef, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import type Handsontable from 'handsontable/base'
import type { BaseEditor } from 'handsontable/editors/baseEditor'
import type { BaseRenderer } from 'handsontable/renderers'

import type { FieldDefinition } from '#/lib/field-definition'
import { SheetbaseGrid } from '#/components/sheet/sheetbase-grid'
import { SheetRecordPicker } from '#/components/sheet/sheet-record-picker'
import { createRecordPickerEditor } from '#/components/sheet/record-picker-editor'
import { ComposedSheetRecordToolbar } from '#/components/sheet/composed-sheet-record-toolbar'
import { CanonicalSheetLifecyclePanel } from '#/components/sheet/canonical-sheet-lifecycle-panel'
import { ModelFieldInput } from '#/components/scientific/model-field-input'
import { Button, Input, Label } from '#/components/ui'
import { createDataClient, DataClientError } from '#/lib/data-client'
import {
  applySheetPresentation,
  canonicalSheetColumnHeader,
  canonicalSheetGridMatrix,
  categoryCellDisplayText,
  clearContentsUpdates,
  filterAdditionsToDisplayColumns,
  hotFiltersToPresentationFilters,
  parseSheetCellInput,
  preserveHiddenColumnFilters,
  presentationFiltersToHotAdditions,
  resolveCanonicalCellChanges,
  validateCanonicalCell,
} from '#/lib/canonical-sheet-grid'
import type {
  CanonicalSheetGridColumn,
  HotFilterConditionStack,
} from '#/lib/canonical-sheet-grid'
import {
  fetchComposedSheetPaged,
} from '#/lib/sheet-composition-data'
import type {
  ComposedSheetPagedSnapshot,
  ComposedSheetSnapshot,
} from '#/lib/sheet-composition-data'
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

/** Visual-coordinate selection ranges handed to context/dropdown callbacks. */
type MenuSelection = Array<{
  start: { row: number | null; col: number | null }
  end: { row: number | null; col: number | null }
}>

function categoryCellRenderer(field: FieldDefinition): BaseRenderer {
  // GRID-03: category cells store the canonical option id but display the
  // human label. Display only — the value never changes here.
  return (_instance, td, _row, _col, _prop, value) => {
    td.textContent = categoryCellDisplayText(field, value)
    return td
  }
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

/** GRID-03 — display renderer for Record-reference cells (label, not UUID). */
function recordCellRenderer(
  labels: () => Record<
    string,
    { identifier: string; title: string } | undefined
  >,
): BaseRenderer {
  return (_instance, td, _row, _col, _prop, value) => {
    td.textContent = recordCellDisplayText(labels(), value)
    return td
  }
}

function handsontableType(
  column: CanonicalSheetGridColumn,
  recordPicker?: {
    editor: typeof BaseEditor
    renderer: BaseRenderer
  } | null,
): {
  type: string
  dateFormat?: string
  correctFormat?: boolean
  source?: string[]
  editor?: typeof BaseEditor
  renderer?: BaseRenderer
} {
  const kind = column.presentation.kind
  if (kind === 'checkbox') return { type: 'checkbox' }
  if (kind === 'number') return { type: 'numeric' }
  if (kind === 'date') return { type: 'date' }
  // GRID-03 review fix: Handsontable 18's `date` cell type is a native
  // <input type="date"> — it cannot hold or produce a time and rejects
  // canonical `…Z` instants on edit, which would make timestamp columns
  // uneditable. Timestamps keep the text editor; parseSheetCellInput coerces
  // bare input to a canonical UTC instant before validation (bare input is
  // interpreted as UTC because the grid carries no timezone context).
  if (kind === 'datetime-local') return { type: 'text' }
  if (kind === 'record-picker' && recordPicker) {
    // GRID-03: Record/reference cells edit through the shared search-select
    // Record picker. Selection writes the canonical Record UUID through the
    // normal change pipeline; the human label is display only.
    return {
      type: 'text',
      editor: recordPicker.editor,
      renderer: recordPicker.renderer,
    }
  }
  if (kind === 'category-select' && column.field) {
    // GRID-03: the dropdown is seeded from the field's canonical vocabulary
    // (active embedded options). Vocabulary-backed fields without a local
    // option list keep a text editor — the server still owns validation.
    const source = selectableFieldOptions(column.field, null).map(
      (option) => option.label,
    )
    if (source.length > 0) {
      return {
        type: 'dropdown',
        source,
        renderer: categoryCellRenderer(column.field),
      }
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

  // GRID-05: explicit row windowing — the server caps one composition window
  // at COMPOSED_SHEET_PAGE_SIZE rows and reports overflow via `hasMore`.
  // Page count grows only through the visible "Load more" action. Each step
  // fetches ONLY the newly requested window (offset = rows already loaded)
  // by reusing the previous merged snapshot from the query cache — never
  // pages 1..N again. Rows merge by stable rowKey (never positions), so
  // pending edits and write-back attribution survive paging. The first
  // window pins the authoritative revision; a concurrent change that moves
  // the revision mid-paging restarts from offset 0 with a visible notice
  // instead of silently duplicating or skipping rows.
  const [pageCount, setPageCount] = useState(1)
  useEffect(() => {
    setPageCount(1)
  }, [instance.id])
  const composition = useQuery({
    queryKey: ['composed-sheet', instance.id, pageCount],
    queryFn: async () => {
      const previous =
        pageCount > 1
          ? queryClient.getQueryData<ComposedSheetPagedSnapshot>([
              'composed-sheet',
              instance.id,
              pageCount - 1,
            ])
          : undefined
      const previousState =
        pageCount > 1
          ? queryClient.getQueryState([
              'composed-sheet',
              instance.id,
              pageCount - 1,
            ])
          : undefined
      // A write-back/link/create invalidation marks every composed-sheet key
      // stale: the cached merge is no longer authoritative, so refetch from
      // offset 0 instead of appending a fresh window onto stale rows.
      const reusable =
        previous && !previousState?.isInvalidated ? previous : undefined
      return fetchComposedSheetPaged(instance.id, {
        pageCount,
        previous: reusable?.snapshot ?? null,
        previousPageCount: reusable ? pageCount - 1 : 0,
        client,
      })
    },
    enabled: composed,
    placeholderData: keepPreviousData,
  })
  const composedSnapshot = composition.data?.snapshot ?? null

  const rowKeysForCalc = useMemo(() => {
    if (composedSnapshot)
      return composedSnapshot.rows.map((row) => row.rowKey)
    return Object.keys(instance.state.localValues)
  }, [composedSnapshot, instance.state.localValues])

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
        composition: composedSnapshot,
        calculationResults: calculations.data?.mapped,
      }),
    [instance, composedSnapshot, calculations.data],
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
  const compositionRef = useRef<ComposedSheetSnapshot | null>(
    composedSnapshot,
  )
  compositionRef.current = composedSnapshot

  const modelKey = sheetRecordTargetModelKey(
    composedSnapshot?.definitionConfiguration,
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
    composedSnapshot?.definitionConfiguration ?? null,
  )
  const selectedColumn = matrix.columns.at(selected.col)
  const selectedRowKey = matrix.rowKeys.at(selected.row)
  const provenance =
    composedSnapshot?.boundProjection?.rows.find(
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
    const column = matrix.columns.at(selected.col)
    if (!column || column.origin === 'bound') return
    await persistLocalCells([], {
      fieldChanges: [{ operation: 'retire', fieldId: column.id }],
    })
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
      const snapshot = composedSnapshot
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
      const snapshot = composedSnapshot
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

  // GRID-02/GRID-04: the clear-contents context-menu action edits through the
  // grid's own change pipeline, so it needs the live instance. The ref pattern
  // keeps the memoised settings stable; onReady stays identity-stable so the
  // memoised grid client never re-renders (editors stay alive).
  const hotInstanceRef = useRef<Handsontable | null>(null)
  // GRID-04: set while saved filters are being (re)applied through the Filters
  // plugin, so the resulting `afterFilter` echo never re-persists the state it
  // was restoring.
  const applyingFiltersRef = useRef(false)
  // GRID-04: Handsontable reports visual indexes; sorting, filters, hidden
  // columns and manual column moves all shift them. Resolve to the composed
  // matrix's physical coordinates before any column/row attribution so
  // presentation changes never scramble writes — the same contract GRID-02
  // established for rows with `toPhysicalRow`.
  const physicalRow = useCallback((visualRow: number) => {
    const mapped = hotInstanceRef.current?.toPhysicalRow(visualRow)
    return typeof mapped === 'number' && mapped >= 0 ? mapped : visualRow
  }, [])
  const physicalColumn = useCallback((visualColumn: number) => {
    const mapped = hotInstanceRef.current?.toPhysicalColumn(visualColumn)
    return typeof mapped === 'number' && mapped >= 0 ? mapped : visualColumn
  }, [])
  const handleGridReady = useCallback((hot: Handsontable | null) => {
    hotInstanceRef.current = hot
  }, [])

  // GRID-03: editing a record-picker cell opens the shared Record picker
  // scoped to the column's own relationship target. The opener only reads
  // refs, so it stays identity-stable and the memoised grid settings (and its
  // editors) never re-create.
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
  const recordPicker = useMemo(
    () => ({
      editor: createRecordPickerEditor(openPickerForCell),
      renderer: recordCellRenderer(() => recordLabelsRef.current),
    }),
    [openPickerForCell],
  )

  const settings = useMemo(
    () => {
    // GRID-04: persisted sorts restore as the columnSorting initial config.
    // Handsontable sorts rows client-side over the composed matrix; the
    // physical data order (and therefore rowKey attribution) is untouched.
    const sortInitialConfig = presentation.sorts.flatMap((sort) => {
      const column = matrix.columns.findIndex(
        (item) => item.id === sort.columnId,
      )
      return column >= 0 ? [{ column, sortOrder: sort.direction }] : []
    })
    return {
      data: matrix.data,
      // GRID-03: quantity columns surface their storage unit in the header
      // (display only; units are never converted client-side).
      colHeaders: matrix.columns.map(canonicalSheetColumnHeader),
      columns: matrix.columns.map((column) => ({
        ...handsontableType(column, canWrite ? recordPicker : null),
        readOnly: !canWrite || !column.editable,
      })),
      rowHeaders: true,
      // GRID-04: manual widths need non-stretching columns; the last column
      // still stretches so the grid keeps filling the workspace.
      stretchH: 'last' as const,
      colWidths: (visualColumn: number) => {
        const column = matrix.columns.at(physicalColumn(visualColumn))
        return column
          ? instanceRef.current.state.presentation.columnWidths[column.id]
          : undefined
      },
      height: '100%',
      copyPaste: true,
      fillHandle: true,
      minSpareRows: canWrite ? 1 : 0,
      // GRID-04: multi-column sort is visual only — it reorders rows through
      // Handsontable's row index map and is persisted as presentation state,
      // never as Dataset or analysis semantics.
      columnSorting:
        sortInitialConfig.length > 0
          ? { initialConfig: sortInitialConfig }
          : true,
      filters: true,
      dropdownMenu: {
        items: {
          filter_by_condition: {},
          filter_operators: {},
          filter_by_condition2: {},
          filter_by_value: {},
          filter_action_bar: {},
          sp_filters: { name: '---------' },
          freeze_to_column: {
            name: 'Freeze up to this column',
            disabled: () => !canWrite,
            callback: (_key: string, selection: MenuSelection) => {
              const start = selection.at(0)?.start.col
              if (typeof start !== 'number' || start < 0) return
              void persistPresentation({
                frozenColumnCount: Math.min(
                  matrixRef.current.columns.length,
                  start + 1,
                ),
              })
            },
          },
          unfreeze_columns: {
            name: 'Unfreeze columns',
            disabled: () => presentation.frozenColumnCount === 0,
            callback: () => {
              void persistPresentation({ frozenColumnCount: 0 })
            },
          },
          sp_presentation: { name: '---------' },
          hide_column: {
            name: 'Hide selected columns',
            disabled: () => !canWrite,
            callback: (_key: string, selection: MenuSelection) => {
              const range = selection.at(0)
              if (!range) return
              // GRID-04 review fix: never coerce null coordinates into
              // "hide column 0" — a header menu always carries the anchor.
              if (range.start.col == null || range.end.col == null) return
              const from = Math.min(range.start.col, range.end.col)
              const to = Math.max(range.start.col, range.end.col)
              const hidden = new Set(
                instanceRef.current.state.presentation.hiddenColumnIds,
              )
              for (let col = from; col <= to; col += 1) {
                const column = matrixRef.current.columns.at(physicalColumn(col))
                if (column) hidden.add(column.id)
              }
              void persistPresentation({
                hiddenColumnIds: [...hidden],
              })
            },
          },
        },
      },
      // GRID-04: drag-to-reorder is presentation-only. The composed matrix is
      // rebuilt in the persisted order (applySheetPresentation), so after each
      // move the plugin's visual index map is reset and the new order is
      // persisted as column IDs — Handsontable never becomes a second
      // authority for column identity, and toPhysicalColumn keeps write
      // attribution correct in the meantime.
      manualColumnMove: true,
      manualColumnResize: true,
      fixedColumnsStart: Math.min(
        presentation.frozenColumnCount,
        matrix.columns.length,
      ),
      autoWrapRow: false,
      // GRID-02/GRID-03: every write source — bulk paste/fill/clear and
      // single typed edits alike — is coerced and validated against the
      // typed column contract before Handsontable applies anything. An
      // invalid value cancels the whole change, so the cell visibly keeps
      // its previous value and the canonical reason is announced: the
      // visible grid can never diverge from the authoritative state.
      // GRID-04: change columns arrive as visual indexes; they are mapped
      // onto the composed matrix before the typed contract is resolved so a
      // moved or hidden column never misattributes a write.
      beforeChange: (
        changes: Array<[number, string | number, unknown, unknown]> | null,
        source: string,
      ) => {
        if (!changes || changes.length === 0) return undefined
        const result = resolveCanonicalCellChanges(
          matrixRef.current.columns,
          changes.map((change) => {
            const columnIndex =
              typeof change[1] === 'number' ? change[1] : Number(change[1])
            if (!Number.isFinite(columnIndex)) return change
            return [
              change[0],
              physicalColumn(columnIndex),
              change[2],
              change[3],
            ]
          }),
        )
        if (!result.rejection) {
          // GRID-03: apply the coerced canonical values (category option id,
          // UTC instant, grouped-number) so the grid shows what will be
          // written, not the raw editor output.
          for (let index = 0; index < changes.length; index += 1) {
            changes[index][3] = result.changes[index]?.[3]
          }
          return undefined
        }
        const verb =
          source === 'CopyPaste.paste'
            ? 'Paste'
            : source === 'Autofill.fill'
              ? 'Fill'
              : source === 'sheetbase.clear-contents'
                ? 'Clear'
                : 'Edit'
        setWriteStatus(
          result.rejection.kind === 'read_only_column'
            ? `${verb} rejected: the range contains read-only or derived cells.`
            : `${verb} rejected: ${result.rejection.detail} in ${result.rejection.label}. The cell kept its previous value.`,
        )
        // Nullify the entries instead of only returning false: Handsontable
        // 18's undo plugin records any non-null change set regardless of a
        // false return, so a bare rejection would leave a no-op undo step
        // whose Ctrl+Z re-persists unchanged values to the server.
        for (let index = 0; index < changes.length; index += 1) {
          changes[index] = null as unknown as (typeof changes)[number]
        }
        return false
      },
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
          sp2: { name: '---------' },
          clear_contents: {
            name: 'Clear contents',
            disabled: () => !canWrite,
            callback: () => {
              // GRID-02: clearing writes nulls through the same per-cell
              // semantics as editing (parse → validate → authoritative
              // target). Read-only/derived cells and empty spare-row cells
              // are skipped; the workspace beforeChange bulk-validation
              // rejects the whole operation if any cleared cell violates
              // the typed contract (e.g. a required field), so the visible
              // grid never diverges from the authoritative state.
              const hot = hotInstanceRef.current
              if (!hot) return
              const ranges = hot.getSelectedRange()
              if (!ranges || ranges.length === 0) return
              const updates = clearContentsUpdates(
                matrixRef.current.columns,
                ranges,
                (row, col) => hot.getDataAtCell(row, col),
                physicalColumn,
              )
              if (updates.length === 0) {
                setWriteStatus(
                  'Nothing to clear: the selection has no editable, non-empty cells.',
                )
                return
              }
              hot.setDataAtCell(updates, 'sheetbase.clear-contents')
            },
          },
        },
      },
      // GRID-04: selection is stored in physical coordinates so delete,
      // provenance and status resolve the column/row the user actually
      // selected, whatever the current sort/filter/move state is.
      afterSelectionEnd: (row: number, col: number) => {
        if (row >= 0 && col >= 0)
          setSelected({ row: physicalRow(row), col: physicalColumn(col) })
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
        // GRID-02: Handsontable reports visual row indexes; with column
        // sorting active they diverge from the canonical matrix's physical
        // order. Resolve the physical row first so a change is attributed to
        // the rowKey it was actually edited on — never a neighbour's.
        // GRID-04: columns resolve through the same visual→physical mapping
        // so moved or hidden columns keep write attribution too.
        for (const change of changes) {
          const columnIndex =
            typeof change[1] === 'number' ? change[1] : Number(change[1])
          const column = currentMatrix.columns.at(
            Number.isFinite(columnIndex) ? physicalColumn(columnIndex) : -1,
          )
          if (!column || !column.editable) continue
          const physicalIndex = physicalRow(change[0])
          let rowKey =
            currentMatrix.rowKeys[physicalIndex] ?? created.get(physicalIndex)
          if (!rowKey) {
            rowKey = crypto.randomUUID()
            created.set(physicalIndex, rowKey)
          }
          const value = parseSheetCellInput(column.field, change[3])
          // GRID-03 safety net: beforeChange already rejected and reverted
          // invalid values for every write source, so this branch only fires
          // if a change reaches afterChange without passing through it.
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
      // GRID-04: persist resized column widths (presentation state only).
      afterColumnResize: (newSize: number, visualColumn: number) => {
        const column = matrixRef.current.columns.at(
          physicalColumn(visualColumn),
        )
        if (!column) return
        const current = instanceRef.current.state.presentation.columnWidths
        void persistPresentation({
          columnWidths: { ...current, [column.id]: clampColumnWidth(newSize) },
        })
      },
      // GRID-04: persist the new column order as stable column IDs and reset
      // the plugin's visual index map — the rebuilt matrix already carries
      // the persisted order, so the map must stay identity or the next
      // data reload would double-apply the move.
      afterColumnMove: (
        _movedColumns: number[],
        _finalIndex: number,
        _dropIndex: number | undefined,
        movePossible: boolean,
        orderChanged: boolean,
      ) => {
        const hot = hotInstanceRef.current
        if (!hot || !movePossible || !orderChanged) return
        const count = hot.countCols()
        // GRID-04 review fix: the ManualColumnMove plugin has ALREADY applied
        // its index-mapper move by the time this hook runs, so the new order
        // must be read through the mapper BEFORE it is reset to identity —
        // resetting first collapses toPhysicalColumn to identity and the
        // pre-move order gets persisted (the drag would silently snap back).
        const order: string[] = []
        for (let visual = 0; visual < count; visual += 1) {
          const column = matrixRef.current.columns.at(physicalColumn(visual))
          if (column) order.push(column.id)
        }
        hot.columnIndexMapper.setIndexesSequence(
          Array.from({ length: count }, (_, index) => index),
        )
        void persistPresentation({ columnOrder: order })
      },
      // GRID-04: sorting is visual only. Persist the destination sort config
      // (mapped back to stable column IDs); an equality guard stops the
      // restored initialConfig from re-writing identical state.
      afterColumnSort: (
        _currentSortConfig: Array<{ column: number; sortOrder: string }>,
        destinationSortConfigs: Array<{ column: number; sortOrder: string }>,
      ) => {
        const sorts: SheetPresentation['sorts'] = []
        for (const config of destinationSortConfigs) {
          if (config.sortOrder !== 'asc' && config.sortOrder !== 'desc')
            continue
          const column = matrixRef.current.columns.at(
            physicalColumn(config.column),
          )
          if (column)
            sorts.push({ columnId: column.id, direction: config.sortOrder })
        }
        const previous = instanceRef.current.state.presentation.sorts
        if (JSON.stringify(sorts) === JSON.stringify(previous)) return
        void persistPresentation({ sorts })
      },
      // GRID-04: dropdown-menu filter state is captured as presentation
      // state. `afterFilter` hands over the plugin's conditions stack keyed
      // by physical column index; it is mapped to stable column ids (equality
      // operators only — see `hotFiltersToPresentationFilters`) and persisted
      // with the same equality guard as sorts. Restores echo through this
      // hook; `applyingFiltersRef` keeps that from re-writing identical
      // state, and the JSON guard catches any identical user action.
      afterFilter: (conditionsStack: HotFilterConditionStack[]) => {
        if (applyingFiltersRef.current) return
        const captured = hotFiltersToPresentationFilters(
          conditionsStack,
          matrixRef.current.columns,
        )
        // GRID-04 #113: a hidden column has no grid column at all, so its
        // condition cannot exist in the plugin's stack — carry the previous
        // persisted filters for hidden columns across, or they would be
        // silently dropped by any later capture.
        const filters = preserveHiddenColumnFilters(
          captured,
          instanceRef.current.state.presentation.filters,
          canonicalMatrixRef.current.columns,
          matrixRef.current.columns,
        )
        const previous = instanceRef.current.state.presentation.filters
        if (JSON.stringify(filters) === JSON.stringify(previous)) return
        void persistPresentation({ filters })
      },
    }
    },
    [
      matrix,
      canWrite,
      presentation,
      physicalRow,
      physicalColumn,
      recordPicker,
    ],
  )

  // GRID-04: whenever the display column set changes (reorder persisted,
  // hide/show, column added/retired), the grid is rebuilt from the canonical
  // matrix in presentation order — make sure the manualColumnMove plugin's
  // visual index map never lingers over a different matrix shape.
  const columnIdsKey = matrix.columns.map((column) => column.id).join('|')
  useEffect(() => {
    const hot = hotInstanceRef.current
    if (!hot) return
    const mapper = hot.columnIndexMapper
    const identity = Array.from(
      { length: hot.countCols() },
      (_, index) => index,
    )
    const current = mapper.getIndexesSequence()
    if (
      current.length !== identity.length ||
      current.some((p, i) => p !== identity[i])
    ) {
      mapper.setIndexesSequence(identity)
    }
  }, [columnIdsKey])

  // GRID-04: saved filters are applied through the Filters plugin on mount
  // and re-applied after every grid rebuild — a presentation change reloads
  // Handsontable's data (new matrix identity), which clears in-session plugin
  // state, so the persisted presentation must be replayed onto the fresh grid.
  // The apply sets `applyingFiltersRef` first: `filter()` fires `afterFilter`
  // synchronously and that echo must not re-persist restored state.
  const filtersKey = JSON.stringify(presentation.filters)
  useEffect(() => {
    const hot = hotInstanceRef.current
    if (!hot) return
    const filtersPlugin = hot.getPlugin('filters') as
      | {
          clearConditions: () => void
          addCondition: (
            column: number,
            name: string,
            args: unknown[],
            operation?: string,
          ) => void
          filter: () => void
        }
      | undefined
    if (!filtersPlugin) return
    const filters = instanceRef.current.state.presentation.filters
    applyingFiltersRef.current = true
    try {
      filtersPlugin.clearConditions()
      // GRID-04 #113: resolve condition columns through the CANONICAL
      // column list, not the display subset — a saved filter on a hidden
      // column must survive the replay (it is applied the moment the
      // column is shown again), instead of being silently dropped.
      const canonicalColumns = canonicalMatrixRef.current.columns
      for (const addition of filterAdditionsToDisplayColumns(
        presentationFiltersToHotAdditions(filters, canonicalColumns),
        canonicalColumns,
        matrix.columns,
      )) {
        filtersPlugin.addCondition(
          addition.column,
          addition.name,
          addition.args,
          'conjunction',
        )
      }
      filtersPlugin.filter()
    } finally {
      applyingFiltersRef.current = false
    }
  }, [matrix, filtersKey])

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
  const visualiseDatasetId = composedSnapshot?.rows
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
            if (!projectId || !composedSnapshot || !modelKey) return
            const rows = composedSheetRecordLinkBatchRows(
              composedSnapshot,
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
            if (!projectId || !composedSnapshot || !modelKey) return
            const rows = composedSheetRecordLinkBatchRows(
              composedSnapshot,
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
      {composed ? (
        <div
          className="flex flex-wrap items-center gap-2 border-b px-2 py-1 text-xs text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          {composition.isLoading ? (
            <span>Loading composed rows…</span>
          ) : (
            <>
            <span>
              {composedSnapshot?.hasMore
                ? `Showing ${matrix.rowKeys.length} rows — more rows available. Filters and sorts apply to the loaded rows only.`
                : `Showing all ${matrix.rowKeys.length} rows.`}
            </span>
            {composition.data?.notice ? (
              <span>{composition.data.notice}</span>
            ) : null}
            </>
          )}
          {composedSnapshot?.hasMore ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={composition.isFetching}
              onClick={() => setPageCount((count) => count + 1)}
            >
              {composition.isFetching ? 'Loading more…' : 'Load more'}
            </Button>
          ) : null}
        </div>
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
            settings={settings}
            onReady={handleGridReady}
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
                hotInstanceRef.current?.setDataAtCell(
                  picker.cell.row,
                  picker.cell.col,
                  result.id,
                  'sheetbase.record-picker',
                )
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
