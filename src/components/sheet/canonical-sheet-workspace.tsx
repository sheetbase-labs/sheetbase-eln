import { useEffect, useCallback, useMemo, useRef, useState } from 'react'
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { Link, useRouteContext } from '@tanstack/react-router'

import type { FieldDefinition } from '#/lib/field-definition'
import { SheetbaseTableGrid } from '#/components/sheet/sheetbase-grid'
import { SheetKeyboardShortcuts } from '#/components/shortcuts/sheet-keyboard-shortcuts'
import { CommentPanel } from '#/components/comments/comment-panel'
import type {
  SheetbaseCellState,
  SheetbaseGridCellChange,
  SheetbaseGridColumn,
  SheetbaseGridFilter,
  SheetbaseGridHandle,
  SheetbaseGridMenuEntry,
  SheetbaseGridRecordEditor,
  SheetbaseGridSelection,
  SheetbaseGridSort,
  SheetbaseGridWriteSource,
} from '#/components/sheet/sheetbase-grid'
import { SheetRecordPicker } from '#/components/sheet/sheet-record-picker'
import { PromoteRejected } from '#/components/sheet/promote-rejected'
import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
} from '#/components/v3/ui/confirm-dialog'
import { listInstanceColumnPromotions } from '#/lib/schema-evolution'
import { SheetPromote } from '#/components/sheet/sheet-promote'
import type { SheetPromoteLocalField } from '#/components/sheet/sheet-promote'
import { ComposedSheetRecordToolbar } from '#/components/sheet/composed-sheet-record-toolbar'
import { CanonicalSheetLifecyclePanel } from '#/components/sheet/canonical-sheet-lifecycle-panel'
import {
  CellConflictPanel,
  fetchCellConflicts,
} from '#/components/sheet/cell-conflict-panel'
import type { CellConflictRow } from '#/components/sheet/cell-conflict-panel'
import { ModelFieldInput } from '#/components/scientific/model-field-input'
import { Button } from '#/components/v3/ui/button'
import { Input } from '#/components/v3/ui/input'
import { explainSheetWriteBack } from '#/lib/assist-explain'
import { ExplainPanel } from '#/components/assist/explain-panel'
import { createDataClient, DataClientError } from '#/lib/data-client'
import {
  applySheetPresentation,
  canonicalSheetColumnHeader,
  canonicalSheetGridMatrix,
  categoryCellDisplayText,
  parseSheetCellInput,
  validateCanonicalCell,
} from '#/lib/canonical-sheet-grid'
import type { CanonicalSheetGridColumn } from '#/lib/canonical-sheet-grid'
import { fetchComposedSheetPaged } from '#/lib/sheet-composition-data'
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
import { workItemsQueryKeys } from '#/lib/work-items/data'
import { ExportMenu } from '#/components/export/export-menu'
import { ObjectHistoryDialog } from '#/components/audit'
import type {
  BoundColumnProvenance,
  BoundValueState,
} from '#/lib/sheet-bound-columns'
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
import { hasCapability } from '#/lib/capability'
import type { CurrentContext } from '#/lib/current-user'
import { commentsQueryKeys, fetchCommentsForSheet } from '#/lib/comments-data'
import {
  sheetCommentAnchorSchema,
  sheetCommentCells,
} from '#/lib/sheet-comment-anchor'
import type { SheetCommentAnchor } from '#/lib/sheet-comment-anchor'

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

/**
 * SHEET-02.3 — the local field a column can be promoted *from*, or null when
 * the column cannot be promoted. Only a column the Sheet itself owns can be
 * promoted: a bound column already lives in a Dataset, a calculated column is
 * derived rather than stored, and a retired local field is no longer offered.
 * The dialog needs no more than this slice of the field.
 */
export function promotableLocalField(
  instance: SheetInstance,
  column: CanonicalSheetGridColumn | undefined,
): SheetPromoteLocalField | null {
  if (!column || column.origin !== 'local' || !column.field) return null
  const field = instance.state.localFields.find(
    (item) => item.fieldId === column.id && item.lifecycle === 'active',
  )
  if (!field) return null
  return {
    fieldId: field.fieldId,
    key: field.key,
    label: field.label,
    logicalType: field.logicalType,
    quantity: field.quantity
      ? {
          storageUnit: field.quantity.storageUnit,
          preferredDisplayUnit: field.quantity.preferredDisplayUnit ?? null,
        }
      : null,
  }
}

/**
 * COMP-06 — the vendor-neutral column contract. The wrapper maps each neutral
 * type onto the engine (including the Record picker editor and display
 * renderers), so callers never build engine column settings.
 */
function sheetbaseColumn(
  column: CanonicalSheetGridColumn,
  canWrite: boolean,
  labels: () => Record<
    string,
    { identifier: string; title: string } | undefined
  >,
): SheetbaseGridColumn {
  const kind = column.presentation.kind
  const readOnly = !canWrite || !column.editable
  const base: Omit<SheetbaseGridColumn, 'type'> = {
    id: column.id,
    label: canonicalSheetColumnHeader(column),
    source: column.origin === 'calculation' ? 'calculated' : column.origin,
    readOnly,
    // EXP-04.2: the header's group row and `Source` badge name where the
    // column comes from (the source dataset, this Sheet, or derivation).
    group: column.group,
    sourceLabel: column.sourceLabel,
  }
  if (kind === 'checkbox') return { ...base, type: 'checkbox' }
  if (kind === 'number') return { ...base, type: 'number' }
  if (kind === 'date') return { ...base, type: 'date' }
  // GRID-03 review fix: the previous grid's `date` cell type could not hold or
  // produce a time and rejected canonical `…Z` instants on edit, which would
  // make timestamp columns uneditable. Timestamps keep the text editor;
  // parseSheetCellInput coerces bare input to a canonical UTC instant before
  // validation (bare input is interpreted as UTC because the grid carries no
  // timezone context).
  if (kind === 'datetime-local') return { ...base, type: 'datetime' }
  if (kind === 'record-picker' && canWrite) {
    // GRID-03: Record/reference cells edit through the shared search-select
    // Record picker. Selection writes the canonical Record UUID through the
    // normal change pipeline; the human label is display only.
    return {
      ...base,
      type: 'record',
      displayText: (value) => recordCellDisplayText(labels(), value),
    }
  }
  if (kind === 'category-select' && column.field) {
    // GRID-03: the dropdown is seeded from the field's canonical vocabulary
    // (active embedded options). Vocabulary-backed fields without a local
    // option list keep a text editor — the server still owns validation.
    const options = selectableFieldOptions(column.field, null).map(
      (option) => option.label,
    )
    if (options.length > 0) {
      return {
        ...base,
        type: 'select',
        options,
        displayText: (value) => categoryCellDisplayText(column.field, value),
      }
    }
  }
  return { ...base, type: 'text' }
}

