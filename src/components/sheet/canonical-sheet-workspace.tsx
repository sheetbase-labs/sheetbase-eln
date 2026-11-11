import { t } from '#/copy'
import { usePaneReadOnly } from '#/components/workspace/workspace-navigation'
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useRouteContext } from '@tanstack/react-router'

import { SheetFiltersButton } from './sheet-filters-popover'
import { SheetCompositionPanel } from './sheet-composition-panel'
import { useCellWriteMarks } from './sheet-write-marks'
import { gridStoredText } from './grid-client-values'
import { SheetbaseTableGrid } from '#/components/sheet/sheetbase-grid'
import { usePluginGridCellDisplays } from '#/components/extensions/table-hooks'
import { SheetKeyboardShortcuts } from '#/components/shortcuts/sheet-keyboard-shortcuts'
import { CommentPanel } from '#/components/comments/comment-panel'
import type {
  SheetbaseCellState,
  SheetbaseGridCellChange,
  SheetbaseGridCellValue,
  SheetbaseGridColumn,
  SheetbaseGridFilter,
  SheetbaseGridHandle,
  SheetbaseGridMenuEntry,
  SheetbaseGridRecordEditor,
  SheetbaseGridRow,
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
} from '#/components/ui/confirm-dialog'
import { listInstanceColumnPromotions } from '#/lib/schema-evolution'
import { SheetPasteData } from '#/components/sheet/sheet-paste-data'
import { SheetPromote } from '#/components/sheet/sheet-promote'
import type { SheetPromoteLocalField } from '#/components/sheet/sheet-promote'
import { BenchCalculatorDialog } from '#/components/calculators/bench-calculator-dialog'
import { ComposedSheetRecordToolbar } from '#/components/sheet/composed-sheet-record-toolbar'
import { CanonicalSheetLifecyclePanel } from '#/components/sheet/canonical-sheet-lifecycle-panel'
import { CellConflictPanel } from '#/components/sheet/cell-conflict-panel'
import { ModelFieldInput } from '#/components/scientific/model-field-input'
import { Button } from '#/components/ui/button'
import { Icon } from '#/components/icons'
import {
  SheetMoreMenu,
  SheetSaveStatus,
  SheetToolbarRule,
  SheetToolbarSwitch,
  usePhoneToolbar,
} from '#/components/sheet/sheet-toolbar-parts'
import { cn } from '#/lib/utils'
import { SheetBenchEntry } from '#/components/sheet/sheet-bench-entry'
import {
  benchInputText,
  benchRangeBreach,
  outOfRange,
} from '#/components/sheet/sheet-bench-fields'
import {
  cellDisplayText,
  useSheetChanges,
} from '#/components/sheet/sheet-changes'
import {
  SheetCellHistory,
  SheetChangeList,
} from '#/components/sheet/sheet-changes-panel'
import type { SheetChangeRow } from '#/components/sheet/sheet-changes-panel'
import { formatTime } from '#/lib/format-date'
import type {
  SheetMoreItem,
  SheetSaveState,
} from '#/components/sheet/sheet-toolbar-parts'
import { Input } from '#/components/ui/input'
import { Select } from '#/components/ui/select'
import { explainSheetWriteBack } from '#/lib/assist-explain'
import { AiExplainPanel } from '#/components/assist/ai-explain-panel'
import { createDataClient } from '#/lib/data-client'
import {
  applySheetPresentation,
  canonicalSheetGridMatrix,
  parseSheetCellInput,
  validateCanonicalCell,
} from '#/lib/canonical-sheet-grid'
import type {
  CanonicalSheetGridColumn,
  CanonicalSheetGridMatrix,
} from '#/lib/canonical-sheet-grid'
import type { ComposedSheetSnapshot } from '#/lib/sheet-composition-data'
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
import { downloadExport } from '#/components/export/download-export'
import { ObjectHistoryDialog } from '#/components/audit'
import type {
  BoundColumnProvenance,
  BoundValueState,
} from '#/lib/sheet-bound-columns'
import type { SheetInstance } from '#/lib/sheet-instance-data'
import type { PastedTable } from '#/lib/sheet-paste'
import {
  createAdHocTextField,
  mutateSheetInstanceCalculations,
  mutateSheetLocalState,
} from '#/lib/sheet-local-data'
import type { LocalFieldChange } from '#/lib/sheet-local-data'
import { resolveSheetRecordActions } from '#/lib/sheet-record-actions'
import {
  commitSheetRecordBatch,
  composedSheetRecordLinkBatchRows,
  createAndLinkSheetRecord,
  enrichSheetRecordWriteTarget,
} from '#/lib/sheet-record-commit'
import { buildSheetCalculationExpression } from '#/lib/sheet-calculation'
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
  SheetBatchValidationError,
  SheetMixedAuthorityWriteError,
  sheetCellWriteError,
  writeSheetCells,
} from '#/lib/sheet-write-back'
import { sheetRecordTargetModelKey } from '#/lib/sheet-record-target'
import type { CurrentContext } from '#/lib/current-user'
import { useOfflineEdits } from '#/components/offline/offline-edits'
import { overlayOfflineSheetEdits } from '#/lib/offline/sheet-overlay'
import { requestBackgroundSync } from '#/lib/offline/service-worker'
import type { OfflineJsonValue } from '#/lib/offline/store'
import { pipelineJsonValueSchema } from '#/lib/pipelines/types'
import {
  sheetCommentAnchorSchema,
  sheetCommentCells,
} from '#/lib/sheet-comment-anchor'
import type { SheetCommentAnchor } from '#/lib/sheet-comment-anchor'
import {
  promotableLocalField,
  recordPickerTargetModelKey,
  canonicalWorkspaceGridColumn,
} from './canonical-workspace-fields'
import { useCanonicalWorkspaceCalculations } from './canonical-workspace-calculations'
import { useCanonicalWorkspaceConflicts } from './canonical-workspace-conflicts'
import { useCanonicalWorkspaceComposition } from './canonical-workspace-composition'
import { useCanonicalWorkspaceComments } from './canonical-workspace-comments'
import { prepareCanonicalWorkspaceWrite } from './canonical-workspace-write-policy'

const client = createDataClient()

/** GRID-04: keep persisted column widths inside the canonical 40–2000 range. */
function clampColumnWidth(width: number): number {
  return Math.min(2_000, Math.max(40, Math.round(width)))
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
  openPasteOnLoad = false,
  cellState,
  onCellSelectionChange,
  heading,
  headingAside,
}: {
  instanceId: string
  projectId: string | null
  readOnly?: boolean
  /** The sheet's name, at the start of its toolbar (notebook). */
  heading?: ReactNode
  /** Badges and links after the name and its row count. */
  headingAside?: ReactNode
  commentId?: string
  /** Opens the Paste data dialog once, for a sheet created to hold a paste. */
  openPasteOnLoad?: boolean
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
        {t('notebook.canonicalSheetWorkspace.loadingSheet')}
      </p>
    )
  }

  if (instanceQuery.error || !instanceQuery.data) {
    return (
      <p className="p-3 text-sm text-danger-text" role="alert">
        {t('notebook.canonicalSheetWorkspace.thisSheetCouldNot')}
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
      openPasteOnLoad={openPasteOnLoad}
      cellState={cellState}
      onCellSelectionChange={onCellSelectionChange}
      heading={heading}
      headingAside={headingAside}
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
        {showExplain
          ? t('notebook.canonicalSheetWorkspace.hideExplanation')
          : t('notebook.canonicalSheetWorkspace.explain')}
      </Button>
      {showExplain ? <AiExplainPanel explanation={explanation} /> : null}
    </span>
  )
}

function useCanonicalWorkspaceSession({
  instance,
  projectId,
  readOnly = false,
  commentActor = null,
  commentId,
  openPasteOnLoad = false,
  cellState,
  onCellSelectionChange,
  heading,
  headingAside,
}: {
  instance: SheetInstance
  /** The sheet's name, at the start of its toolbar. */
  heading?: ReactNode
  /** Badges and links after the name and its row count. */
  headingAside?: ReactNode
  projectId: string | null
  readOnly?: boolean
  commentActor?: Pick<CurrentContext, 'user' | 'workspace'> | null
  commentId?: string
  openPasteOnLoad?: boolean
  /** EXP-05.2: per-cell state (e.g. `unsynced`) resolved by the host. */
  cellState?: SheetCellStateResolver
  /** EXP-04.4: published on every change of the selected cell. */
  onCellSelectionChange?: (selection: SheetCellSelection | null) => void
}) {
  const queryClient = useQueryClient()
  const instanceRef = useRef(instance)
  // Stable grid callbacks read only committed props, never an abandoned
  // concurrent render. Successful writes still advance this ref immediately.
  useLayoutEffect(() => {
    instanceRef.current = instance
  }, [instance])
  const composed = Boolean(instance.sourceDefinitionVersionId)
  // Only the primary pane of a workspace edits; the others read.
  const paneReadOnly = usePaneReadOnly()

  const canWrite =
    Boolean(projectId) &&
    !readOnly &&
    !paneReadOnly &&
    instance.lifecycle === 'active'

  const gridContainerRef = useRef<HTMLDivElement | null>(null)
  const [gridHandle, setGridHandle] = useState<SheetbaseGridHandle | null>(null)
  const [activeInput, setActiveInput] = useState('')

  const [commentSelection, setCommentSelection] =
    useState<SheetbaseGridSelection | null>(null)

  const { commentDraft, setCommentDraft, canComment, comments } =
    useCanonicalWorkspaceComments({
      instance,
      actor: commentActor,
      commentId,
      client,
    })

  const [columnLabel, setColumnLabel] = useState('')
  const [columnType, setColumnType] = useState<'text' | 'decimal'>('text')
  const [calculatorOpen, setCalculatorOpen] = useState(false)

  const [pasteOpen, setPasteOpen] = useState(
    openPasteOnLoad && canWrite && instance.state.localFields.length === 0,
  )

  const [pasting, setPasting] = useState(false)

  // Which authoring panel is open under the toolbar; the table comes first.
  const [sheetTool, setSheetTool] = useState<
    'column' | 'calculation' | 'view' | null
  >(null)

  // The Details view shows how the sheet is wired: owner bands, source
  // badges, where an edit is saved, and the sheet's sources and upgrades. The
  // everyday view keeps all of that out of the way. Remembered per device.
  const [details, setDetailsState] = useState(() =>
    readSheetPreference(SHEET_DETAILS_KEY),
  )

  const setDetails = useCallback((next: boolean) => {
    setDetailsState(next)
    writeSheetPreference(SHEET_DETAILS_KEY, next)
  }, [])

  const [historyOpen, setHistoryOpen] = useState(false)

  // Bench entry: one run at a time, as large fields above the grid.
  // Remembered per device, like Details.
  const [benchEntry, setBenchEntryState] = useState(() =>
    readSheetPreference(SHEET_BENCH_KEY),
  )

  const setBenchEntry = useCallback((next: boolean) => {
    setBenchEntryState(next)
    writeSheetPreference(SHEET_BENCH_KEY, next)
  }, [])

  const [benchRow, setBenchRow] = useState<number | null>(null)

  const [formula, setFormula] = useState('')
  const [formulaLabel, setFormulaLabel] = useState('Calculated')
  const [formulaQuantityColumn, setFormulaQuantityColumn] = useState('')

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
    Record<string, Record<string, SheetbaseGridCellValue>>
  >({})

  const [errors, setErrors] = useState(() =>
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

  const composition = useCanonicalWorkspaceComposition({
    instanceId: instance.id,
    pageCount,
    enabled: composed,
    client,
  })

  const composedSnapshot = composition.data?.snapshot ?? null

  const calculations = useCanonicalWorkspaceCalculations({
    instance,
    composedSnapshot,
    canWrite,
    client,
  })

  // Edits made offline wait on the device; show them where they will land.
  const offlineEdits = useOfflineEdits()
  const offlineEditsRef = useRef(offlineEdits)
  useLayoutEffect(() => {
    offlineEditsRef.current = offlineEdits
  }, [offlineEdits])

  const canonicalMatrix = useMemo(
    () =>
      overlayOfflineSheetEdits(
        canonicalSheetGridMatrix({
          instance,
          composition: composedSnapshot,
          calculationResults: calculations.data?.mapped,
        }),
        instance.id,
        offlineEdits.edits,
      ),
    [instance, composedSnapshot, calculations.data, offlineEdits.edits],
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
  useLayoutEffect(() => {
    matrixRef.current = matrix
  }, [matrix])
  // QA-156: the grid's latest selection report, so a menu action confirmed
  // later still clears what the user selected.
  const selectionRef = useRef<SheetbaseGridSelection | null>(null)
  const compositionRef = useRef<ComposedSheetSnapshot | null>(composedSnapshot)
  useLayoutEffect(() => {
    compositionRef.current = composedSnapshot
  }, [composedSnapshot])

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
    // Synchronize the notebook inspector after committed async values/provenance.
    // useNotebookCellFacts keeps these as inspector-only facts; its stable callback
    // does not feed selection or matrix inputs back into this workspace.
    // react-doctor-disable-next-line react-doctor/no-pass-live-state-to-parent
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

  const { openConflicts, selectedConflict, setResolvedConflictIds } =
    useCanonicalWorkspaceConflicts({
      instanceId: instance.id,
      hasSelection: Boolean(commentSelection),
      selectedRowKey,
      selectedColumnId: selectedColumn?.id,
      client,
    })

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

  const mutateLocalAsync = localMutate.mutateAsync

  /**
   * Both write paths send the revision they read from `instanceRef`, so a
   * sibling write landing first makes the server answer 'stale'. Re-read the
   * authoritative instance and adopt its revision before retrying.
   */
  const refreshInstanceForRetry = useCallback(async (): Promise<boolean> => {
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
  }, [instance.id, queryClient])

  /**
   * Without a connection, keep the typed cells (and any row they start) on the
   * device to send later, instead of failing the write. Returns true when they
   * were kept. Changes to the columns themselves need the server.
   */
  const keepCellsOnDevice = useCallback(
    async (
      cells: Array<{
        rowKey: string
        fieldId: string
        value: SheetbaseGridCellValue
      }>,
      extra?: { fieldChanges?: LocalFieldChange[] },
    ): Promise<boolean> => {
      const offline = offlineEditsRef.current

      if (!offline.canQueue || typeof navigator === 'undefined') return false

      if (navigator.onLine) return false

      if (extra?.fieldChanges?.length) {
        throw new Error(t('notebook.offlineEdits.needsConnection'))
      }

      const sheet = {
        instanceId: instanceRef.current.id,
        revision: instanceRef.current.revision,
      }

      const known = new Set(matrixRef.current.rowKeys)
      const fresh = new Map<string, Record<string, OfflineJsonValue>>()

      const existing: Array<{
        rowId: string
        columnId: string
        value: OfflineJsonValue
      }> = []

      for (const cell of cells) {
        const value = pipelineJsonValueSchema.parse(cell.value)

        if (known.has(cell.rowKey)) {
          existing.push({ rowId: cell.rowKey, columnId: cell.fieldId, value })
        } else {
          const values = fresh.get(cell.rowKey) ?? {}
          values[cell.fieldId] = value
          fresh.set(cell.rowKey, values)
        }
      }

      for (const [rowKey, values] of fresh) {
        // putEdit reads/assigns/replaces the shared scope array. Parallel rows
        // overwrite each other; canonical-workspace-offline.test.ts proves it.
        // react-doctor-disable-next-line react-doctor/async-await-in-loop
        await offline.queueSheetRow(sheet, { rowKey, values })
      }

      if (existing.length > 0) await offline.queueSheetCells(sheet, existing)
      void requestBackgroundSync()

      return true
    },
    [],
  )

  const persistLocalCells = useCallback(
    async (
      cells: Array<{
        rowKey: string
        fieldId: string
        value: SheetbaseGridCellValue
      }>,
      extra?: {
        fieldChanges?: LocalFieldChange[]
        rows?: Parameters<typeof mutateSheetLocalState>[0]['rows']
      },
      attempt = 0,
    ): Promise<SheetInstance> => {
      const current = instanceRef.current

      if (await keepCellsOnDevice(cells, extra)) return current
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
              t('notebook.canonicalSheetWorkspace.theComposedRowIs'),
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
        const next = await mutateLocalAsync({
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
        // The request never reached the server (the connection dropped between
        // the last event and this write): keep the cells instead of losing them.
        if (
          error instanceof TypeError &&
          offlineEditsRef.current.canQueue &&
          !extra?.fieldChanges?.length
        ) {
          const sheet = {
            instanceId: current.id,
            revision: current.revision,
          }

          const known = new Set(matrixRef.current.rowKeys)
          const existing = cells.filter((cell) => known.has(cell.rowKey))

          for (const cell of cells.filter((item) => !known.has(item.rowKey))) {
            // The same scope read/assign/replace must finish before the next row.
            // canonical-workspace-offline.test.ts reproduces the parallel loss.
            // react-doctor-disable-next-line react-doctor/async-await-in-loop
            await offlineEditsRef.current.queueSheetRow(sheet, {
              rowKey: cell.rowKey,
              values: {
                [cell.fieldId]: pipelineJsonValueSchema.parse(cell.value),
              },
            })
          }

          if (existing.length > 0) {
            await offlineEditsRef.current.queueSheetCells(
              sheet,
              existing.map((cell) => ({
                rowId: cell.rowKey,
                columnId: cell.fieldId,
                value: pipelineJsonValueSchema.parse(cell.value),
              })),
            )
          }

          void requestBackgroundSync()

          return current
        }

        // GRID-04 review fix: a committed cell reads the same expected revision
        // a concurrent working-view write reads, so a stale rejection means a
        // sibling write landed first — not that the value is bad. Re-read the
        // instance and retry once so the typed value is not dropped.
        if (
          attempt === 0 &&
          error instanceof Error &&
          /stale/i.test(error.message)
        ) {
          if (await refreshInstanceForRetry()) {
            return persistLocalCells(cells, extra, attempt + 1)
          }
        }

        throw error
      }
    },
    [keepCellsOnDevice, mutateLocalAsync, refreshInstanceForRetry],
  )

  // GRID-04: presentation writes go through the existing sheet-instance state
  // mutation path (`update_sheet_instance` with an expected revision), which
  // is the same optimistic-revision contract the rest of the editor uses. The
  // server rejects any change to localFields/localValues here, so a
  // presentation write can never smuggle scientific data changes through.
  const persistPresentation = useCallback(
    async (
      patch: Partial<SheetPresentation>,
      attempt = 0,
    ): Promise<boolean> => {
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
        if (
          attempt === 0 &&
          error instanceof Error &&
          /stale/i.test(error.message)
        ) {
          if (await refreshInstanceForRetry()) {
            return persistPresentation(patch, attempt + 1)
          }
        }

        setWriteStatus(
          (error instanceof Error && error.message) ||
            t('notebook.canonicalSheetWorkspace.theWorkingViewCould'),
        )

        return false
      }
    },
    [instance.id, queryClient, refreshInstanceForRetry],
  )

  async function addColumn() {
    const activeFields = instance.state.localFields.filter(
      (field) => field.lifecycle === 'active',
    )

    const field = {
      ...createAdHocTextField(
        columnLabel,
        activeFields.map((item) => item.key),
      ),
      logicalType: columnType,
    }

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

  /**
   * Bring a pasted table in as local text columns and rows, in groups the
   * server accepts, so a paste is one visible step however long it is.
   */
  async function pasteTable(table: PastedTable) {
    setPasting(true)

    try {
      const keys = instanceRef.current.state.localFields
        .filter((field) => field.lifecycle === 'active')
        .map((field) => field.key)

      const pastedFields = table.headers.map((label) => {
        const field = createAdHocTextField(label, keys)
        keys.push(field.key)

        return field
      })

      const perGroup = Math.max(
        1,
        Math.min(200, Math.floor(1_000 / pastedFields.length)),
      )

      for (let start = 0; start < table.rows.length; start += perGroup) {
        const group = table.rows.slice(start, start + perGroup)

        const rows = group.map(() => ({
          kind: 'local' as const,
          rowKey: crypto.randomUUID(),
        }))

        const cells = group.flatMap((values, rowIndex) =>
          values.map((value, column) => ({
            rowKey: rows[rowIndex].rowKey,
            fieldId: pastedFields[column].fieldId,
            value: value === '' ? null : value,
          })),
        )

        // Each batch consumes/advances instanceRef's authoritative revision;
        // the first also creates the fields required by subsequent batches.
        // react-doctor-disable-next-line react-doctor/async-await-in-loop
        await persistLocalCells(cells, {
          fieldChanges:
            start === 0
              ? pastedFields.map((field) => ({
                  operation: 'add' as const,
                  field,
                }))
              : undefined,
          rows,
        })
      }

      setPasteOpen(false)
      setWriteStatus(
        t('notebook.canonicalSheetWorkspace.pasted', {
          rows: t('common.counts.rows', { count: table.rows.length }),
          columns: t('notebook.canonicalSheetWorkspace.newLocalColumns', {
            count: pastedFields.length,
          }),
        }),
      )
    } catch (error) {
      setWriteStatus(
        (error instanceof Error ? error.message : null) ??
          t('notebook.canonicalSheetWorkspace.thePastedDataCould'),
      )
    } finally {
      setPasting(false)
    }
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
        (error instanceof Error ? error.message : null) ??
          t('notebook.canonicalSheetWorkspace.theLocalRowCould'),
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
    setWriteStatus(t('notebook.canonicalSheetWorkspace.workingViewSavedOn'))
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
      setWriteStatus(t('notebook.canonicalSheetWorkspace.noUsableSavedView'))

      return
    }

    void persistPresentation(restored).then((saved) => {
      if (!saved) return
      setWriteStatus(t('notebook.canonicalSheetWorkspace.workingViewRestored'))
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
      setWriteStatus(t('notebook.canonicalSheetWorkspace.workingViewResetTo'))
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

      const quantityColumn = matrix.columns.find(
        (column) => column.id === formulaQuantityColumn,
      )

      if (formulaQuantityColumn && !quantityColumn?.field?.quantity) {
        throw new Error(
          t('notebook.canonicalSheetWorkspace.chooseAnAvailableCalculation'),
        )
      }

      const expression = buildSheetCalculationExpression({
        source: formula,
        columns: matrix.columns,
      })

      const outputField = {
        fieldId: id,
        key,
        label:
          formulaLabel.trim() || t('notebook.canonicalSheetWorkspace.label'),
        description: null,
        logicalType: 'decimal' as const,
        nullable: true,
        defaultValue: null,
        cardinality: 'one' as const,
        quantity: quantityColumn?.field?.quantity ?? null,
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
                dependencies: expression.dependencies,
                expression: {
                  language: 'sheetbase-formula-v1',
                  source: expression.source,
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
      setFormulaQuantityColumn('')
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

      if (
        offlineEditsRef.current.canQueue &&
        typeof navigator !== 'undefined' &&
        !navigator.onLine
      ) {
        await offlineEditsRef.current.queueSheetCells(
          {
            instanceId: instanceRef.current.id,
            revision: instanceRef.current.revision,
          },
          cells.map((cell) => ({
            rowId: cell.rowKey,
            columnId: cell.columnId,
            value: pipelineJsonValueSchema.parse(cell.value),
          })),
        )
        void requestBackgroundSync()

        return
      }

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
      setWriteStatus(t('notebook.canonicalSheetWorkspace.writeBackSaved'))
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
          t('notebook.canonicalSheetWorkspace.writeBackRejected', {
            code: error.errors[0]?.code ?? 'validation_failed',
          }),
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

      setWriteStatus(
        t('notebook.canonicalSheetWorkspace.writeBackSheetcellwriteerror', {
          sheetCellWriteError: sheetCellWriteError(error),
        }),
      )
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
        (error instanceof Error ? error.message : null) ??
          t('notebook.canonicalSheetWorkspace.theRecordCouldNot'),
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
        (error instanceof Error ? error.message : null) ??
          t('notebook.canonicalSheetWorkspace.theRecordCouldNot2'),
      ),
  })

  const addRowRef = useRef(addRow)
  const addColumnRef = useRef(addColumn)
  const deleteRowRef = useRef(deleteSelectedRow)
  const deleteColumnRef = useRef(deleteSelectedColumn)
  const deleteLocalRowAtRef = useRef(deleteLocalRowAt)
  useLayoutEffect(() => {
    addRowRef.current = addRow
    addColumnRef.current = addColumn
    deleteRowRef.current = deleteSelectedRow
    deleteColumnRef.current = deleteSelectedColumn
    deleteLocalRowAtRef.current = deleteLocalRowAt
  })

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
        canonicalWorkspaceGridColumn(
          column,
          canWrite,
          () => recordLabelsRef.current,
          details,
        ),
      ),
    [matrix, canWrite, details],
  )

  const columnKeys = useMemo(
    () =>
      matrix.columns.flatMap((column) =>
        column.field
          ? [
              {
                id: column.id,
                key: column.field.key,
                logicalType: column.field.logicalType,
              },
            ]
          : [],
      ),
    [matrix],
  )

  const cellDisplays = usePluginGridCellDisplays(columnKeys)

  const sheetRows = useMemo(
    () =>
      matrix.rowKeys.map((rowKey, index) => ({
        id: rowKey,
        cells: matrix.data[index] ?? [],
      })),
    [matrix],
  )

  // Save state per change, shown with Show changes.
  const writeMarks = useCellWriteMarks()
  const trackWrite = writeMarks.track

  // Show changes: off by default, for anyone, in any state.
  const sheetChanges = useSheetChanges({
    instanceId: instance.id,
    revision: instance.revision,
    matrix,
    boundRows: composedSnapshot?.boundProjection?.rows,
    gridColumns: sheetColumns,
    selected: commentSelection ? selected : null,
  })

  const { showChanges, cellBefore: recordedBefore } = sheetChanges
  const { writeFor } = writeMarks

  // A change still saving, or that failed, shows its old value struck
  // through like a recorded one.
  const cellBefore = useMemo(() => {
    if (!showChanges) return undefined

    return (rowIndex: number, columnId: string) => {
      const write = writeFor(matrix.rowKeys[rowIndex], columnId)

      if (write)
        return write.before === write.after ? undefined : write.before || '—'

      return recordedBefore?.(rowIndex, columnId)
    }
  }, [showChanges, recordedBefore, writeFor, matrix])

  // Show changes: every changed cell carries its own save mark. A cell
  // changed today is saved; one still writing, or that failed, says so.
  const cellMark = useMemo(() => {
    if (!showChanges) return undefined

    return (rowIndex: number, columnId: string) => {
      const write = writeFor(matrix.rowKeys[rowIndex], columnId)

      if (write) return { state: write.state, retry: write.retry }

      return cellBefore?.(rowIndex, columnId) === undefined
        ? undefined
        : { state: 'saved' as const }
    }
  }, [showChanges, cellBefore, writeFor, matrix])

  // GRID-02/GRID-03: every write source — bulk paste/fill/clear and single
  // typed edits alike — is coerced and validated against the typed column
  // contract before the grid applies anything. An invalid value rejects the
  // whole change, so the cell visibly keeps its previous value and the
  // canonical reason is announced: the visible grid can never diverge from
  // the authoritative state.
  const handleBeforeCellsChange = useCallback(
    (changes: SheetbaseGridCellChange[], source: SheetbaseGridWriteSource) => {
      const decision = prepareCanonicalWorkspaceWrite({
        columns: matrixRef.current.columns,
        changes,
        source,
      })

      if (decision.status !== null) setWriteStatus(decision.status)

      return decision.result
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
        value: SheetbaseGridCellValue
      }> = []

      const tracked: Array<{
        rowKey: string
        columnId: string
        before: string
        after: string
      }> = []

      const pending: Record<string, Record<string, SheetbaseGridCellValue>> = {}
      const created = new Map<number, string>()

      const columnsById = new Map(
        currentMatrix.columns.map((column) => [column.id, column]),
      )

      const gridColumnsById = new Map(
        sheetColumns.map((column) => [column.id, column]),
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
          setWriteStatus(
            t('notebook.canonicalSheetWorkspace.invalidValueInvalidIn', {
              invalid,
              label: column.label,
            }),
          )
          continue
        }

        if (column.origin === 'bound' && snapshot) {
          pending[rowKey] = { ...pending[rowKey], [column.id]: value }
        } else {
          localCells.push({ rowKey, fieldId: column.id, value })
          tracked.push({
            rowKey,
            columnId: column.id,
            before: cellDisplayText(
              change.previous,
              gridColumnsById.get(column.id),
            ),
            after: cellDisplayText(change.next, gridColumnsById.get(column.id)),
          })
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

        void trackWrite(tracked, () =>
          persistLocalCells(localCells, {
            rows: newRows.length > 0 ? newRows : undefined,
          }),
        ).catch((error) => {
          setWriteStatus(
            (error instanceof Error ? error.message : null) ??
              t(
                'notebook.canonicalSheetWorkspace.localWriteSheetcellwriteerror',
                { sheetCellWriteError: sheetCellWriteError(error) },
              ),
          )
        })
      }
    },
    [canWrite, persistLocalCells, trackWrite, sheetColumns],
  )

  const selectionKeyRef = useRef<string | null>(null)

  // GRID-04: selection is stored in physical coordinates so delete, provenance
  // and status resolve the column/row the user actually selected, whatever the
  // current sort/filter/move state is.
  const handleSelectionChange = useCallback(
    (selection: SheetbaseGridSelection | null) => {
      // The grid re-announces an unchanged selection whenever it re-renders;
      // storing it again as a new object re-renders the grid in turn, so an
      // identical selection is ignored.
      const key = selection ? JSON.stringify(selection) : null

      if (key === selectionKeyRef.current) return
      selectionKeyRef.current = key
      setCommentSelection(selection)
      selectionRef.current = selection

      if (!selection) return
      setActiveInput(selection.input ?? '')
      // Bench entry follows the run picked in the grid.
      setBenchRow(null)

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
    [persistPresentation],
  )

  // GRID-04: persist the new column order as stable column IDs. The wrapper
  // resets its own visual index map afterwards (`resetColumnOrderOnChange`),
  // so the rebuilt rows already carry the persisted order.
  const handleColumnOrderChange = useCallback(
    (columnIds: string[]) => {
      void persistPresentation({ columnOrder: columnIds })
    },
    [persistPresentation],
  )

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
    [persistPresentation],
  )

  const handleFiltersChange = useCallback(
    (filters: SheetbaseGridFilter[]) => {
      // Column-menu Apply moves that column's filter to the end. Unlike sort
      // precedence, conjunction order does not change the working view.
      const next = [...filters].sort((a, b) =>
        a.columnId.localeCompare(b.columnId),
      )

      const current = [...instanceRef.current.state.presentation.filters].sort(
        (a, b) => a.columnId.localeCompare(b.columnId),
      )

      if (JSON.stringify(next) === JSON.stringify(current)) return
      void persistPresentation({ filters })
    },
    [persistPresentation],
  )

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
    setWriteStatus(t('notebook.canonicalSheetWorkspace.nothingToClearThe'))
  }, [])

  // QA-156: "Clear contents" is a destructive bulk write, so the menu asks
  // first. The clear is built from the grid's own selection report and flows
  // through the same change pipeline as every other write (editable check,
  // parse, validate, then the authoritative local or write-back target),
  // skipping cells that are already empty.
  const clearSelectedCells = useCallback(() => {
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

    const columnIndices = new Map(
      current.columns.map((column, index) => [column.id, index]),
    )

    const rowIndices = new Map(
      current.rowKeys.map((rowKey, index) => [rowKey, index]),
    )

    for (const columnId of columnIds) {
      const columnIndex = columnIndices.get(columnId)

      if (columnIndex === undefined) continue

      const column = current.columns.at(columnIndex)

      if (!column || !column.editable) continue

      for (const rowId of rowIds) {
        const rowIndex = rowIndices.get(rowId)

        if (rowIndex === undefined) continue
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
  }, [handleCellsChange, handleNothingToClear])

  const columnMenu = useMemo<SheetbaseGridMenuEntry[]>(
    () => [
      'separator',
      {
        id: 'freeze-to-column',
        label: t('notebook.canonicalSheetWorkspace.freezeUpToThisLabel'),
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
        label: t('notebook.canonicalSheetWorkspace.unfreezeColumnsLabel'),
        disabled: () => presentation.frozenColumnCount === 0,
        onSelect: () => {
          void persistPresentation({ frozenColumnCount: 0 })
        },
      },
      'separator',
      {
        id: 'hide-columns',
        label: t('notebook.canonicalSheetWorkspace.hideSelectedColumnsLabel'),
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
        label: t('notebook.canonicalSheetWorkspace.promoteColumnLabel'),
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
    [
      canWrite,
      instance,
      presentation.frozenColumnCount,
      selectedColumn,
      persistPresentation,
    ],
  )

  const contextMenu = useMemo<SheetbaseGridMenuEntry[]>(
    () => [
      {
        id: 'insert-row',
        label: t('notebook.canonicalSheetWorkspace.insertRowLabel'),
        disabled: () => !canWrite,
        onSelect: () => {
          void addRowRef.current()
        },
      },
      {
        id: 'insert-column',
        label: t('notebook.canonicalSheetWorkspace.insertColumnLabel'),
        disabled: () => !canWrite,
        onSelect: () => {
          void addColumnRef.current()
        },
      },
      {
        id: 'delete-row',
        label: t('notebook.canonicalSheetWorkspace.deleteLocalRowLabel'),
        disabled: () => !canWrite,
        // QA-156: deleting a local row is destructive and was immediate.
        onSelect: () =>
          setPendingDestructive({
            title: t('notebook.canonicalSheetWorkspace.title'),
            description: t('notebook.canonicalSheetWorkspace.description'),
            confirmLabel: t('notebook.canonicalSheetWorkspace.confirmLabel'),
            run: () => {
              void deleteRowRef.current()
            },
          }),
      },
      {
        id: 'delete-column',
        label: t('notebook.canonicalSheetWorkspace.retireLocalColumnLabel'),
        disabled: () => !canWrite,
        // QA-156: retiring a column changes what the Sheet can hold, so it is
        // confirmed like the row delete beside it.
        onSelect: () =>
          setPendingDestructive({
            title: t(
              'notebook.canonicalSheetWorkspace.retireThisLocalColumnTitle',
            ),
            description: t(
              'notebook.canonicalSheetWorkspace.theSheetStopsOfferingDescription',
            ),
            confirmLabel: t('notebook.canonicalSheetWorkspace.confirmLabel2'),
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
        label: t('notebook.canonicalSheetWorkspace.clearContentsLabel'),
        disabled: () => !canWrite,
        // QA-156: the previous entry was a bare string the grid wrapper drops,
        // so it never reached the menu; this one is a real, confirmed action.
        onSelect: () =>
          setPendingDestructive({
            title: t(
              'notebook.canonicalSheetWorkspace.clearTheSelectedCellsTitle',
            ),
            description: t(
              'notebook.canonicalSheetWorkspace.everyEditableNonEmptyDescription',
            ),
            confirmLabel: t('notebook.canonicalSheetWorkspace.confirmLabel3'),
            run: clearSelectedCells,
          }),
      },
    ],
    [canWrite, clearSelectedCells],
  )

  useEffect(() => {
    if (composition.error) {
      setWriteStatus(t('notebook.canonicalSheetWorkspace.thisSheetCouldNot2'))
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
      { rowId: string; columnId: string; text: string; count: number }
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
        const text = `${comment.state === 'resolved' ? t('notebook.canonicalSheetWorkspace.resolved') : t('common.actions.open')}: ${comment.body}`
        const previous = notes.get(key)
        notes.set(key, {
          rowId,
          columnId,
          text: previous ? `${previous.text}\n${text}` : text,
          count: (previous?.count ?? 0) + 1,
        })
      }
    }

    return [...notes.values()]
  }, [comments.data, instance.id, matrix.rowKeys, matrix.columns])

  const availableRowKeys = useMemo(
    () => new Set(matrix.rowKeys),
    [matrix.rowKeys],
  )

  const availableColumnIds = useMemo(
    () => new Set(matrix.columns.map((column) => column.id)),
    [matrix.columns],
  )

  return {
    heading,
    headingAside,
    instance,
    projectId,
    readOnly,
    commentActor,
    commentId,
    cellState,
    queryClient,
    instanceRef,
    composed,
    canWrite,
    gridContainerRef,
    gridHandle,
    setGridHandle,
    activeInput,
    commentSelection,
    commentDraft,
    setCommentDraft,
    canComment,
    columnLabel,
    setColumnLabel,
    columnType,
    setColumnType,
    calculatorOpen,
    setCalculatorOpen,
    pasteOpen,
    setPasteOpen,
    pasting,
    sheetTool,
    setSheetTool,
    formula,
    setFormula,
    formulaLabel,
    setFormulaLabel,
    formulaQuantityColumn,
    setFormulaQuantityColumn,
    selected,
    promoteField,
    setPromoteField,
    pendingDestructive,
    setPendingDestructive,
    keptLocalFields,
    setKeptLocalFields,
    writeStatus,
    writeBackFailure,
    savedViewExists,
    picker,
    setPicker,
    recordLabelsRef,
    createOpen,
    setCreateOpen,
    title,
    setTitle,
    custom,
    setCustom,
    setQuery,
    pendingValues,
    errors,
    setErrors,
    errorCursor,
    setErrorCursor,
    setPageCount,
    composition,
    composedSnapshot,
    calculations,
    presentation,
    matrix,
    modelKey,
    fields,
    search,
    actions,
    selectedColumn,
    openPromotion,
    provenance,
    openConflicts,
    selectedConflict,
    setResolvedConflictIds,
    revealFirstConflict,
    localMutate,
    persistPresentation,
    addColumn,
    addRow,
    pasteTable,
    saveView,
    restoreView,
    resetView,
    addCalculation,
    writeBack,
    link,
    create,
    sheetColumns,
    sheetRows,
    cellDisplays,
    handleBeforeRowsRemove,
    handleRowsRemoved,
    handleRowsInserted,
    handleBeforeCellsChange,
    handleCellsChange,
    handleSelectionChange,
    handleColumnResize,
    handleColumnOrderChange,
    handleSortsChange,
    handleFiltersChange,
    handleOpenRecordPicker,
    handleNothingToClear,
    columnMenu,
    contextMenu,
    staleCalc,
    visualiseDatasetId,
    openSelectionComment,
    commentAnnotations,
    availableRowKeys,
    availableColumnIds,
    details,
    setDetails,
    historyOpen,
    setHistoryOpen,
    benchEntry,
    setBenchEntry,
    benchRow,
    setBenchRow,
    ...sheetChanges,
    cellBefore,
    writeMarks,
    cellMark,
  }
}

const SHEET_DETAILS_KEY = 'sheetbase.sheet.details'
const SHEET_BENCH_KEY = 'sheetbase.sheet.bench'

/** Whether this device last left sheets with this view switched on. */
function readSheetPreference(key: string): boolean {
  try {
    return globalThis.localStorage.getItem(key) === 'on'
  } catch {
    return false
  }
}

function writeSheetPreference(key: string, on: boolean): void {
  try {
    if (on) globalThis.localStorage.setItem(key, 'on')
    else globalThis.localStorage.removeItem(key)
  } catch {
    // Storage can be off (private windows); the choice then lasts the visit.
  }
}

/** The table's one save line, from the writes this sheet has in flight. */
function sheetSaveState(input: {
  canWrite: boolean
  readOnly: boolean
  pending: boolean
  failed: boolean
}): SheetSaveState | null {
  if (input.readOnly) return 'read-only'

  if (!input.canWrite) return null

  if (input.pending) return 'saving'

  return input.failed ? 'failed' : 'saved'
}

const CanonicalWorkspaceContext = createContext<ReturnType<
  typeof useCanonicalWorkspaceSession
> | null>(null)

function useCanonicalWorkspace() {
  const session = useContext(CanonicalWorkspaceContext)

  if (!session) throw new Error('Canonical workspace session is unavailable')

  return session
}

/** Instance identity owns the editor session, including paging and drafts. */
export function CanonicalSheetEditor(
  props: Parameters<typeof useCanonicalWorkspaceSession>[0],
) {
  return <CanonicalWorkspaceSession key={props.instance.id} {...props} />
}

function CanonicalWorkspaceSession(
  props: Parameters<typeof useCanonicalWorkspaceSession>[0],
) {
  const session = useCanonicalWorkspaceSession(props)

  return (
    <CanonicalWorkspaceContext.Provider value={session}>
      <div className="flex h-full w-full min-w-0 flex-1 flex-col">
        <CanonicalWorkspaceToolbar />
        <CanonicalWorkspaceAuthoring />
        <CanonicalWorkspaceBenchEntry />
        <CanonicalWorkspaceRecordToolbar />
        <CanonicalWorkspacePagination />
        <CanonicalWorkspaceGridArea />
        <CanonicalWorkspaceStatus />
        <CanonicalWorkspaceComments />
        <CanonicalWorkspaceDialogs />
        <CanonicalWorkspaceRecords />
      </div>
    </CanonicalWorkspaceContext.Provider>
  )
}

function CanonicalWorkspaceToolbar() {
  const {
    heading,
    headingAside,
    matrix,
    canWrite,
    readOnly,
    localMutate,
    writeBack,
    addCalculation,
  } = useCanonicalWorkspace()

  const phone = usePhoneToolbar()

  const saveState = sheetSaveState({
    canWrite,
    readOnly,
    pending:
      localMutate.isPending || writeBack.isPending || addCalculation.isPending,
    failed: localMutate.isError || writeBack.isError,
  })

  const failure = localMutate.error?.message ?? writeBack.error?.message

  return (
    <div
      role="toolbar"
      aria-label={t('notebook.canonicalSheetWorkspace.ariaLabel')}
      className="@container flex min-h-11 shrink-0 flex-wrap items-center md:flex-nowrap gap-x-2 gap-y-1 border-b border-border-subtle px-3.5 py-1.5 max-md:px-2"
    >
      {heading ? (
        <div className="flex min-w-0 shrink items-center gap-2 max-md:basis-full">
          <Icon
            name="table"
            size={14}
            aria-hidden="true"
            className="shrink-0 text-fg-muted"
          />
          {heading}
          <span className="shrink-0 text-label text-fg-muted">
            {t('notebook.sheetToolbar.rows', { count: matrix.rowKeys.length })}
          </span>
          {headingAside}
        </div>
      ) : null}
      <span className="flex-1" />
      <SheetSaveStatus state={saveState} detail={failure} />
      {canWrite && matrix.columns.length > 0 ? <SheetToolbarRule /> : null}
      <SheetEntryModeSwitch />
      <SheetToolbarChips />
      {phone ? <SheetFilters compact /> : <SheetViewSwitches />}
      <CanonicalWorkspaceMoreMenu phone={phone} />
    </div>
  )
}

/** Document or Bench entry: how a run is typed. */
function SheetEntryModeSwitch() {
  const { canWrite, matrix, benchEntry, setBenchEntry } =
    useCanonicalWorkspace()

  if (!canWrite || matrix.columns.length === 0) return null

  return (
    <>
      <div
        role="group"
        aria-label={t('notebook.sheetBench.entryModeAriaLabel')}
        className="inline-flex rounded-md border border-border p-0.5"
      >
        <Button
          type="button"
          size="sm"
          variant={benchEntry ? 'quiet' : 'secondary'}
          aria-pressed={!benchEntry}
          className={cn(
            'h-5 border-0 max-md:h-7',
            !benchEntry && 'bg-selected font-medium',
          )}
          onClick={() => setBenchEntry(false)}
        >
          {t('notebook.sheetBench.document')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={benchEntry ? 'secondary' : 'quiet'}
          aria-pressed={benchEntry}
          className={cn(
            'h-5 border-0 max-md:h-7',
            benchEntry && 'bg-selected font-medium',
          )}
          onClick={() => setBenchEntry(true)}
        >
          {t('notebook.sheetBench.benchEntry')}
        </Button>
      </div>
    </>
  )
}

/** What is on right now: write back, active filters, hidden columns. */
function SheetToolbarChips() {
  const {
    composed,
    canWrite,
    writeBack,
    pendingValues,
    presentation,
    persistPresentation,
  } = useCanonicalWorkspace()

  return (
    <>
      {composed && canWrite ? (
        <Button
          type="button"
          size="sm"
          disabled={
            writeBack.isPending || Object.keys(pendingValues).length === 0
          }
          onClick={() => writeBack.mutate()}
        >
          {t('notebook.canonicalSheetWorkspace.writeBack')}
        </Button>
      ) : null}
      {presentation.hiddenColumnIds.length > 0 ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => void persistPresentation({ hiddenColumnIds: [] })}
        >
          {t('notebook.canonicalSheetWorkspace.showHiddenColumns', {
            count: presentation.hiddenColumnIds.length,
          })}
        </Button>
      ) : null}
    </>
  )
}

/** Show changes and Columns, shown above phone width. */
/** Filters, on every width: the same filters the column menus set. */
function SheetFilters({ compact = false }: { compact?: boolean }) {
  const { sheetColumns, presentation, handleFiltersChange } =
    useCanonicalWorkspace()

  if (sheetColumns.length === 0) return null

  return (
    <SheetFiltersButton
      compact={compact}
      columns={sheetColumns}
      filters={presentation.filters}
      onChange={handleFiltersChange}
    />
  )
}

function SheetViewSwitches() {
  const { matrix, sheetTool, setSheetTool, showChanges, setShowChanges } =
    useCanonicalWorkspace()

  return (
    <>
      <SheetToolbarSwitch
        on={showChanges}
        label={t('notebook.sheetChanges.toggle')}
        title={t('notebook.sheetChanges.toggleHint')}
        onChange={setShowChanges}
      />
      <SheetToolbarRule />
      <SheetFilters />
      {matrix.columns.length > 0 ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          title={t('notebook.sheetToolbar.columnsHint')}
          aria-expanded={sheetTool === 'view'}
          onClick={() => setSheetTool(sheetTool === 'view' ? null : 'view')}
        >
          {t('notebook.sheetToolbar.columns')}
        </Button>
      ) : null}
    </>
  )
}

/** The tools a sheet needs now and then, and the dialogs they open. */
function CanonicalWorkspaceMoreMenu({ phone }: { phone: boolean }) {
  const {
    canWrite,
    localMutate,
    addRow,
    sheetTool,
    setSheetTool,
    setPasteOpen,
    matrix,
    setCalculatorOpen,
    calculatorOpen,
    commentActor,
    canComment,
    commentSelection,
    openSelectionComment,
    visualiseDatasetId,
    instance,
    details,
    setDetails,
    historyOpen,
    setHistoryOpen,
    showChanges,
    setShowChanges,
  } = useCanonicalWorkspace()

  const navigate = useNavigate()

  const exportPath = `/api/export/sheet-instance/${instance.id}`

  const addItems: SheetMoreItem[] = canWrite
    ? [
        {
          id: 'add-row',
          label: t('notebook.canonicalSheetWorkspace.addRow'),
          icon: 'plus',
          disabled: localMutate.isPending,
          onSelect: () => void addRow(),
        },
        {
          id: 'new-column',
          label: t('notebook.canonicalSheetWorkspace.newColumn'),
          icon: 'table',
          onSelect: () => setSheetTool('column'),
        },
        {
          id: 'new-calculation',
          label: t('notebook.canonicalSheetWorkspace.newCalculation'),
          icon: 'sigma',
          onSelect: () => setSheetTool('calculation'),
        },
        {
          id: 'paste',
          label: t('notebook.canonicalSheetWorkspace.pasteData'),
          icon: 'clipboardList',
          disabled: localMutate.isPending,
          onSelect: () => setPasteOpen(true),
        },
      ]
    : []

  const toolItems: SheetMoreItem[] = [
    {
      id: 'calculator',
      label: t('calculators.open'),
      icon: 'calculator',
      onSelect: () => setCalculatorOpen(true),
    },
    ...(commentActor
      ? [
          {
            id: 'comment',
            label: t('notebook.canonicalSheetWorkspace.commentOnSelection'),
            icon: 'comment' as const,
            disabled: !canComment || !commentSelection?.rowId,
            onSelect: () => openSelectionComment(),
          },
        ]
      : []),
    ...(visualiseDatasetId
      ? [
          {
            id: 'visualise',
            label: t('notebook.canonicalSheetWorkspace.visualise'),
            icon: 'chart' as const,
            onSelect: () =>
              void navigate({
                to: '/analysis/new',
                search: { dataset: visualiseDatasetId },
              }),
          },
        ]
      : []),
    {
      id: 'history',
      label: t('notebook.sheetToolbar.history'),
      icon: 'history',
      onSelect: () => setHistoryOpen(true),
    },
  ]

  // Details, the steward's view of how the sheet is wired, always sits in
  // More. On a phone the other view switches ride there too, so the toolbar
  // stays one row.
  const detailsItem: SheetMoreItem = {
    id: 'details',
    label: details
      ? t('notebook.sheetToolbar.hideDetails')
      : t('notebook.sheetToolbar.details'),
    icon: 'info',
    onSelect: () => setDetails(!details),
  }

  const viewItems: SheetMoreItem[] = phone
    ? [
        ...(matrix.columns.length > 0
          ? [
              {
                id: 'columns',
                label: t('notebook.sheetToolbar.columns'),
                icon: 'table' as const,
                onSelect: () =>
                  setSheetTool(sheetTool === 'view' ? null : 'view'),
              },
            ]
          : []),
        detailsItem,
        {
          id: 'changes',
          label: showChanges
            ? t('notebook.sheetChanges.hide')
            : t('notebook.sheetChanges.toggle'),
          icon: 'history',
          onSelect: () => setShowChanges(!showChanges),
        },
      ]
    : [detailsItem]

  const downloadItems: SheetMoreItem[] = [
    {
      id: 'export-xlsx',
      label: t('notebook.canonicalSheetWorkspace.xlsxLocalGridLabel'),
      icon: 'download',
      onSelect: () => downloadExport(exportPath, 'xlsx'),
    },
    {
      id: 'export-csv',
      label: t('notebook.canonicalSheetWorkspace.csvLocalGridLabel'),
      icon: 'download',
      onSelect: () => downloadExport(exportPath, 'csv'),
    },
    {
      id: 'export-json',
      label: t('notebook.canonicalSheetWorkspace.jsonFullStateLabel'),
      icon: 'download',
      onSelect: () => downloadExport(exportPath, 'json'),
    },
  ]

  return (
    <>
      <SheetMoreMenu
        groups={[
          { id: 'view', items: viewItems },
          {
            id: 'add',
            label: t('notebook.sheetToolbar.addGroup'),
            items: addItems,
          },
          {
            id: 'tools',
            label: t('notebook.sheetToolbar.toolsGroup'),
            items: toolItems,
          },
          {
            id: 'download',
            label: t('notebook.sheetToolbar.downloadGroup'),
            items: downloadItems,
          },
        ]}
      />
      <BenchCalculatorDialog
        open={calculatorOpen}
        onOpenChange={setCalculatorOpen}
      />
      <ObjectHistoryDialog
        objectId={instance.id}
        objectLabel={t('notebook.canonicalSheetWorkspace.objectLabel')}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
      />
    </>
  )
}

function CanonicalWorkspaceBenchEntry() {
  const {
    canWrite,
    benchEntry,
    benchRow,
    setBenchRow,
    matrix,
    sheetColumns,
    commentSelection,
    gridHandle,
    localMutate,
    handleBeforeCellsChange,
    handleCellsChange,
  } = useCanonicalWorkspace()

  if (!benchEntry || !canWrite || matrix.columns.length === 0) return null

  const rowCount = matrix.rowKeys.length

  const selectedIndex = commentSelection?.rowId
    ? matrix.rowKeys.indexOf(commentSelection.rowId)
    : -1
  // The run on the strip: the one chosen here, else the grid's selected run,
  // else the last run.

  const rowIndex = Math.min(
    benchRow ??
      (selectedIndex >= 0 ? selectedIndex : Math.max(rowCount - 1, 0)),
    rowCount,
  )

  return (
    <SheetBenchEntry
      columns={matrix.columns}
      gridColumns={sheetColumns}
      rowIndex={rowIndex}
      rowCount={rowCount}
      values={matrix.data[rowIndex] ?? []}
      canWrite={canWrite}
      saving={localMutate.isPending}
      onMove={(next) => {
        setBenchRow(next)

        if (next < rowCount) gridHandle?.scrollCellIntoView(next, 0)
      }}
      onSave={(changes) => {
        const rowId = matrix.rowKeys[rowIndex]

        const gridChanges: SheetbaseGridCellChange[] = changes.map(
          (change) => ({
            rowIndex,
            rowId,
            columnId: change.columnId,
            previous: change.previous,
            next: change.next,
          }),
        )

        if (handleBeforeCellsChange(gridChanges, 'edit') === false) return
        handleCellsChange(gridChanges, 'edit')
        // A new run saved: the strip offers the next new run.

        if (rowIndex >= rowCount) setBenchRow(rowCount + 1)
      }}
    />
  )
}

function CanonicalWorkspaceAuthoring() {
  const {
    canWrite,
    sheetTool,
    columnLabel,
    setColumnLabel,
    columnType,
    setColumnType,
    localMutate,
    addColumn,
    formula,
    setFormula,
    formulaLabel,
    setFormulaLabel,
    formulaQuantityColumn,
    setFormulaQuantityColumn,
    matrix,
    addCalculation,
    presentation,
    persistPresentation,
    saveView,
    savedViewExists,
    restoreView,
    resetView,
  } = useCanonicalWorkspace()

  return (
    <>
      {canWrite && sheetTool === 'column' ? (
        <div
          role="group"
          aria-label={t(
            'notebook.canonicalSheetWorkspace.localColumnsAndRowsAriaLabel',
          )}
          className="flex flex-wrap items-end gap-2 border-b px-2 py-2"
        >
          <label className="space-y-1 text-xs">
            <span className="text-fg-muted">
              {t('notebook.canonicalSheetWorkspace.newColumn2')}
            </span>
            <Input
              value={columnLabel}
              onChange={(event) => setColumnLabel(event.target.value)}
              placeholder={t('notebook.canonicalSheetWorkspace.placeholder')}
              className="h-8 w-40"
            />
          </label>
          <Select
            aria-label={t(
              'notebook.canonicalSheetWorkspace.newColumnTypeAriaLabel',
            )}
            className="h-8 w-28"
            value={columnType}
            onChange={(event) =>
              setColumnType(
                event.target.value === 'decimal' ? 'decimal' : 'text',
              )
            }
          >
            <option value="text">
              {t('notebook.canonicalSheetWorkspace.text')}
            </option>
            <option value="decimal">
              {t('notebook.canonicalSheetWorkspace.number')}
            </option>
          </Select>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={localMutate.isPending}
            onClick={() => void addColumn()}
          >
            {t('notebook.canonicalSheetWorkspace.addColumn')}
          </Button>
        </div>
      ) : null}
      {canWrite && sheetTool === 'calculation' ? (
        <div
          role="group"
          aria-label={t(
            'notebook.canonicalSheetWorkspace.calculationsAriaLabel',
          )}
          className="flex flex-wrap items-end gap-2 border-b px-2 py-2"
        >
          <label className="space-y-1 text-xs">
            <span className="text-fg-muted">
              {t('notebook.canonicalSheetWorkspace.formula')}
            </span>
            <Input
              value={formula}
              onChange={(event) => setFormula(event.target.value)}
              placeholder="=A1*2"
              className="h-8 w-32"
              aria-label={t(
                'notebook.canonicalSheetWorkspace.calculationFormulaAriaLabel',
              )}
            />
          </label>
          <Input
            value={formulaLabel}
            onChange={(event) => setFormulaLabel(event.target.value)}
            placeholder={t('notebook.canonicalSheetWorkspace.labelPlaceholder')}
            className="h-8 w-28"
            aria-label={t(
              'notebook.canonicalSheetWorkspace.calculationLabelAriaLabel',
            )}
          />
          <Select
            aria-label={t(
              'notebook.canonicalSheetWorkspace.calculationQuantityAriaLabel',
            )}
            className="h-8 w-56"
            value={formulaQuantityColumn}
            onChange={(event) => setFormulaQuantityColumn(event.target.value)}
          >
            <option value="">
              {t('notebook.canonicalSheetWorkspace.unitlessResult')}
            </option>
            {matrix.columns
              .filter((column) => column.field?.quantity)
              .map((column) => (
                <option key={column.id} value={column.id}>
                  {t(
                    'notebook.canonicalSheetWorkspace.sameAsLabelStorageunit',
                    {
                      label: column.field?.label ?? '',
                      storageUnit: column.field?.quantity?.storageUnit ?? '',
                    },
                  )}
                </option>
              ))}
          </Select>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={addCalculation.isPending || localMutate.isPending}
            onClick={() => addCalculation.mutate()}
          >
            {t('notebook.canonicalSheetWorkspace.addCalculation')}
          </Button>
        </div>
      ) : null}
      {canWrite && sheetTool === 'view' && matrix.columns.length > 0 ? (
        <div
          className="flex flex-wrap items-center gap-2 border-b px-2 py-1 text-xs"
          role="group"
          aria-label={t(
            'notebook.canonicalSheetWorkspace.workingViewControlsAriaLabel',
          )}
        >
          <span className="flex items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              aria-label={t(
                'notebook.canonicalSheetWorkspace.freezeOneFewerColumnAriaLabel',
              )}
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
              aria-label={t(
                'notebook.canonicalSheetWorkspace.freezeOneMoreColumnAriaLabel',
              )}
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
          <span className="ml-auto flex items-center gap-2">
            <Button type="button" size="sm" variant="quiet" onClick={saveView}>
              {t('notebook.canonicalSheetWorkspace.saveView')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="quiet"
              disabled={!savedViewExists}
              onClick={restoreView}
            >
              {t('notebook.canonicalSheetWorkspace.restoreView')}
            </Button>
            <Button type="button" size="sm" variant="quiet" onClick={resetView}>
              {t('notebook.canonicalSheetWorkspace.resetView')}
            </Button>
          </span>
        </div>
      ) : null}
    </>
  )
}

function CanonicalWorkspaceRecordToolbar() {
  const {
    composed,
    canWrite,
    actions,
    errors,
    setPicker,
    modelKey,
    setCreateOpen,
    projectId,
    composedSnapshot,
    pendingValues,
    setErrors,
    setErrorCursor,
    queryClient,
    instance,
    errorCursor,
  } = useCanonicalWorkspace()

  return (
    <>
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

            const next = sheetRecordGridErrorsFromValidation(result)

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
    </>
  )
}

function CanonicalWorkspacePagination() {
  const { composed } = useCanonicalWorkspace()

  return <>{composed ? <CanonicalWorkspacePageStatus /> : null}</>
}

function CanonicalWorkspacePageStatus() {
  const { composition, composedSnapshot, matrix, setPageCount } =
    useCanonicalWorkspace()

  return (
    <>
      <div
        className="flex flex-wrap items-center gap-2 border-b px-2 py-1 text-xs text-fg-muted"
        role="status"
        aria-live="polite"
      >
        {composition.isLoading ? (
          <span>
            {t('notebook.canonicalSheetWorkspace.loadingComposedRows')}
          </span>
        ) : (
          <>
            <span>
              {composedSnapshot?.hasMore
                ? t('notebook.canonicalSheetWorkspace.showingCountRowsMore', {
                    count: matrix.rowKeys.length,
                  })
                : t('notebook.canonicalSheetWorkspace.showingAllCountRows', {
                    count: matrix.rowKeys.length,
                  })}
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
            {composition.isFetching
              ? t('notebook.canonicalSheetWorkspace.loadingMore')
              : t('notebook.canonicalSheetWorkspace.loadMore')}
          </Button>
        ) : null}
      </div>
    </>
  )
}

/** The grid, with the change list under it and a cell's history beside it. */
function CanonicalWorkspaceGridArea() {
  const {
    showChanges,
    changeRows,
    changesToday,
    selectedChangeKey,
    selectedCellHistory,
    changeCellPosition,
    gridHandle,
    writeMarks,
    matrix,
    details,
    instance,
    canWrite,
    selectedColumn,
    setPromoteField,
  } = useCanonicalWorkspace()

  const { provenance, resolvedRowIdentity } = instance.state

  const rowsMatchedOn =
    resolvedRowIdentity && resolvedRowIdentity.kind !== 'local'
      ? resolvedRowIdentity.columnIds.flatMap(
          (id) =>
            matrix.columns.find((column) => column.id === id)?.label ?? [],
        )
      : []

  const from =
    provenance.createdFrom === 'definition_version'
      ? t('notebook.sheetComposition.fromDefinition')
      : provenance.createdFrom === 'duplicate'
        ? t('notebook.sheetComposition.fromDuplicate')
        : t('notebook.sheetComposition.fromAdHoc')

  // The selected column when it is one of the sheet's own, else the first
  // of them that can go to a dataset.
  const addToDataset = (columns: readonly CanonicalSheetGridColumn[]) => {
    const preferred = columns.find((column) => column.id === selectedColumn?.id)

    const field = [preferred, ...columns]
      .map((column) => promotableLocalField(instance, column))
      .find((candidate) => candidate !== null)

    if (field) setPromoteField(field)
  }

  // Changes still saving, or that failed, lead the list with their state.
  const rows = useMemo(() => {
    if (writeMarks.pending.length === 0) return changeRows

    const rowIndex = new Map(matrix.rowKeys.map((key, index) => [key, index]))

    const columnLabel = new Map(
      matrix.columns.map((column) => [column.id, column.label]),
    )

    const pending = writeMarks.pending.map<SheetChangeRow>((write) => ({
      id: `pending-${write.key}`,
      cellKey: write.key,
      who: t('notebook.sheetChanges.you'),
      when: formatTime(write.at),
      cell: t('notebook.sheetChanges.cellLabel', {
        row: (rowIndex.get(write.rowKey) ?? 0) + 1,
        column: columnLabel.get(write.columnId) ?? '',
      }),
      before: write.before,
      after: write.after,
      beforeKnown: true,
      reason: null,
      save: write.state,
      onRetry: write.retry,
    }))

    return [...pending, ...changeRows]
  }, [writeMarks.pending, changeRows, matrix])

  // One tree whether or not changes are shown, so switching them on keeps
  // the grid (and its selection) mounted.
  return (
    <div className="flex min-h-0 flex-initial max-md:flex-col max-md:overflow-y-auto">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col max-md:flex-none">
        <CanonicalWorkspaceGrid />
        {showChanges ? (
          <SheetChangeList
            rows={rows}
            todayCount={changesToday}
            selectedCellKey={selectedChangeKey}
            onSelect={(row) => {
              const at = changeCellPosition(row.cellKey)

              if (at) gridHandle?.selectCell(at.row, at.col)
            }}
          />
        ) : null}
      </div>
      {showChanges ? (
        <SheetCellHistory cell={selectedCellHistory} />
      ) : details ? (
        <SheetCompositionPanel
          columns={matrix.columns}
          rowsMatchedOn={rowsMatchedOn}
          from={from}
          onAddToDataset={canWrite ? addToDataset : undefined}
        />
      ) : null}
    </div>
  )
}

/** Grid geometry, in pixels, from the engine's own rows and headers. */
const GRID_ROW_PX = 28

const GRID_HEADER_PX = 31

/** The box's two border lines. */
const GRID_BOX_EXTRA_PX = 2

/** How tall the grid's box is to show every row without empty space. */
function gridBoxHeight(rowCount: number, grouped: boolean): number {
  const headers = grouped ? 2 : 1

  return headers * GRID_HEADER_PX + rowCount * GRID_ROW_PX + GRID_BOX_EXTRA_PX
}

function filterMatches(text: string, filter: SheetbaseGridFilter): boolean {
  const same =
    text.trim().toLowerCase() ===
    String(filter.value ?? '')
      .trim()
      .toLowerCase()

  switch (filter.operator) {
    case 'equals':
      return same
    case 'not-equals':
      return !same
    case 'is-empty':
      return text.trim() === ''
    case 'is-not-empty':
      return text.trim() !== ''
  }
}

/**
 * About how many rows the grid shows under the sheet's filters, so the box
 * shrinks with them. The grid does the real filtering; a near miss only
 * leaves the box a row too tall or scrolling.
 */
function shownRowCount(
  rows: readonly SheetbaseGridRow[],
  columns: readonly SheetbaseGridColumn[],
  filters: readonly SheetbaseGridFilter[],
): number {
  const active = filters.flatMap((filter) => {
    const index = columns.findIndex((column) => column.id === filter.columnId)

    return index === -1 ? [] : [{ filter, index }]
  })

  if (active.length === 0) return rows.length

  return rows.filter((row) =>
    active.every(({ filter, index }) =>
      filterMatches(gridStoredText(row.cells[index]), filter),
    ),
  ).length
}

function CanonicalWorkspaceGrid() {
  const {
    matrix,
    composition,
    gridContainerRef,
    gridHandle,
    canWrite,
    activeInput,
    sheetRows,
    sheetColumns,
    cellDisplays,
    commentAnnotations,
    instanceRef,
    presentation,
    columnMenu,
    contextMenu,
    handleBeforeCellsChange,
    handleCellsChange,
    handleSelectionChange,
    setGridHandle,
    cellState,
    instance,
    handleColumnResize,
    handleColumnOrderChange,
    handleSortsChange,
    handleFiltersChange,
    handleOpenRecordPicker,
    handleNothingToClear,
    handleBeforeRowsRemove,
    handleRowsRemoved,
    handleRowsInserted,
    cellBefore,
    cellMark,
  } = useCanonicalWorkspace()

  return (
    <>
      {matrix.columns.length === 0 ? (
        <p className="p-3 text-sm text-fg-muted" role="status">
          {t('notebook.canonicalSheetWorkspace.thisSheetHasNo')}
        </p>
      ) : composition.isLoading ? (
        <p className="p-3 text-sm text-fg-muted" role="status">
          {t('notebook.canonicalSheetWorkspace.loadingComposedSheet')}
        </p>
      ) : (
        <div
          ref={gridContainerRef}
          className="mx-3.5 my-3 max-h-[var(--sheet-grid-max-h,70vh)] min-h-40 shrink overflow-hidden rounded-md border border-border max-md:mx-2 max-md:my-2"
          // The box is as tall as its rows, as on the design board, and
          // scrolls inside once it reaches the space it has.
          style={{
            height: gridBoxHeight(
              shownRowCount(sheetRows, sheetColumns, presentation.filters) +
                (canWrite ? 1 : 0),
              sheetColumns.some((column) => column.group !== undefined),
            ),
          }}
        >
          <SheetKeyboardShortcuts
            handle={gridHandle}
            containerRef={gridContainerRef}
            readOnly={!canWrite}
            activeInput={activeInput}
            rowCount={sheetRows.length + (canWrite ? 1 : 0)}
            columnCount={sheetColumns.length}
          />
          <SheetbaseTableGrid
            ariaLabel={t('notebook.canonicalSheetWorkspace.sheetAriaLabel')}
            columns={sheetColumns}
            cellDisplays={cellDisplays}
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
            // A value outside its field's range is flagged in danger text
            // unless the host gives the cell a state of its own.
            cellState={(rowIndex, columnId) => {
              const hosted = cellState?.({
                instanceId: instance.id,
                rowId: matrix.rowKeys[rowIndex] ?? '',
                columnId,
              })

              if (hosted) return hosted

              const index = matrix.columns.findIndex(
                (column) => column.id === columnId,
              )

              return outOfRange(
                matrix.columns[index],
                matrix.data[rowIndex]?.[index],
              )
                ? 'flagged'
                : undefined
            }}
            cellBefore={cellBefore}
            cellMark={cellMark}
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
    </>
  )
}

function CanonicalWorkspacePromotionStatus() {
  const {
    openConflicts,
    revealFirstConflict,
    openPromotion,
    keptLocalFields,
    selectedColumn,
    instance,
    setKeptLocalFields,
    canWrite,
    setPromoteField,
  } = useCanonicalWorkspace()

  return (
    <>
      {openConflicts.length > 0 ? (
        // EXP-05.4: a Sheet-wide count, with a way to reach the first one —
        // selecting its cell is what puts it in the inspector.
        <p className="flex flex-wrap items-center gap-2" role="status">
          <span>
            {t('notebook.canonicalSheetWorkspace.openConflicts', {
              count: openConflicts.length,
            })}
          </span>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={revealFirstConflict}
          >
            {t('notebook.canonicalSheetWorkspace.reviewFirstConflict')}
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
            ? t('notebook.canonicalSheetWorkspace.promotionRequestedASchema')
            : t('notebook.canonicalSheetWorkspace.promotionApprovedTheColumn')}
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
    </>
  )
}

/** What is wrong with the selected value, in plain words, if anything. */
function selectedBreach(
  matrix: CanonicalSheetGridMatrix,
  selected: { row: number; col: number },
): string | null {
  const column = matrix.columns.at(selected.col)

  if (!column) return null

  return benchRangeBreach(
    column,
    benchInputText(matrix.data[selected.row]?.[selected.col]),
  )
}

/** The foot of the sheet: which cell, what is wrong with it, its comments. */
function SelectedCellLine({
  label,
  breach,
  comments,
}: {
  label: string
  breach: string | null
  comments: number
}) {
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="font-medium text-fg">{label}</span>
      {breach ? (
        <span className="inline-flex items-center gap-1 text-danger-text">
          <Icon name="warn" size={12} aria-hidden="true" />
          {breach}
        </span>
      ) : null}
      {comments > 0 ? (
        <span className="ml-auto">
          {t('notebook.sheetToolbar.comments', { count: comments })}
        </span>
      ) : null}
    </p>
  )
}

/** The foot band's line for the selected cell, while Details is closed. */
function SelectedCellFoot() {
  const { selectedColumn, selected, matrix, commentAnnotations } =
    useCanonicalWorkspace()

  if (!selectedColumn) return null

  const note = commentAnnotations.find(
    (entry) =>
      entry.rowId === matrix.rowKeys[selected.row] &&
      entry.columnId === matrix.columns[selected.col]?.id,
  )

  return (
    <SelectedCellLine
      label={t('notebook.sheetChanges.cellLabel', {
        row: selected.row + 1,
        column: selectedColumn.label,
      })}
      breach={selectedBreach(matrix, selected)}
      comments={note?.count ?? 0}
    />
  )
}

function CanonicalWorkspaceStatus() {
  const {
    staleCalc,
    readOnly,
    calculations,
    writeStatus,
    writeBackFailure,
    localMutate,
    addCalculation,
    errorCursor,
    selectedColumn,
    provenance,
    details,
    selected,
    canWrite,
    instance,
  } = useCanonicalWorkspace()

  const error =
    localMutate.error?.message ??
    addCalculation.error?.message ??
    calculations.error?.message

  return (
    <div className="space-y-1 border-t border-border-subtle bg-surface-muted px-3.5 py-2 text-xs text-fg-muted empty:hidden max-md:px-2">
      {details ? null : <SelectedCellFoot />}
      <CanonicalWorkspacePromotionStatus />
      {staleCalc ? (
        <p role="status" className="flex flex-wrap items-center gap-2">
          {t('notebook.canonicalSheetWorkspace.calculationStale')}
          {readOnly ? null : (
            <Button
              size="sm"
              disabled={calculations.isFetching}
              onClick={() => void calculations.refetch()}
            >
              {calculations.isFetching
                ? t('notebook.canonicalSheetWorkspace.recalculating')
                : t('notebook.canonicalSheetWorkspace.recalculate')}
            </Button>
          )}
        </p>
      ) : null}
      {writeStatus && writeStatus !== error ? (
        <p role="status">{writeStatus}</p>
      ) : null}
      {writeBackFailure ? (
        <WriteBackExplain failure={writeBackFailure} />
      ) : null}
      {error ? (
        <p className="text-danger-text" role="alert">
          {error}
        </p>
      ) : null}
      {errorCursor ? (
        <p role="status">
          {errorCursor.rowKey}: {errorCursor.message}
        </p>
      ) : null}
      {details && selectedColumn ? (
        <SheetProvenanceLine
          columnLabel={selectedColumn.label}
          columnOrigin={selectedColumn.origin}
          provenance={provenance}
          rowNumber={selected.row + 1}
          canWrite={canWrite}
          editable={selectedColumn.editable}
          nextRevision={instance.revision + 1}
          sourceLabel={selectedColumn.sourceLabel}
        />
      ) : null}
    </div>
  )
}

function CanonicalWorkspaceComments() {
  const {
    commentDraft,
    commentActor,
    openSelectionComment,
    setCommentDraft,
    commentId,
    canComment,
    availableRowKeys,
    availableColumnIds,
    instance,
  } = useCanonicalWorkspace()

  return (
    <>
      {commentDraft && commentActor ? (
        <aside
          className="space-y-3 border-t p-3"
          aria-label={t(
            'notebook.canonicalSheetWorkspace.sheetCommentsInspectorAriaLabel',
          )}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">
              {t('notebook.canonicalSheetWorkspace.sheetComments')}
            </span>
            <Button
              type="button"
              size="sm"
              variant="quiet"
              onClick={() => openSelectionComment('sheet_cell')}
            >
              {t('notebook.canonicalSheetWorkspace.cell')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="quiet"
              onClick={() => openSelectionComment('sheet_row')}
            >
              {t('notebook.canonicalSheetWorkspace.row')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="quiet"
              onClick={() => openSelectionComment('sheet_range')}
            >
              {t('notebook.canonicalSheetWorkspace.range')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="quiet"
              onClick={() => setCommentDraft(null)}
            >
              {t('notebook.canonicalSheetWorkspace.closeComments')}
            </Button>
          </div>
          <p className="text-xs text-fg-muted">
            {t('notebook.canonicalSheetWorkspace.newCommentTarget', {
              kind: commentDraft.anchor.targetKind.replace('sheet_', ''),
              rows: t('common.counts.rows', {
                count: commentDraft.anchor.target.rowKeys.length,
              }),
              fields:
                commentDraft.anchor.targetKind === 'sheet_row'
                  ? ''
                  : ` · ${t('notebook.commentThread.fields', {
                      count: commentDraft.anchor.target.fieldIds.length,
                    })}`,
            })}
          </p>
          <CommentPanel
            sheet={commentDraft}
            focusCommentId={commentId}
            currentUserId={commentActor.user.id}
            currentUserName={commentActor.user.name}
            canComment={canComment}
            canCreate={
              commentDraft.anchor.target.rowKeys.every((id) =>
                availableRowKeys.has(id),
              ) &&
              commentDraft.anchor.target.fieldIds.every((id) =>
                availableColumnIds.has(id),
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
                  availableRowKeys.has(id),
                ) &&
                anchor.data.target.fieldIds.every((id) =>
                  availableColumnIds.has(id),
                )
              )
            }}
          />
        </aside>
      ) : null}
    </>
  )
}

function CanonicalWorkspaceDialogs() {
  const {
    selectedConflict,
    commentActor,
    selectedColumn,
    selected,
    setResolvedConflictIds,
    queryClient,
    instance,
    pendingDestructive,
    setPendingDestructive,
    pasteOpen,
    setPasteOpen,
    pasting,
    pasteTable,
    promoteField,
    setPromoteField,
    canWrite,
    details,
  } = useCanonicalWorkspace()

  return (
    <>
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
              ? t('notebook.canonicalSheetWorkspace.rowRowLabel', {
                  row: selected.row + 1,
                  label: selectedColumn.label,
                })
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
              <ConfirmDialogCancel>
                {t('common.actions.cancel')}
              </ConfirmDialogCancel>
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
      <SheetPasteData
        open={pasteOpen}
        onOpenChange={setPasteOpen}
        busy={pasting}
        onApply={(table) => void pasteTable(table)}
      />
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
            // The promotions panel above the grid and the steward's Inbox read
            // the same request, so they learn of it now, not on the next visit.
            void queryClient.invalidateQueries({
              queryKey: ['ui-port', 'column-promotions'],
            })
            void queryClient.invalidateQueries({ queryKey: ['work-items'] })
          }}
        />
      ) : null}
      {canWrite && details ? (
        <CanonicalSheetLifecyclePanel
          instance={instance}
          onInstance={(next) =>
            queryClient.setQueryData(['sheet-instance', instance.id], next)
          }
        />
      ) : null}
    </>
  )
}