/**
 * EXP-04.4 — the selected cell, resolved to what an inspector needs: the
 * canonical column (carrying its `FieldDefinition`), the value the grid is
 * showing and the bound value's provenance. The host receives this from the
 * `onCellSelectionChange` callback rather than reaching into the grid, so the
 * grid contract stays the grid's.
 */
export interface SheetCellSelection {
  column: CanonicalSheetGridColumn
  /** The cell's resolved value (local, calculated or composed). */
  value: unknown
  /** Bound provenance for the cell; null for local/calculated columns. */
  valueState: BoundValueState | null
  /** Sheet Instance name, for the host's context line. */
  sheetName: string
  /** 1-based row position, as the grid's row headers number it. */
  rowNumber: number
  /**
   * EXP-05.4: the row's stable identity. Cell conflicts are addressed by
   * `row_key` + field id, so a selection can be matched to an open conflict
   * without depending on display position.
   */
  rowKey: string
}

/**
 * EXP-05.2 — per-cell presentation state supplied by the host, keyed by the
 * canonical row identity and column id (never by display position). The
 * Notebook uses it to paint `unsynced` on cells with a local draft.
 */
export type SheetCellStateResolver = (cell: {
  instanceId: string
  rowId: string
  columnId: string
}) => SheetbaseCellState | undefined

export function CanonicalSheetWorkspace({
  instanceId,
  projectId,
  readOnly = false,
  commentId,
  cellState,
  onCellSelectionChange,
}: {
  instanceId: string
  projectId: string | null
  readOnly?: boolean
  commentId?: string
  /** EXP-05.2: per-cell state (e.g. `unsynced`) resolved by the host. */
  cellState?: SheetCellStateResolver
  /** EXP-04.4: notified when the selected cell changes. */
  onCellSelectionChange?: (selection: SheetCellSelection | null) => void
}) {
  const { auth } = useRouteContext({ from: '__root__' })
  const instanceQuery = useQuery({
    queryKey: ['sheet-instance', instanceId],
    queryFn: () => fetchSheetInstance(instanceId, sheetInstanceDataClient),
  })
  if (instanceQuery.isPending) {
    return (
      <p className="p-3 text-sm text-fg-muted" role="status">
        Loading Sheet…
      </p>
    )
  }
  if (instanceQuery.error || !instanceQuery.data) {
    return (
      <p className="p-3 text-sm text-danger-text" role="alert">
        This Sheet could not be loaded.
      </p>
    )
  }
  return (
    <CanonicalSheetEditor
      key={instanceQuery.data.id}
      instance={instanceQuery.data}
      projectId={projectId}
      readOnly={readOnly}
      commentActor={auth}
      commentId={commentId}
      cellState={cellState}
      onCellSelectionChange={onCellSelectionChange}
    />
  )
}

/**
 * ASSIST-01 entry point: explains a write-back rejection in plain language,
 * grounded in the sheet pre-commit validation with a citation per rule hit.
 * Read-only — no mutation path.
 */
function WriteBackExplain({
  failure,
}: {
  failure: {
    errors: Array<{ code: string; rowId?: string; fieldId?: string }>
    mixedAuthority: boolean
  }
}) {
  const [showExplain, setShowExplain] = useState(false)
  const explanation = explainSheetWriteBack(failure)
  if (!explanation) return null
  return (
    <span className="inline-flex flex-col gap-1">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        aria-expanded={showExplain}
        onClick={() => setShowExplain((value) => !value)}
      >
        {showExplain ? 'Hide explanation' : 'Explain'}
      </Button>
      {showExplain ? <ExplainPanel explanation={explanation} /> : null}
    </span>
  )
}