function CanonicalWorkspaceRecords() {
  const {
    canWrite,
    picker,
    search,
    projectId,
    setQuery,
    recordLabelsRef,
    link,
    setPicker,
    createOpen,
    modelKey,
    create,
    setCreateOpen,
    title,
    setTitle,
    fields,
    custom,
    setCustom,
  } = useCanonicalWorkspace()

  return (
    <>
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
            {t('notebook.canonicalSheetWorkspace.name')}
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
          <Button type="submit">
            {t('notebook.canonicalSheetWorkspace.createAndLink')}
          </Button>
        </form>
      ) : null}
    </>
  )
}

/**
 * NAV-02 — provenance line for the selected cell. Bound provenance resolves
 * to the canonical related object: Dataset provenance links to the Dataset
 * explorer, Record provenance to the owning Record — always via stable UUID
 * destinations from the canonical routes, never label-derived paths.
 */
/** Where an edit to the selected cell goes, for the Details view. */
function editWhere(input: {
  columnOrigin: 'bound' | 'local' | 'calculation'
  provenance: SheetProvenance
  canWrite: boolean
  editable: boolean
  nextRevision?: number
  sourceLabel?: string
}): string {
  if (input.columnOrigin === 'calculation')
    return t('notebook.sheetEditLine.calculation')

  if (!input.canWrite) return t('notebook.sheetEditLine.viewOnly')

  if (input.columnOrigin === 'local')
    return input.nextRevision === undefined
      ? t('notebook.sheetEditLine.localNext')
      : t('notebook.sheetEditLine.local', { revision: input.nextRevision })

  if (input.provenance?.kind !== 'present')
    return t('notebook.sheetEditLine.unmatched')

  if (input.provenance.provenance.sourceKind === 'record')
    return input.editable
      ? t('notebook.sheetEditLine.record')
      : t('notebook.sheetEditLine.recordReadOnly')

  const dataset = input.sourceLabel ?? t('notebook.sheetEditLine.theDataset')

  return input.editable
    ? t('notebook.sheetEditLine.dataset', { dataset })
    : t('notebook.sheetEditLine.datasetReadOnly', { dataset })
}

type SheetProvenance =
  | { kind: 'present'; provenance: BoundColumnProvenance }
  | { kind: 'unmatched'; provenance: unknown }
  | null

/**
 * The Details view's edit line: the selected cell, and where an edit to it is
 * written before anyone types. Bound cells link to their dataset or record.
 */
export function SheetProvenanceLine({
  columnLabel,
  columnOrigin,
  provenance,
  rowNumber,
  canWrite = true,
  editable = true,
  nextRevision,
  sourceLabel,
}: {
  columnLabel: string
  columnOrigin: 'bound' | 'local' | 'calculation'
  provenance: SheetProvenance
  /** 1-based row, as the grid numbers it. */
  rowNumber?: number
  canWrite?: boolean
  editable?: boolean
  /** The sheet revision an edit to a local column makes. */
  nextRevision?: number
  /** The dataset's name and revision, as the column's header band shows it. */
  sourceLabel?: string
}) {
  const source = provenance?.kind === 'present' ? provenance.provenance : null

  return (
    <p role="status" className="flex flex-wrap items-baseline gap-x-2">
      <span className="font-medium text-fg">
        {rowNumber === undefined
          ? columnLabel
          : t('notebook.sheetEditLine.cell', {
              row: rowNumber,
              column: columnLabel,
            })}
      </span>
      <span>
        {editWhere({
          columnOrigin,
          provenance,
          canWrite,
          editable,
          nextRevision,
          sourceLabel,
        })}
      </span>
      {source?.sourceKind === 'dataset' ? (
        <Link
          className="underline underline-offset-2 hover:text-fg"
          to="/datasets"
          // NAV-02 review fix: the link carries only the stable Dataset
          // ID. The explorer resolves the Dataset's lifecycle itself and
          // flips to the archived view — the link must not claim the
          // active-only filter for a Dataset it knows nothing about.
          search={{ dataset: source.sourceDatasetId }}
        >
          {t('notebook.sheetEditLine.openDataset')}
        </Link>
      ) : null}
      {source?.sourceKind === 'record' ? (
        <Link
          className="underline underline-offset-2 hover:text-fg"
          to="/records/$recordId"
          params={{ recordId: source.sourceRecordId }}
        >
          {t('notebook.sheetEditLine.openRecord')}
        </Link>
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