export function CanonicalSheetEditor({
  instance,
  projectId,
  readOnly = false,
  commentActor = null,
  commentId,
  cellState,
  onCellSelectionChange,
}: {
  instance: SheetInstance
  projectId: string | null
  readOnly?: boolean
  commentActor?: Pick<CurrentContext, 'user' | 'workspace'> | null
  commentId?: string
  /** EXP-05.2: per-cell state (e.g. `unsynced`) resolved by the host. */
  cellState?: SheetCellStateResolver
  /** EXP-04.4: published on every change of the selected cell. */
  onCellSelectionChange?: (selection: SheetCellSelection | null) => void
}) {
  const queryClient = useQueryClient()
  const instanceRef = useRef(instance)
  instanceRef.current = instance
  const composed = Boolean(instance.sourceDefinitionVersionId)
  const canWrite =
    Boolean(projectId) && !readOnly && instance.lifecycle === 'active'
  const gridContainerRef = useRef<HTMLDivElement | null>(null)
  const [gridHandle, setGridHandle] = useState<SheetbaseGridHandle | null>(null)
  const [activeInput, setActiveInput] = useState('')
  const [commentSelection, setCommentSelection] =
    useState<SheetbaseGridSelection | null>(null)
  const [commentDraft, setCommentDraft] = useState<{
    anchor: SheetCommentAnchor
    expectedRevision: number
  } | null>(null)
  const canComment =
    commentActor?.workspace?.id === instance.workspaceId &&
    hasCapability(commentActor.workspace.role, 'record.create') &&
    instance.lifecycle === 'active'
  const comments = useQuery({
    queryKey: commentsQueryKeys.forSheet(instance.id),
    queryFn: () => fetchCommentsForSheet(client, instance.id),
    enabled: Boolean(commentActor),
  })
  const openedCommentRequest = useRef({ key: '', applied: false })
  useEffect(() => {
    const request = `${instance.id}:${commentId ?? ''}`
    if (openedCommentRequest.current.key !== request)
      openedCommentRequest.current = { key: request, applied: false }
    if (!commentId || openedCommentRequest.current.applied) return
    const hit = comments.data?.find((comment) => comment.id === commentId)
    if (!hit) return
    const anchor = sheetCommentAnchorSchema.safeParse({
      targetKind: hit.target_kind,
      target: hit.target,
    })
    if (!anchor.success || anchor.data.target.instanceId !== instance.id) return
    setCommentDraft({
      anchor: anchor.data,
      expectedRevision: instance.revision,
    })
    openedCommentRequest.current.applied = true
  }, [commentId, comments.data, instance.id, instance.revision])
  const [columnLabel, setColumnLabel] = useState('')
  const [formula, setFormula] = useState('')
  const [formulaLabel, setFormulaLabel] = useState('Calculated')
  const [selected, setSelected] = useState<{ row: number; col: number }>({
    row: 0,
    col: 0,
  })
  // SHEET-02.3: the local column whose Promote dialog is open, or null. The
  // dialog is mounted only while a field is chosen, so its draft reason never
  // leaks from one column to the next.
  const [promoteField, setPromoteField] =
    useState<SheetPromoteLocalField | null>(null)
  // QA-156: a destructive menu action is held here until the shared
  // confirmation dialog is answered.
  const [pendingDestructive, setPendingDestructive] = useState<{
    title: string
    description: string
    confirmLabel: string
    run: () => void
  } | null>(null)
  // QA-153: a returned promotion the scientist has acknowledged with "Keep
  // local" stops being announced for this Sheet session (the promotion row
  // itself is unchanged — the app has no server path to withdraw it).
  const [keptLocalFields, setKeptLocalFields] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const [writeStatus, setWriteStatus] = useState<string | null>(null)
  // ASSIST-01: structured write-back rejection kept beside the status line
  // so the Explain affordance can cite rule codes, rows and fields.
  const [writeBackFailure, setWriteBackFailure] = useState<{
    errors: Array<{ code: string; rowId?: string; fieldId?: string }>
    mixedAuthority: boolean
  } | null>(null)
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
    /** Grid-side editor handle when the pick originated in a cell. */
    editor?: SheetbaseGridRecordEditor
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
    if (composedSnapshot) return composedSnapshot.rows.map((row) => row.rowKey)
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
  // QA-156: the grid's latest selection report, so a menu action confirmed
  // later still clears what the user selected.
  const selectionRef = useRef<SheetbaseGridSelection | null>(null)
  const compositionRef = useRef<ComposedSheetSnapshot | null>(composedSnapshot)
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
  // QA-153: a promotion request that is still pending (or already approved and
  // waiting to be applied) is otherwise invisible on the Sheet — only a
  // returned one was announced. The read is the same `column_promotions`
  // query the returned banner uses, so the two surfaces share one answer.
  const promotions = useQuery({
    queryKey: [
      'column-promotions',
      instance.id,
      selectedColumn?.origin === 'local' ? selectedColumn.id : '',
    ],
    queryFn: () => listInstanceColumnPromotions(client, instance.id),
    enabled: selectedColumn?.origin === 'local',
  })
  const openPromotion = promotions.data?.find(
    (promotion) =>
      promotion.field_id === selectedColumn?.id &&
      (promotion.state === 'pending' || promotion.state === 'approved'),
  )
  const provenance =
    composedSnapshot?.boundProjection?.rows.find(
      (row) => row.rowKey === selectedRowKey,
    )?.values[selectedColumn?.id ?? ''] ?? null

  // EXP-04.4: the grid's selection only names a row and column, so the value
  // and bound provenance are resolved here and published to the host. The host
  // (the Notebook inspector) describes the cell from these facts; it never
  // reads grid internals.
  //
  // `commentSelection` holds the grid's own selection report (it also addresses
  // Sheet comments) and is only ever set by that callback, whereas the editor's
  // default cursor is just where a fresh Sheet starts. So an untouched Sheet
  // publishes nothing — the inspector keeps describing the record — and a
  // deselect or unmount publishes null so stale facts never survive.
  const selectedCellValue = matrix.data[selected.row]?.[selected.col] ?? null
  useEffect(() => {
    if (!onCellSelectionChange) return
    onCellSelectionChange(
      commentSelection && selectedColumn
        ? {
            column: selectedColumn,
            value: selectedCellValue,
            valueState: provenance,
            sheetName: instance.name,
            rowNumber: selected.row + 1,
            rowKey: selectedRowKey ?? '',
          }
        : null,
    )
    return () => onCellSelectionChange(null)
  }, [
    onCellSelectionChange,
    commentSelection,
    selectedColumn,
    selectedCellValue,
    provenance,
    instance.name,
    selected.row,
    selectedRowKey,
  ])

  // EXP-05.4: this Sheet's open cell conflicts. A conflict is addressed by the
  // stable row identity and field id, so the selected cell can be matched to
  // one without depending on display position.
  const conflicts = useQuery({
    queryKey: ['sheet-cell-conflicts', instance.id, 'open'] as const,
    queryFn: () => fetchCellConflicts(client, instance.id, { state: 'open' }),
  })
  // A conflict settled in this session stays in the panel (which shows the
  // decision) but must no longer count as open or be offered again. The query
  // itself still lists it until the Sheet reloads, so track the decisions
  // here rather than dropping the panel the moment it settles.
  const [resolvedConflictIds, setResolvedConflictIds] = useState<
    ReadonlySet<string>
  >(() => new Set())
  const cachedConflicts = conflicts.data ?? []
  const openConflicts = cachedConflicts.filter(
    (conflict) => !resolvedConflictIds.has(conflict.id),
  )
  // The conflict the inspector shows: the one on the selected cell. Kept from
  // the cached rows (not the open filter) so a just-resolved conflict still
  // renders its decision instead of vanishing under the user.
  const selectedConflict: CellConflictRow | null =
    commentSelection && selectedColumn
      ? (cachedConflicts.find(
          (conflict) =>
            conflict.row_key === selectedRowKey &&
            conflict.field_id === selectedColumn.id,
        ) ?? null)
      : null

  // EXP-05.4: reaching a conflict means selecting its cell, which is what the
  // inspector renders against. Reveal through the grid's own handle so the
  // selection callback and reveal stay the grid's contract.
  function revealFirstConflict() {
    const first = openConflicts.at(0)
    if (!first) return
    const rowIndex = matrixRef.current.rowKeys.indexOf(first.row_key)
    const columnIndex = matrixRef.current.columns.findIndex(
      (column) => column.id === first.field_id,
    )
    if (rowIndex < 0 || columnIndex < 0) return
    gridHandle?.selectCell(rowIndex, columnIndex)
  }

  const localMutate = useMutation({
    mutationFn: (input: Parameters<typeof mutateSheetLocalState>[0]) =>
      mutateSheetLocalState(input, client),
    onSuccess: (next) => {
      queryClient.setQueryData(['sheet-instance', instance.id], next)
    },
  })

  /**
   * Both write paths send the revision they read from `instanceRef`, so a
   * sibling write landing first makes the server answer 'stale'. Re-read the
   * authoritative instance and adopt its revision before retrying.
   */
  async function refreshInstanceForRetry(): Promise<boolean> {
    const fresh = await queryClient.fetchQuery({
      queryKey: ['sheet-instance', instance.id],
      // The client default is a 30s staleTime, which would hand back the same
      // revision that just got rejected: the retry only means anything if it
      // reads the server's current revision.
      staleTime: 0,
      queryFn: () => fetchSheetInstance(instance.id, sheetInstanceDataClient),
    })
    if (!fresh) return false
    instanceRef.current = fresh
    return true
  }

  async function persistLocalCells(
    cells: Array<{ rowKey: string; fieldId: string; value: unknown }>,
    extra?: {
      fieldChanges?: LocalFieldChange[]
      rows?: Parameters<typeof mutateSheetLocalState>[0]['rows']
    },
    attempt = 0,
  ) {
    const current = instanceRef.current
    const rows = new Map((extra?.rows ?? []).map((row) => [row.rowKey, row]))
    for (const { rowKey } of cells) {
      if (rows.has(rowKey)) continue
      if (rowKey.startsWith('sb-row-v1:')) {
        const snapshot = compositionRef.current
        const row = snapshot?.rows.find(
          (candidate) => candidate.rowKey === rowKey,
        )
        if (!row || !snapshot)
          throw new Error(
            'The composed row is no longer available. Reload the Sheet before editing.',
          )
        rows.set(rowKey, {
          kind: 'composed',
          rowKey,
          identityValues: row.identityValues,
          compositionOffset: row.compositionOffset ?? snapshot.offset,
        })
      } else {
        rows.set(rowKey, { kind: 'local', rowKey })
      }
    }
    try {
      const next = await localMutate.mutateAsync({
        instanceId: current.id,
        expectedRevision: current.revision,
        retryToken: crypto.randomUUID(),
        fieldChanges: extra?.fieldChanges,
        rows: [...rows.values()],
        cells,
      })
      instanceRef.current = next
      return next
    } catch (error) {
      // GRID-04 review fix: a committed cell reads the same expected revision
      // a concurrent working-view write reads, so a stale rejection means a
      // sibling write landed first — not that the value is bad. Re-read the
      // instance and retry once so the typed value is not dropped.
      if (attempt === 0 && /stale/i.test(errorText(error) ?? '')) {
        if (await refreshInstanceForRetry()) {
          return persistLocalCells(cells, extra, attempt + 1)
        }
      }
      throw error
    }
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
      if (attempt === 0 && /stale/i.test(errorText(error) ?? '')) {
        if (await refreshInstanceForRetry()) {
          return persistPresentation(patch, attempt + 1)
        }
      }
      setWriteStatus(
        errorText(error) ||
          'The working view could not be saved to the Sheet state.',
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

  async function deleteLocalRowAt(rowIndex: number) {
    const rowKey = matrix.rowKeys[rowIndex]
    if (!rowKey || matrix.rowKinds[rowIndex] !== 'local') return
    const current = instanceRef.current
    const nextValues = { ...current.state.localValues }
    delete nextValues[rowKey]
    // QA-155: the grid removes the row as soon as the preflight allows it, so a
    // refused delete has to say so — otherwise the row silently reappears on
    // the next read with no explanation.
    try {
      const next = await updateSheetInstance(
        current.id,
        current.revision,
        { ...current.state, localValues: nextValues },
        sheetInstanceDataClient,
      )
      instanceRef.current = next
      queryClient.setQueryData(['sheet-instance', instance.id], next)
    } catch (error) {
      setWriteStatus(
        errorText(error) ??
          'The local row could not be deleted, so the Sheet still has it.',
      )
    }
  }

  async function deleteSelectedRow() {
    await deleteLocalRowAt(selected.row)
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
      // QA-157: the label is part of the request, so it is cleared with the
      // formula it names — the next calculation must not inherit the last
      // one's label.
      setFormula('')
      setFormulaLabel('')
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
      setWriteBackFailure(null)
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
        setWriteBackFailure({ errors: error.errors, mixedAuthority: false })
        return
      }
      if (error instanceof SheetMixedAuthorityWriteError) {
        // GRID-02: the range operation spanned more than one authoritative
        // target and was rejected before any write. Keep the pending values
        // so the scientist can split the edit; do not claim all-or-nothing
        // semantics that were never attempted.
        setWriteStatus(error.message)
        setWriteBackFailure({ errors: [], mixedAuthority: true })
        return
      }
      setWriteStatus(`Write-back ${sheetCellWriteError(error)}.`)
      setWriteBackFailure(null)
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
    // QA-154: the picker closes on pick, so a refused link would otherwise
    // look like it worked. The refusal is stated where the other write
    // reports are (and the cell keeps its previous value).
    onError: (error) =>
      setWriteStatus(
        errorText(error) ??
          'The Record could not be linked, so the cell kept its previous value.',
      ),
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
    // QA-154: the create form closes on submit, so a refused create-and-link
    // is reported here instead of looking like it succeeded.
    onError: (error) =>
      setWriteStatus(
        errorText(error) ??
          'The Record could not be created, so nothing was linked.',
      ),
  })

  const addRowRef = useRef(addRow)
  const addColumnRef = useRef(addColumn)
  const deleteRowRef = useRef(deleteSelectedRow)
  const deleteColumnRef = useRef(deleteSelectedColumn)
  const deleteLocalRowAtRef = useRef(deleteLocalRowAt)
  addRowRef.current = addRow
  addColumnRef.current = addColumn
  deleteRowRef.current = deleteSelectedRow
  deleteColumnRef.current = deleteSelectedColumn
  deleteLocalRowAtRef.current = deleteLocalRowAt

  // COMP-06.2: the engine's own row menu drives insert/delete. A bound Sheet
  // only owns local rows, so bound rows fail the delete preflight; the host
  // persists the change and the rebuilt rows flow back through `rows`.
  const handleBeforeRowsRemove = useCallback(
    (rowIndex: number) => {
      if (!canWrite) return false
      return matrixRef.current.rowKinds[rowIndex] === 'local'
        ? undefined
        : false
    },
    [canWrite],
  )
  const handleRowsRemoved = useCallback((rowIndex: number) => {
    void deleteLocalRowAtRef.current(rowIndex)
  }, [])
  const handleRowsInserted = useCallback(
    (_rowIndex: number, amount: number) => {
      for (let index = 0; index < amount; index += 1) void addRowRef.current()
    },
    [],
  )

  // COMP-06 step 1: the caller speaks Sheetbase terms only. Validation, write
  // attribution and presentation persistence stay here; the wrapper maps the
  // neutral callbacks onto the rendering engine.
  const sheetColumns = useMemo(
    () =>
      matrix.columns.map((column) =>
        sheetbaseColumn(column, canWrite, () => recordLabelsRef.current),
      ),
    [matrix, canWrite],
  )
  const sheetRows = useMemo(
    () =>
      matrix.rowKeys.map((rowKey, index) => ({
        id: rowKey,
        cells: matrix.data[index] ?? [],
      })),
    [matrix],
  )

  // GRID-02/GRID-03: every write source — bulk paste/fill/clear and single
  // typed edits alike — is coerced and validated against the typed column
  // contract before the grid applies anything. An invalid value rejects the
  // whole change, so the cell visibly keeps its previous value and the
  // canonical reason is announced: the visible grid can never diverge from
  // the authoritative state.
  const handleBeforeCellsChange = useCallback(
    (changes: SheetbaseGridCellChange[], source: SheetbaseGridWriteSource) => {
      if (changes.length === 0) return undefined
      const columnsById = new Map(
        matrixRef.current.columns.map((column) => [column.id, column]),
      )
      const verb =
        source === 'paste'
          ? 'Paste'
          : source === 'fill'
            ? 'Fill'
            : source === 'clear'
              ? 'Clear'
              : 'Edit'
      for (const change of changes) {
        const column = columnsById.get(change.columnId)
        // COMP-06.2 / sheetbase-table 0.4.0: a bulk operation's intended
        // target set marks cells the backend will not write (`editable:false`)
        // so one read-only or derived target refuses the whole operation
        // instead of letting the editable subset land.
        if (change.editable === false || (column && !column.editable)) {
          setWriteStatus(
            `${verb} rejected: the range contains read-only or derived cells.`,
          )
          return false
        }
        if (!column) continue
        const value = parseSheetCellInput(column.field, change.next)
        const invalid = validateCanonicalCell(column.field, value)
        if (invalid) {
          setWriteStatus(
            `${verb} rejected: ${invalid} in ${column.label}. The cell kept its previous value.`,
          )
          return false
        }
        // GRID-03: apply the coerced canonical value (category option id, UTC
        // instant, grouped-number) so the grid shows what will be written,
        // not the raw editor output.
        change.next = value
      }
      return undefined
    },
    [],
  )

  const handleCellsChange = useCallback(
    (
      changes: readonly SheetbaseGridCellChange[],
      source: SheetbaseGridWriteSource,
    ) => {
      if (source === 'load' || !canWrite) return
      const currentMatrix = matrixRef.current
      const snapshot = compositionRef.current
      const localCells: Array<{
        rowKey: string
        fieldId: string
        value: unknown
      }> = []
      const pending: Record<string, Record<string, unknown>> = {}
      const created = new Map<number, string>()
      const columnsById = new Map(
        currentMatrix.columns.map((column) => [column.id, column]),
      )
      for (const change of changes) {
        const column = columnsById.get(change.columnId)
        if (!column || !column.editable) continue
        let rowKey = change.rowId ?? created.get(change.rowIndex)
        if (!rowKey) {
          rowKey = crypto.randomUUID()
          created.set(change.rowIndex, rowKey)
        }
        const value = parseSheetCellInput(column.field, change.next)
        // GRID-03 safety net: beforeChange already rejected and reverted
        // invalid values for every write source, so this branch only fires if
        // a change reaches the change handler without passing through it.
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
    [canWrite],
  )

  // GRID-04: selection is stored in physical coordinates so delete, provenance
  // and status resolve the column/row the user actually selected, whatever the
  // current sort/filter/move state is.
  const handleSelectionChange = useCallback(
    (selection: SheetbaseGridSelection | null) => {
      setCommentSelection(selection)
      selectionRef.current = selection
      if (!selection) return
      setActiveInput(selection.input ?? '')
      const columnIndex = matrixRef.current.columns.findIndex(
        (column) => column.id === selection.columnId,
      )
      setSelected({
        row: selection.rowIndex,
        col: columnIndex >= 0 ? columnIndex : 0,
      })
    },
    [],
  )

  // GRID-04: persist resized column widths (presentation state only).
  const handleColumnResize = useCallback(
    (columnId: string, newSize: number) => {
      const current = instanceRef.current.state.presentation.columnWidths
      void persistPresentation({
        columnWidths: { ...current, [columnId]: clampColumnWidth(newSize) },
      })
    },
    // persistPresentation reads refs and the query client only.
    [],
  )

  // GRID-04: persist the new column order as stable column IDs. The wrapper
  // resets its own visual index map afterwards (`resetColumnOrderOnChange`),
  // so the rebuilt rows already carry the persisted order.
  const handleColumnOrderChange = useCallback((columnIds: string[]) => {
    void persistPresentation({ columnOrder: columnIds })
  }, [])

  // GRID-04: sorting and filtering are visual only; the wrapper owns the
  // engine conversion, the caller persists stable ids and skips identical
  // restores so a replayed view never re-writes state.
  const handleSortsChange = useCallback(
    (sorts: SheetbaseGridSort[]) => {
      if (
        JSON.stringify(sorts) ===
        JSON.stringify(instanceRef.current.state.presentation.sorts)
      )
        return
      void persistPresentation({ sorts })
    },
    // persistPresentation reads refs and the query client only.
    [],
  )
  const handleFiltersChange = useCallback((filters: SheetbaseGridFilter[]) => {
    if (
      JSON.stringify(filters) ===
      JSON.stringify(instanceRef.current.state.presentation.filters)
    )
      return
    void persistPresentation({ filters })
  }, [])

  // GRID-03: editing a record-picker cell opens the shared Record picker
  // scoped to the column's own relationship target.
  const handleOpenRecordPicker = useCallback(
    (
      cell: { rowIndex: number; columnIndex: number; columnId: string },
      editor: SheetbaseGridRecordEditor,
    ) => {
      const column = matrixRef.current.columns.at(cell.columnIndex)
      const targetModelKey = recordPickerTargetModelKey(column?.field ?? null)
      if (
        !column ||
        column.presentation.kind !== 'record-picker' ||
        !column.editable ||
        !targetModelKey
      ) {
        editor.cancel()
        return
      }
      setPicker({
        modelKey: targetModelKey,
        cell: { row: cell.rowIndex, col: cell.columnIndex },
        editor,
      })
    },
    [],
  )

  const handleNothingToClear = useCallback(() => {
    setWriteStatus(
      'Nothing to clear: the selection has no editable, non-empty cells.',
    )
  }, [])

  // QA-156: "Clear contents" is a destructive bulk write, so the menu asks
  // first. The clear is built from the grid's own selection report and flows
  // through the same change pipeline as every other write (editable check,
  // parse, validate, then the authoritative local or write-back target),
  // skipping cells that are already empty.
  function clearSelectedCells() {
    const current = matrixRef.current
    const selection = selectionRef.current
    const rowIds = selection?.rowIds?.length
      ? selection.rowIds
      : selection?.rowId
        ? [selection.rowId]
        : []
    const columnIds = selection?.columnIds?.length
      ? selection.columnIds
      : selection?.columnId
        ? [selection.columnId]
        : []
    const changes: SheetbaseGridCellChange[] = []
    for (const columnId of columnIds) {
      const columnIndex = current.columns.findIndex(
        (column) => column.id === columnId,
      )
      const column = current.columns.at(columnIndex)
      if (!column || !column.editable) continue
      for (const rowId of rowIds) {
        const rowIndex = current.rowKeys.indexOf(rowId)
        if (rowIndex < 0) continue
        const previous = current.data[rowIndex]?.[columnIndex] ?? null
        // The engine skips cells that are already empty; clearing one again
        // would write nothing.
        if (previous === null || previous === '') continue
        changes.push({ rowIndex, rowId, columnId, previous, next: '' })
      }
    }
    if (changes.length === 0) {
      handleNothingToClear()
      return
    }
    handleCellsChange(changes, 'clear')
  }

  const columnMenu = useMemo<SheetbaseGridMenuEntry[]>(
    () => [
      'separator',
      {
        id: 'freeze-to-column',
        label: 'Freeze up to this column',
        disabled: () => !canWrite,
        onSelect: (context) => {
          const anchor = context.ranges[0]?.columnIds[0]
          if (!anchor) return
          const index = matrixRef.current.columns.findIndex(
            (column) => column.id === anchor,
          )
          if (index < 0) return
          void persistPresentation({
            frozenColumnCount: Math.min(
              matrixRef.current.columns.length,
              index + 1,
            ),
          })
        },
      },
      {
        id: 'unfreeze-columns',
        label: 'Unfreeze columns',
        disabled: () => presentation.frozenColumnCount === 0,
        onSelect: () => {
          void persistPresentation({ frozenColumnCount: 0 })
        },
      },
      'separator',
      {
        id: 'hide-columns',
        label: 'Hide selected columns',
        disabled: () => !canWrite,
        onSelect: (context) => {
          const range = context.ranges.at(0)
          if (!range || range.columnIds.length === 0) return
          const hidden = new Set(
            instanceRef.current.state.presentation.hiddenColumnIds,
          )
          for (const columnId of range.columnIds) hidden.add(columnId)
          void persistPresentation({ hiddenColumnIds: [...hidden] })
        },
      },
      // SHEET-02.3: promotion is offered only for a column the Sheet owns.
      // The engine hides an entry whose `disabled` is true, and the menu is
      // opened for the column the grid has just selected, so the entry is
      // shown for an active local column and for no other kind. `onSelect`
      // still checks the column it is handed rather than trusting the gate.
      {
        id: 'promote-column',
        label: 'Promote column…',
        disabled: () =>
          !canWrite || promotableLocalField(instance, selectedColumn) === null,
        onSelect: (context) => {
          const anchor = context.ranges[0]?.columnIds[0]
          const column = matrixRef.current.columns.find(
            (item) => item.id === anchor,
          )
          const field = promotableLocalField(instanceRef.current, column)
          if (field) setPromoteField(field)
        },
      },
    ],
    [canWrite, instance, presentation.frozenColumnCount, selectedColumn],
  )

  const contextMenu = useMemo<SheetbaseGridMenuEntry[]>(
    () => [
      {
        id: 'insert-row',
        label: 'Insert row',
        disabled: () => !canWrite,
        onSelect: () => {
          void addRowRef.current()
        },
      },
      {
        id: 'insert-column',
        label: 'Insert column',
        disabled: () => !canWrite,
        onSelect: () => {
          void addColumnRef.current()
        },
      },
      {
        id: 'delete-row',
        label: 'Delete local row',
        disabled: () => !canWrite,
        // QA-156: deleting a local row is destructive and was immediate.
        onSelect: () =>
          setPendingDestructive({
            title: 'Delete this local row?',
            description:
              'The row and the values this Sheet holds in it are removed. This cannot be undone.',
            confirmLabel: 'Delete row',
            run: () => {
              void deleteRowRef.current()
            },
          }),
      },
      {
        id: 'delete-column',
        label: 'Retire local column',
        disabled: () => !canWrite,
        // QA-156: retiring a column changes what the Sheet can hold, so it is
        // confirmed like the row delete beside it.
        onSelect: () =>
          setPendingDestructive({
            title: 'Retire this local column?',
            description:
              'The Sheet stops offering the column for entry and stops reading its values. Values already stored in it stay with the Sheet, but the column cannot be brought back from here.',
            confirmLabel: 'Retire column',
            run: () => {
              void deleteColumnRef.current()
            },
          }),
      },
      'separator',
      'copy',
      'cut',
      'separator',
      {
        id: 'clear-contents',
        label: 'Clear contents',
        disabled: () => !canWrite,
        // QA-156: the previous entry was a bare string the grid wrapper drops,
        // so it never reached the menu; this one is a real, confirmed action.
        onSelect: () =>
          setPendingDestructive({
            title: 'Clear the selected cells?',
            description:
              'Every editable, non-empty cell in the selection is cleared. Cells bound to the Dataset are held for the next write-back.',
            confirmLabel: 'Clear cells',
            run: clearSelectedCells,
          }),
      },
    ],
    [canWrite],
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
  const visualiseDatasetId = composedSnapshot?.rows
    .flatMap((row) => row.sources)
    .find((source) => source.sourceKind === 'dataset')?.datasetId

  function openSelectionComment(kind?: SheetCommentAnchor['targetKind']) {
    if (!canComment || !commentSelection?.rowId) return
    const targetKind =
      kind ??
      ((commentSelection.rowIds?.length ?? 1) > 1 ||
      (commentSelection.columnIds?.length ?? 1) > 1
        ? 'sheet_range'
        : 'sheet_cell')
    const result = sheetCommentAnchorSchema.safeParse({
      targetKind,
      target: {
        instanceId: instance.id,
        rowKeys:
          targetKind === 'sheet_range'
            ? commentSelection.rowIds
            : [commentSelection.rowId],
        fieldIds:
          targetKind === 'sheet_row'
            ? []
            : targetKind === 'sheet_range'
              ? commentSelection.columnIds
              : [commentSelection.columnId],
      },
    })
    if (result.success)
      setCommentDraft({
        anchor: result.data,
        expectedRevision: instance.revision,
      })
  }
  const commentAnnotations = useMemo(() => {
    const notes = new Map<
      string,
      { rowId: string; columnId: string; text: string }
    >()
    for (const comment of comments.data ?? []) {
      if (comment.parent_id !== null) continue
      const anchor = sheetCommentAnchorSchema.safeParse({
        targetKind: comment.target_kind,
        target: comment.target,
      })
      if (!anchor.success) continue
      for (const cell of sheetCommentCells(
        anchor.data,
        instance.id,
        matrix.rowKeys.map((id) => ({ id })),
        matrix.columns,
      )) {
        const rowId = matrix.rowKeys[cell.row]
        const columnId = matrix.columns[cell.column].id
        const key = `${rowId}:${columnId}`
        const text = `${comment.state === 'resolved' ? 'Resolved' : 'Open'}: ${comment.body}`
        const previous = notes.get(key)
        notes.set(key, {
          rowId,
          columnId,
          text: previous ? `${previous.text}\n${text}` : text,
        })
      }
    }
    return [...notes.values()]
  }, [comments.data, instance.id, matrix.rowKeys, matrix.columns])

  return (
    <div className="flex h-full min-h-[24rem] min-w-0 flex-col">
      <div className="flex shrink-0 items-center justify-end gap-2 border-b px-2 py-1">
        {commentActor ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            data-sheet-comment-selection
            disabled={!canComment || !commentSelection?.rowId}
            onClick={() => openSelectionComment()}
          >
            Comment on selection
          </Button>
        ) : null}
        {visualiseDatasetId ? (
          <Button
            render={
              <Link
                to="/analysis/new"
                search={{ dataset: visualiseDatasetId }}
              />
            }
            nativeButton={false}
            size="sm"
            variant="secondary"
          >
            Visualise
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
            <span className="text-fg-muted">New column</span>
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
            variant="secondary"
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
            <span className="text-fg-muted">Formula</span>
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
            variant="secondary"
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
          <span className="text-fg-muted">Working view</span>
          <span className="flex items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant="secondary"
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
              variant="secondary"
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
              variant="secondary"
              onClick={() => void persistPresentation({ hiddenColumnIds: [] })}
            >
              Show {presentation.hiddenColumnIds.length} hidden column
              {presentation.hiddenColumnIds.length === 1 ? '' : 's'}
            </Button>
          ) : null}
          <span className="ml-auto flex items-center gap-2">
            <Button type="button" size="sm" variant="quiet" onClick={saveView}>
              Save view
            </Button>
            <Button
              type="button"
              size="sm"
              variant="quiet"
              disabled={!savedViewExists}
              onClick={restoreView}
            >
              Restore view
            </Button>
            <Button type="button" size="sm" variant="quiet" onClick={resetView}>
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
          className="flex flex-wrap items-center gap-2 border-b px-2 py-1 text-xs text-fg-muted"
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
              variant="secondary"
              disabled={composition.isFetching}
              onClick={() => setPageCount((count) => count + 1)}
            >
              {composition.isFetching ? 'Loading more…' : 'Load more'}
            </Button>
          ) : null}
        </div>
      ) : null}
      {matrix.columns.length === 0 ? (
        <p className="p-3 text-sm text-fg-muted" role="status">
          This Sheet has no columns yet. Add a column to start entering data.
        </p>
      ) : composition.isLoading ? (
        <p className="p-3 text-sm text-fg-muted" role="status">
          Loading composed Sheet…
        </p>
      ) : (
        <div ref={gridContainerRef} className="min-h-0 flex-1">
          <SheetKeyboardShortcuts
            handle={gridHandle}
            containerRef={gridContainerRef}
            readOnly={!canWrite}
            activeInput={activeInput}
            rowCount={sheetRows.length + (canWrite ? 1 : 0)}
            columnCount={sheetColumns.length}
          />
          <SheetbaseTableGrid
            ariaLabel="Sheet"
            columns={sheetColumns}
            rows={sheetRows}
            annotations={commentAnnotations}
            rowHeaders
            stretch="last"
            height="fill"
            spareRows={canWrite ? 1 : 0}
            // EXP-04.2: the "New run" draft row is offered only where a run
            // can actually start — a writable, active Sheet.
            appendRow={canWrite}
            columnWidth={(columnId) =>
              instanceRef.current.state.presentation.columnWidths[columnId]
            }
            reorderable
            resizable
            resetColumnOrderOnChange
            sorting
            sorts={presentation.sorts}
            filtering
            filters={presentation.filters}
            frozenColumns={presentation.frozenColumnCount}
            columnMenuItems={columnMenu}
            contextMenuItems={contextMenu}
            beforeCellsChange={handleBeforeCellsChange}
            onCellsChange={handleCellsChange}
            onSelectionChange={handleSelectionChange}
            onReady={setGridHandle}
            // EXP-05.2: the host's per-cell state, resolved to the grid's
            // display row index via the canonical row identity.
            cellState={
              cellState
                ? (rowIndex, columnId) =>
                    cellState({
                      instanceId: instance.id,
                      rowId: matrix.rowKeys[rowIndex] ?? '',
                      columnId,
                    })
                : undefined
            }
            onColumnResize={handleColumnResize}
            onColumnOrderChange={handleColumnOrderChange}
            onSortsChange={handleSortsChange}
            onFiltersChange={handleFiltersChange}
            onOpenRecordPicker={handleOpenRecordPicker}
            onNothingToClear={handleNothingToClear}
            onBeforeRowsRemove={handleBeforeRowsRemove}
            onRowsRemoved={handleRowsRemoved}
            onRowsInserted={handleRowsInserted}
          />
        </div>
      )}
      <div className="space-y-1 border-t px-3 py-2 text-xs text-fg-muted">
        {openConflicts.length > 0 ? (
          // EXP-05.4: a Sheet-wide count, with a way to reach the first one —
          // selecting its cell is what puts it in the inspector.
          <p className="flex flex-wrap items-center gap-2" role="status">
            <span>
              {openConflicts.length} open cell conflict
              {openConflicts.length === 1 ? '' : 's'}
            </span>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={revealFirstConflict}
            >
              Review first conflict
            </Button>
          </p>
        ) : null}
        {/* SHEET-02.3/QA-153: the promotion against the selected column is
        announced whenever it has something to say — a request still waiting on
        a reviewer, one already approved and waiting to be applied, or a
        returned one, which is the banner below. Anything acknowledged with
        "Keep local" stays silent for the rest of the session. */}
        {openPromotion && !keptLocalFields.has(openPromotion.field_id) ? (
          <p role="status">
            {openPromotion.state === 'pending'
              ? 'Promotion requested. A schema reviewer has to decide it; the column stays local until the promotion is applied.'
              : 'Promotion approved. The column becomes dataset-backed once the promotion is applied.'}
          </p>
        ) : null}
        {selectedColumn &&
        selectedColumn.origin === 'local' &&
        !keptLocalFields.has(selectedColumn.id) ? (
          <PromoteRejected
            instanceId={instance.id}
            fieldId={selectedColumn.id}
            client={client}
            onKeepLocal={() =>
              setKeptLocalFields((current) =>
                new Set(current).add(selectedColumn.id),
              )
            }
            onEditAndResubmit={
              canWrite
                ? () => {
                    const field = promotableLocalField(instance, selectedColumn)
                    if (field) setPromoteField(field)
                  }
                : undefined
            }
          />
        ) : null}
        <p>
          Sorting, filters, freezing, hidden columns and sizes are a
          display-only working view. They never change the Dataset, the Sheet's
          data or the filters used by analysis (Dataset Explorer and charts keep
          their own scientific query filters).
        </p>
        {staleCalc ? (
          <p role="status" className="flex flex-wrap items-center gap-2">
            Calculation results are stale. Recalculate after edits.
            {readOnly ? null : (
              <Button
                size="sm"
                disabled={calculations.isFetching}
                onClick={() => void calculations.refetch()}
              >
                {calculations.isFetching ? 'Recalculating…' : 'Recalculate'}
              </Button>
            )}
          </p>
        ) : null}
        {writeStatus ? <p role="status">{writeStatus}</p> : null}
        {writeBackFailure ? (
          <WriteBackExplain failure={writeBackFailure} />
        ) : null}
        {errorText(localMutate.error) || errorText(addCalculation.error) ? (
          <p className="text-danger-text" role="alert">
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
      {commentDraft && commentActor ? (
        <aside
          className="space-y-3 border-t p-3"
          aria-label="Sheet comments inspector"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">Sheet comments</span>
            <Button
              type="button"
              size="sm"
              variant="quiet"
              onClick={() => openSelectionComment('sheet_cell')}
            >
              Cell
            </Button>
            <Button
              type="button"
              size="sm"
              variant="quiet"
              onClick={() => openSelectionComment('sheet_row')}
            >
              Row
            </Button>
            <Button
              type="button"
              size="sm"
              variant="quiet"
              onClick={() => openSelectionComment('sheet_range')}
            >
              Range
            </Button>
            <Button
              type="button"
              size="sm"
              variant="quiet"
              onClick={() => setCommentDraft(null)}
            >
              Close comments
            </Button>
          </div>
          <p className="text-xs text-fg-muted">
            New comment target:{' '}
            {commentDraft.anchor.targetKind.replace('sheet_', '')} ·{' '}
            {commentDraft.anchor.target.rowKeys.length}{' '}
            {commentDraft.anchor.target.rowKeys.length === 1 ? 'row' : 'rows'}
            {commentDraft.anchor.targetKind === 'sheet_row'
              ? ''
              : ` · ${commentDraft.anchor.target.fieldIds.length} fields`}
            . Threads follow their original identities, including targets no
            longer displayed.
          </p>
          <CommentPanel
            sheet={commentDraft}
            focusCommentId={commentId}
            currentUserId={commentActor.user.id}
            currentUserName={commentActor.user.name}
            canComment={canComment}
            canCreate={
              commentDraft.anchor.target.rowKeys.every((id) =>
                matrix.rowKeys.includes(id),
              ) &&
              commentDraft.anchor.target.fieldIds.every((id) =>
                matrix.columns.some((column) => column.id === id),
              )
            }
            isTargetAvailable={(comment) => {
              const anchor = sheetCommentAnchorSchema.safeParse({
                targetKind: comment.target_kind,
                target: comment.target,
              })
              return (
                anchor.success &&
                anchor.data.target.instanceId === instance.id &&
                anchor.data.target.rowKeys.every((id) =>
                  matrix.rowKeys.includes(id),
                ) &&
                anchor.data.target.fieldIds.every((id) =>
                  matrix.columns.some((column) => column.id === id),
                )
              )
            }}
          />
        </aside>
      ) : null}
      {selectedConflict ? (
        // EXP-05.4: an open conflict on the selected cell is settled here —
        // the panel shows both attributable edits and records the decision.
        // Resolving refreshes the Sheet (held calculations) and the work-item
        // list (the `cell_conflict` item), so neither keeps describing a
        // conflict that is already decided.
        <CellConflictPanel
          conflict={selectedConflict}
          currentUserId={commentActor?.user.id ?? null}
          cellLabel={
            selectedColumn
              ? `row ${selected.row + 1}, ${selectedColumn.label}`
              : undefined
          }
          unit={selectedColumn?.field?.quantity?.storageUnit}
          client={client}
          onResolved={(resolved) => {
            setResolvedConflictIds((current) =>
              new Set(current).add(resolved.id),
            )
            void queryClient.invalidateQueries({
              queryKey: ['sheet-instance', instance.id],
            })
            void queryClient.invalidateQueries({
              queryKey: workItemsQueryKeys.list(),
            })
          }}
        />
      ) : null}
      {pendingDestructive ? (
        // QA-156: one confirmation surface for the destructive menu actions
        // (delete local row, retire local column, clear contents).
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setPendingDestructive(null)
          }}
        >
          <ConfirmDialogContent>
            <ConfirmDialogHeader>
              <ConfirmDialogTitle>
                {pendingDestructive.title}
              </ConfirmDialogTitle>
              <ConfirmDialogDescription>
                {pendingDestructive.description}
              </ConfirmDialogDescription>
            </ConfirmDialogHeader>
            <ConfirmDialogFooter>
              <ConfirmDialogCancel>Cancel</ConfirmDialogCancel>
              <ConfirmDialogAction
                variant="danger-fill"
                onClick={() => {
                  pendingDestructive.run()
                  setPendingDestructive(null)
                }}
              >
                {pendingDestructive.confirmLabel}
              </ConfirmDialogAction>
            </ConfirmDialogFooter>
          </ConfirmDialogContent>
        </ConfirmDialog>
      ) : null}
      {promoteField ? (
        // SHEET-02.3: the column menu opens this dialog, so it carries no
        // trigger of its own. Closing unmounts it, discarding the draft.
        <SheetPromote
          instanceId={instance.id}
          field={promoteField}
          client={client}
          expectedRevision={instance.revision}
          open
          trigger={false}
          onOpenChange={(next) => {
            if (!next) setPromoteField(null)
          }}
          onSubmitted={() => {
            // The promotion's state changed, so a banner for an earlier
            // return must not outlive this request.
            void queryClient.invalidateQueries({
              queryKey: ['column-promotions'],
            })
          }}
        />
      ) : null}
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
            error={search.error}
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
                // The backend owns the cell editor: commit through its own
                // pre-commit gate so the picked id is validated and written
                // like any other edit.
                picker.editor?.commit(result.id)
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
          <label>
            Name
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
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
            className="underline underline-offset-2 hover:text-fg"
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
            className="underline underline-offset-2 hover:text-fg"
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
