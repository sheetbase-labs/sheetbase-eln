import { t } from '#/copy'
import {
  usePaneContext,
  usePaneReadOnly,
} from '#/components/workspace/workspace-navigation'
import * as React from 'react'
import { z } from 'zod'

import { QueryClientContext } from '@tanstack/react-query'

import { cn } from '#/lib/utils'
import type {
  NotebookBlock as NotebookBlockData,
  NotebookRecord,
} from '#/lib/notebook-data'
import type { ActionBlockContext } from '#/lib/notebook-action-blocks'
import { NotebookAiProvider } from './notebook-ai-context'
import { recordDestination } from '#/lib/navigation'
import {
  CALCULATOR_PICKER_TYPE,
  isEditableBlockType,
} from '#/lib/blocks/registry'
import {
  isEmptyRichText,
  isRichTextPayload,
  richTextToPlainText,
} from '#/lib/blocks'
import {
  joinProsePayloads,
  proseBackspaceAction,
  proseRunMembers,
} from '#/lib/notebook-prose-runs'
import { Button } from '#/components/ui/button'
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
import { EmptyState } from '#/components/ui/empty-state'
import {
  NotebookBlockHandle,
  NotebookBlockList,
  NotebookBlockRow,
} from './notebook-block-reorder'
import type { NotebookBlockState } from './notebook-block'
import { moveTargetIndex, neighboursForTarget } from './block-reorder-targets'
import { BlockPreview } from './block-preview'
import type { MakeSheetRequest } from './make-sheet-from-file'
import { BlockEditor } from './block-editor'
import type { AutosaveStatus, SaveResult } from './block-editor'
import { isCanonicalSheetBlock } from '#/lib/sheet-block'
import type { FrozenSheetEvidence } from '#/lib/sheet-evidence'
import type { SheetCellSelection } from '#/components/sheet/canonical-sheet-workspace'
import {
  collapsedSectionBlockIds,
  collapsedSectionNodeIndexes,
  notebookOutline,
  notebookSectionSpans,
  sectionHiddenCounts,
} from '#/lib/notebook-outline'
import { BenchCalculatorDialog } from '#/components/calculators/bench-calculator-dialog'
import type { CalculatorInsert } from '#/components/calculators/bench-calculator-dialog'
import { AddBlockControl, PLUGIN_BLOCK_PREFIX } from './add-block-menu'
import { NotebookSheetBlock } from './notebook-sheet-block'
import {
  NotebookSignedSection,
  NotebookViewerActions,
} from './notebook-viewer-actions'
import { ScientificWorkbookProvider } from './scientific-workbook-provider'
import { LiveBlockComments } from '#/components/notebook/live-block-comments'
import { GateDialog, useGates } from '#/components/notebook/gates'
import { hasCapability } from '#/lib/capability'
import { PresenceSync } from '#/components/collaboration/use-set-presence'
import { BlockCoEditBadge } from '#/components/collaboration/presence-co-editing'
import {
  useRegisterShortcuts,
  useShortcutScope,
} from '#/components/shortcuts/shortcut-provider'
import { notebookShortcuts } from '#/lib/shortcut-scopes'
import { holdTypeAhead } from '#/components/notebook/type-ahead-hold'

export type { AutosaveStatus, SaveResult } from './block-editor'

/**
 * The editable notebook document (ELN-005). Owns the per-block editing,
 * insertion, duplication and deletion UX on top of the read-only canvas
 * from ELN-004. The parent supplies async mutation callbacks that perform
 * the RPCs and invalidate the route's queries; this component owns:
 *
 * - draft vs committed state (transient editor state is never stored as
 *   scientific content — drafts live in BlockEditor's local state);
 * - per-block saving/error state, including stale_version surfacing;
 * - a keyboard-accessible block picker for insertion;
 * - duplicate and delete actions with confirmation and undo where safe;
 * - a stable selection target and URL anchor per block (#block-<id>) so
 *   comments and review can refer to a block later.
 *
 * `readOnly` disables all mutations (archived, signed and view-only
 * notebooks). A read-only notebook that is neither archived nor signed shows
 * the view-only actions — request edit access, copy selection, comment
 * (EXP-04.5); a signed one shows its signatures.
 */

export interface NotebookDocumentProps {
  record: NotebookRecord
  blocks: NotebookBlockData[]
  /**
   * Persist a validated payload for a block (ELN-007). Returns a structured
   * result so each editor's autosave state machine can branch on conflict /
   * validation / transient. The route reads the latest expected version and
   * the client identity is attached automatically by `createDataClient`.
   */
  onSaveBlock: (
    block: NotebookBlockData,
    payload: NotebookBlockData['payload'],
  ) => Promise<SaveResult<NotebookBlockData['payload']>>
  /** Live-event stream offline? Holds autosaves while true. */
  offline?: boolean
  /**
   * Notified whenever the document-level "unsaved work at risk" signal
   * changes (any block dirty / saving / retrying / offline / failed /
   * conflict). Callers wire `beforeunload` and router blockers to it.
   */
  onUnsavedWorkChange?: (hasUnsavedWork: boolean) => void
  /** Insert a new block of `type`, optionally after `afterBlockId`. */
  onInsertBlock: (
    type: string,
    afterBlockId?: string,
    options?: {
      datasetSchemaId?: string
      payload?: NotebookBlockData['payload']
    },
  ) => Promise<string | undefined>
  /** Pin a protocol to an empty protocol-reference block. */
  onPinProtocol?: (
    block: NotebookBlockData,
    protocolRecordId: string,
  ) => Promise<void>
  /** SCI-003: attach an uploaded file to an empty file block. */
  onAttachFile?: (block: NotebookBlockData, file: File) => Promise<void>
  /** Put a worksheet of an attached Excel file in the notebook as a sheet. */
  onMakeSheet?: (
    block: NotebookBlockData,
    request: MakeSheetRequest,
  ) => Promise<void>
  /** SCI-004: freeze a chart block into an immutable snapshot. */
  onFreezeChart?: (block: NotebookBlockData) => Promise<void>
  /** SCI-03: freeze an analysis block into immutable evidence. */
  onFreezeAnalysis?: (block: NotebookBlockData) => Promise<void>
  /** SCI-03: return a frozen analysis block to live state. */
  onUnfreezeAnalysis?: (block: NotebookBlockData) => Promise<void>
  /** SCI-004: remove the frozen snapshot so the chart can be edited again. */
  onUnfreezeChart?: (block: NotebookBlockData) => Promise<void>
  /** Duplicate an existing block (same type/payload, inserted after it). */
  onDuplicateBlock: (block: NotebookBlockData) => Promise<string | undefined>
  /** Delete a block. */
  onDeleteBlock: (block: NotebookBlockData) => Promise<void>
  /**
   * Re-insert a previously deleted block (undo) at its original position.
   * The server resolves the insert atomically against both neighbours, so
   * a resolved promise means the block is restored exactly where it was.
   * Resolves with the restored block id.
   */
  onUndoDelete?: (
    type: string,
    payload: NotebookBlockData['payload'],
    destination: {
      afterBlockId: string | null
      beforeBlockId: string | null
    },
  ) => Promise<{ id: string } | undefined>
  /**
   * Move a block to a new position described by its future neighbours
   * (ELN-006). Either neighbour may be null: (null, B) → start, (A, null)
   * → end, (A, B) → between A and B. Resolve on success, reject on error
   * (stale_version surfaces as a thrown DataClientError). Omit to render
   * movement affordances disabled/hidden (read-only callers).
   */
  onMoveBlock?: (
    block: NotebookBlockData,
    destination: {
      afterBlockId: string | null
      beforeBlockId: string | null
    },
  ) => Promise<void>
  /**
   * Replace `block` with a new block of `type` (slash command). Inserts the
   * new block and removes the old one atomically from the user's
   * perspective. Returns the new block's id so the caller can focus it.
   */
  onReplaceBlock?: (
    block: NotebookBlockData,
    type: string,
    options?: {
      datasetSchemaId?: string
      payload?: NotebookBlockData['payload']
    },
  ) => Promise<string | undefined>
  readOnly?: boolean
  /** A signed part is locked for everyone: no access request or comment bar applies. */
  partLocked?: boolean
  /** NOTE-02: anchors of currently collapsed sections (route presentation state). */
  collapsedSections?: ReadonlySet<string>
  /** NOTE-02: toggle a section's collapsed state. Absent on read-only canvases. */
  onToggleSection?: (anchorId: string) => void
  frozenSheetEvidence?: Map<string, FrozenSheetEvidence>
  /**
   * EXP-04.4: the selected cell of a live Sheet block, lifted out of the grid
   * so the surrounding inspector can describe it. Null when the sheet has no
   * selection (or its editor unmounted).
   */
  onCellSelectionChange?: (selection: SheetCellSelection | null) => void
  /**
   * COLLAB-02: active workspace id used to build block comment anchors;
   * omit to disable the affordance. Actual write access is enforced
   * server-side.
   */
  collaborationWorkspaceId?: string
  /** COLLAB-02: workspace role hint for the block comment composer. */
  collaborationRole?: string
  /**
   * R5-NOTE-02: the revision a sign-and-attach block is read against. Absent on
   * a live canvas, where the blocks read as "applies to the next submission".
   */
  actionBlockContext?: ActionBlockContext
  /** Block deep link from the owning router, without the leading #. */
  initialBlockHash?: string
  /** Replace the owning route's hash; an empty string clears the selection. */
  onBlockHashChange?: (hash: string) => void
  className?: string
}

export function NotebookDocument(props: NotebookDocumentProps) {
  return (
    <ScientificWorkbookProvider>
      <NotebookAiProvider
        value={{
          recordId: props.record.id,
          title: props.record.title,
          deepLink: recordDestination(props.record.kind, props.record.id),
          blocks: props.blocks,
        }}
      >
        <NotebookDocumentContent {...props} />
      </NotebookAiProvider>
    </ScientificWorkbookProvider>
  )
}

const NOTE02_EMPTY_COLLAPSED_SECTIONS: ReadonlySet<string> = new Set<string>()

/** Document-level selection, keyboard actions, mutations and unsaved-work lifetime. */
function useNotebookDocument({
  record,
  blocks,
  onSaveBlock,
  onUnsavedWorkChange,
  onInsertBlock,
  onDuplicateBlock,
  onDeleteBlock,
  onUndoDelete,
  onMoveBlock,
  onReplaceBlock,
  readOnly,
  partLocked = false,
  initialBlockHash = '',
  onBlockHashChange,
  /** NOTE-02 section collapse — presentation state only, route-owned. */
  collapsedSections,
  onToggleSection,
}: NotebookDocumentProps) {
  const documentRef = React.useRef<HTMLDivElement>(null)
  const enterAtEndPendingRef = React.useRef(false)
  const emptyStartRef = React.useRef<HTMLButtonElement>(null)
  const selectionHashRef = React.useRef<string | null>(null)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [activeId, setActiveId] = React.useState<string | null>(null)
  const [selectionBlocks, setSelectionBlocks] = React.useState(blocks)

  // Normalize canonical removal before children render. A newly inserted id
  // that has not appeared in canonical props yet remains selected until it does.
  if (selectionBlocks !== blocks) {
    setSelectionBlocks(blocks)

    if (
      selectedId &&
      selectionBlocks.some((block) => block.id === selectedId) &&
      !blocks.some((block) => block.id === selectedId)
    ) {
      setSelectedId(null)
      setActiveId(null)
    }
  }

  const committedSelectionRef = React.useRef<string | null>(null)

  /**
   * Where the caret should land when the next block's editor mounts. Arrow
   * keys that cross between two prose rows carry the caret with them — down
   * into the start of the row below, up into the end of the row above — so the
   * rows read as one text. A click clears it, because a click puts the caret
   * where the pointer is.
   */
  const [caretHint, setCaretHint] = React.useState<{
    blockId: string
    to: 'start' | 'end'
  } | null>(null)

  // Per-block error messages for insert / duplicate / delete (ELN-005).
  // Save errors are owned per-editor by `useAutosave` (ELN-007).
  const [errorById, setErrorById] = React.useState<Record<string, string>>({})

  const [confirmDelete, setConfirmDelete] =
    React.useState<NotebookBlockData | null>(null)

  const [pendingDelete, setPendingDelete] = React.useState(false)

  const [undo, setUndo] = React.useState<{
    type: string
    payload: NotebookBlockData['payload']
    afterBlockId: string | null
    beforeBlockId: string | null
    label: string
    /** What the banner says. Defaults to the delete copy. */
    message?: string
    /**
     * Set when the undo has to restore the row above as well, because a join
     * moved this row's content into it.
     */
    restorePayload?: { blockId: string; payload: NotebookBlockData['payload'] }
  } | null>(null)

  // --- Movement (ELN-006) -------------------------------------------------
  // `optimisticOrder` holds a temporary id ordering applied immediately on
  // a move so the UI feels instant; it is cleared on success (the canonical
  // blocks from the route's query cache then render) or restored to the
  // pre-move snapshot on rejection. `movingId` marks the block whose RPC is in
  // flight so its row can show a subtle pending state, and `draggingId` marks
  // the block a pointer, touch or keyboard drag is currently holding. The
  // list itself lives in `notebook-block-reorder.tsx` so the
  // component-comparison harness drives the same code this document ships.
  const [optimisticOrder, setOptimisticOrder] = React.useState<string[] | null>(
    null,
  )

  const [movingId, setMovingId] = React.useState<string | null>(null)
  const [draggingId, setDraggingId] = React.useState<string | null>(null)

  const [moveError, setMoveError] = React.useState<{
    blockId: string
    message: string
    stale: boolean
  } | null>(null)

  // --- Autosave status aggregation (ELN-007) ---------------------------
  // Each editable editor reports its autosave status; the document
  // aggregates a set of block ids whose status is not `clean` to drive the
  // navigation guard. Save errors and saving state are owned per-editor by
  // `useAutosave`, so the document no longer tracks `savingId`/`errorById`.
  const [unsavedBlockIds, setUnsavedBlockIds] = React.useState<Set<string>>(
    new Set(),
  )

  const statusByIdRef = React.useRef<Map<string, AutosaveStatus>>(new Map())

  const handleStatusChange = React.useCallback(
    (blockId: string, status: AutosaveStatus) => {
      const map = statusByIdRef.current

      if (status === 'clean') {
        map.delete(blockId)
      } else {
        map.set(blockId, status)
      }

      const next = new Set(map.keys())
      setUnsavedBlockIds((prev) => {
        if (prev.size === next.size && [...prev].every((id) => next.has(id))) {
          return prev
        }

        return next
      })
    },
    [],
  )

  const updateBlockHash = React.useCallback(
    (blockId: string | null) => {
      const hash = blockId ? `block-${blockId}` : ''
      selectionHashRef.current = hash
      onBlockHashChange?.(hash)
    },
    [onBlockHashChange],
  )

  // Editors with unsaved work remain mounted when the user moves to another
  // block, so a slow save, offline draft, validation failure, or conflict
  // cannot disappear merely because selection changed. Remove status only
  // after the canonical block itself is removed (delete/replace).
  React.useEffect(() => {
    const currentIds = new Set(blocks.map((block) => block.id))
    const map = statusByIdRef.current
    let changed = false

    for (const id of map.keys()) {
      if (!currentIds.has(id)) {
        map.delete(id)
        changed = true
      }
    }

    if (changed) setUnsavedBlockIds(new Set(map.keys()))

    const previousSelection = committedSelectionRef.current
    committedSelectionRef.current = selectedId

    // A remote canonical deletion has no event handler to update its route.
    // Notify only after the normalized selection commits, not during render.
    if (
      previousSelection &&
      selectedId === null &&
      !currentIds.has(previousSelection) &&
      selectionHashRef.current !== ''
    ) {
      // react-doctor-disable-next-line react-doctor/no-pass-data-to-parent -- Publish only committed canonical removal to this document's owning route; selection/drafts stay local and abandoned renders cannot clear the hash.
      updateBlockHash(null)
    }
  }, [blocks, selectedId, updateBlockHash])

  const hasUnsavedWork = unsavedBlockIds.size > 0
  React.useEffect(() => {
    // Publish only the committed navigation-guard signal; drafts/save/conflict lifetime remain editor-owned.
    // react-doctor-disable-next-line react-doctor/no-pass-data-to-parent, react-doctor/no-pass-live-state-to-parent, react-doctor/no-prop-callback-in-effect
    onUnsavedWorkChange?.(hasUnsavedWork)
  }, [hasUnsavedWork, onUnsavedWorkChange])

  // Warn before tab close only when unsaved work genuinely remains at risk
  // (ELN-007). We cannot reliably finish async saves during unload, so the
  // native browser prompt is the truthful signal.
  React.useEffect(() => {
    if (!hasUnsavedWork) return

    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }

    window.addEventListener('beforeunload', handler)

    return () => window.removeEventListener('beforeunload', handler)
  }, [hasUnsavedWork])

  // Follow the owning router's deep links, but do not scroll again when a
  // local selection is reflected back through that router.
  React.useEffect(() => {
    const hash = initialBlockHash
    const fromSelection = selectionHashRef.current === hash
    selectionHashRef.current = null

    if (fromSelection) return

    if (hash.startsWith('block-')) {
      const el = Array.from(
        documentRef.current?.querySelectorAll<HTMLElement>('[id^="block-"]') ??
          [],
      ).find((block) => block.id === hash)

      if (el) {
        el.scrollIntoView({ block: 'start' })
      }
    }
  }, [initialBlockHash])

  function selectBlock(block: NotebookBlockData) {
    setSelectedId(block.id)
    updateBlockHash(block.id)
  }

  const gates = useGates()

  // A gate needs something to wait on before it can exist, so the dialog comes first.
  const [gateTarget, setGateTarget] = React.useState<{
    afterBlockId?: string
    replace?: NotebookBlockData
  } | null>(null)

  async function handleGateInsert(draft: {
    label: string
    mode: 'warn' | 'block'
    conditions: unknown[]
  }) {
    const target = gateTarget

    if (!target) return

    const payload: NotebookBlockData['payload'] = {
      mode: draft.mode,
      conditions: draft.conditions,
    }

    if (draft.label.trim()) payload.label = draft.label.trim()

    try {
      const newId =
        target.replace && onReplaceBlock
          ? await onReplaceBlock(target.replace, 'gate', { payload })
          : await onInsertBlock('gate', target.afterBlockId, { payload })

      if (newId) selectAndFocus(newId)
      setUndo(null)
      setGateTarget(null)
    } catch (err) {
      setGateTarget(null)
      setErrorById((prev) => ({
        ...prev,
        __insert:
          err instanceof Error
            ? err.message
            : t('notebook.notebookDocument.couldNotInsertThe'),
      }))
    }
  }

  const [calculatorTarget, setCalculatorTarget] = React.useState<{
    afterBlockId?: string
    replace?: NotebookBlockData
  } | null>(null)

  /** The bench calculator's answer goes in as a measured value that keeps its workings. */
  async function handleCalculatorInsert(insert: CalculatorInsert) {
    const target = calculatorTarget

    if (!target) return
    const payload = { ...insert }

    if (target.replace && onReplaceBlock) {
      try {
        const newId = await onReplaceBlock(target.replace, 'metric', {
          payload,
        })

        if (newId) selectAndFocus(newId)
        setUndo(null)
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : t('notebook.notebookDocument.couldNotInsertThe')

        setErrorById((prev) => ({ ...prev, __insert: message }))
      }

      return
    }

    await handleInsert('metric', target.afterBlockId, { payload })
  }

  async function handleInsert(
    type: string,
    afterBlockId?: string,
    options?: { payload?: NotebookBlockData['payload'] },
  ) {
    if (type === CALCULATOR_PICKER_TYPE) {
      setCalculatorTarget({ afterBlockId })

      return undefined
    }

    if (type === 'gate') {
      setGateTarget({ afterBlockId })

      return undefined
    }

    if (type.startsWith(PLUGIN_BLOCK_PREFIX)) {
      const [plugin, block] = type.slice(PLUGIN_BLOCK_PREFIX.length).split('/')

      return handleInsert('plugin', afterBlockId, {
        payload: { plugin, block },
      })
    }

    try {
      const newId = options
        ? await onInsertBlock(type, afterBlockId, options)
        : await onInsertBlock(type, afterBlockId)

      if (newId) selectAndFocus(newId)
      setUndo(null)

      return newId
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : t('notebook.notebookDocument.couldNotInsertThe')

      setErrorById((prev) => ({ ...prev, __insert: message }))

      return undefined
    }
  }

  async function handleDuplicate(block: NotebookBlockData) {
    try {
      const duplicateId = await onDuplicateBlock(block)

      if (duplicateId) selectAndFocus(duplicateId)
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : t('notebook.notebookDocument.couldNotDuplicateThe')

      setErrorById((prev) => ({ ...prev, [block.id]: message }))
    }
  }

  async function handleConfirmDelete() {
    if (!confirmDelete) return
    const index = orderedIds.indexOf(confirmDelete.id)
    const afterBlockId = index > 0 ? (orderedIds[index - 1] ?? null) : null

    const beforeBlockId =
      index >= 0 && index < orderedIds.length - 1
        ? (orderedIds[index + 1] ?? null)
        : null

    const focusAfterDelete = beforeBlockId ?? afterBlockId
    setPendingDelete(true)

    try {
      await onDeleteBlock(confirmDelete)
      setUndo({
        type: confirmDelete.type,
        payload: confirmDelete.payload,
        afterBlockId,
        beforeBlockId,
        label: t('notebook.notebookDocument.blockNamed', {
          label: confirmDelete.type,
        }),
      })
      setConfirmDelete(null)

      if (focusAfterDelete) {
        selectAndFocus(focusAfterDelete)
      } else {
        setSelectedId(null)
        setActiveId(null)
        updateBlockHash(null)
        focusEmptyNotebook()
      }
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : t('notebook.notebookDocument.couldNotDeleteThe')

      setErrorById((prev) => ({ ...prev, [confirmDelete.id]: message }))
    } finally {
      setPendingDelete(false)
    }
  }

  async function handleUndo() {
    if (!undo || !onUndoDelete) return

    try {
      // A join moved the row below into the row above, so undoing it has to
      // put both rows back: the row's own content first, then the row itself.
      if (undo.restorePayload) {
        const target = blockById.get(undo.restorePayload.blockId)

        if (target) {
          const restored = await onSaveBlock(
            target,
            undo.restorePayload.payload,
          )

          if (!restored.ok) {
            setUndo(null)

            return
          }
        }
      }

      const result = await onUndoDelete(undo.type, undo.payload, {
        afterBlockId: undo.afterBlockId,
        beforeBlockId: undo.beforeBlockId,
      })

      if (!result) {
        setUndo(null)

        return
      }

      setUndo(null)
      selectAndFocus(result.id)
    } catch {
      // The insert itself failed; nothing was restored.
      setUndo(null)
    }
  }

  // Only the primary pane of a workspace edits; the others read.
  const paneReadOnly = usePaneReadOnly()
  const { makePrimary, editingPane } = usePaneContext()
  const isReadOnly = readOnly || paneReadOnly || record.archivedAt !== null
  // EXP-04.5: a signed (locked) record shows its signatures inline, and a
  // view-only reader gets the actions they still have. Archived records are
  // neither: they are read-only for everyone and no access request applies.
  const isSigned = record.lockedAt !== null

  const viewerActions =
    isReadOnly && record.archivedAt === null && !isSigned && !partLocked

  // A signed section only reads where a query client exists — presentational
  // and pre-hydration renders must not open a connection.
  const hasQueryClient = React.useContext(QueryClientContext) !== undefined

  // Cell operations belong to SheetKeyboardShortcuts, not block navigation.
  const committedInsert = React.useRef(handleInsert)
  React.useLayoutEffect(() => {
    committedInsert.current = handleInsert
  })
  useShortcutScope('notebook')
  useRegisterShortcuts(
    React.useMemo(() => {
      const selectedBlock = () =>
        (documentRef.current?.contains(document.activeElement)
          ? document.activeElement?.closest('[id^="block-"]')
          : null) ??
        (selectedId
          ? documentRef.current?.querySelector(`[id="block-${selectedId}"]`)
          : null)

      const commentButton = () =>
        selectedBlock()?.querySelector<HTMLButtonElement>(
          '[data-sheet-comment-selection]:not(:disabled)',
        ) ??
        selectedBlock()?.querySelector<HTMLButtonElement>(
          '[aria-label^="Comments on block"]:not(:disabled)',
        )

      return notebookShortcuts({
        insertBlock: !isReadOnly
          ? () => {
              void committedInsert.current('rich_text', selectedId ?? undefined)
            }
          : undefined,
        commentSelection: () => commentButton()?.click(),
      }).map((definition) => ({
        ...definition,
        when: (event: KeyboardEvent) =>
          definition.id === 'notebook-comment-selection'
            ? Boolean(commentButton())
            : !(
                event.target instanceof HTMLElement &&
                event.target.closest('[role="grid"]')
              ),
      }))
    }, [isReadOnly, selectedId]),
  )

  // --- Sections (NOTE-02) -------------------------------------------------
  // The outline is a projection of rich_text heading nodes; collapse is
  // presentation state owned by the route and never persisted. Collapsed
  // content is removed from view but printed (print:contents), so printed
  // and exported structure is always complete.
  const sectionCollapsed = collapsedSections ?? NOTE02_EMPTY_COLLAPSED_SECTIONS
  const outlineEntries = React.useMemo(() => notebookOutline(blocks), [blocks])

  const sectionSpans = React.useMemo(
    () => notebookSectionSpans(blocks),
    [blocks],
  )

  const hiddenBlockIds = React.useMemo(
    () => collapsedSectionBlockIds(sectionSpans, sectionCollapsed),
    [sectionSpans, sectionCollapsed],
  )

  // NOTE-02 same-block collapse: nodes inside a collapsed section's own
  // rich_text block are hidden at the node level (read preview skips them
  // with a print-restoring class; the active Tiptap editor hides the
  // matching ProseMirror nodes via node decorations). Still presentation
  // state — nothing here touches the persisted payload.
  const hiddenNodeIndexesByBlockId = React.useMemo(
    () => collapsedSectionNodeIndexes(sectionSpans, sectionCollapsed),
    [sectionSpans, sectionCollapsed],
  )

  const hiddenCounts = React.useMemo(
    () => sectionHiddenCounts(sectionSpans, sectionCollapsed),
    [sectionSpans, sectionCollapsed],
  )

  const collapsedAnchorByBlockId = React.useMemo(() => {
    const map = new Map<string, string>()

    if (!onToggleSection) return map

    const byAnchor = new Map(
      outlineEntries.map((entry) => [entry.anchorId, entry]),
    )

    for (const anchor of sectionCollapsed) {
      const entry = byAnchor.get(anchor)

      if (entry) map.set(entry.blockId, anchor)
    }

    return map
  }, [onToggleSection, outlineEntries, sectionCollapsed])

  // --- Movement (ELN-006) -------------------------------------------------
  // The effective ordered list is the canonical `blocks` unless an
  // optimistic move is in flight, in which case `optimisticOrder` overrides
  // the ordering (the block objects are still looked up from `blocks`).
  const orderedIds = React.useMemo(() => {
    if (!optimisticOrder) return blocks.map((b) => b.id)

    return optimisticOrder
  }, [blocks, optimisticOrder])

  const blockById = React.useMemo(() => {
    const map = new Map<string, NotebookBlockData>()

    for (const b of blocks) map.set(b.id, b)

    return map
  }, [blocks])

  const canMove = !isReadOnly && !!onMoveBlock && blocks.length > 1

  /**
   * The Alt+arrow path and the block menu's Move up/down, which are the same
   * call: one position, through the same optimistic writer a drop uses.
   */
  function moveByOne(block: NotebookBlockData, direction: 'up' | 'down') {
    if (!canMove) return
    const target = moveTargetIndex(orderedIds, block.id, direction)

    if (target === null) return
    void performMove(block, target)
  }

  /**
   * Prose-run membership by block id. Rows inside a multi-row run render
   * continuously, so the writing reads as one document rather than as a stack
   * of framed boxes. Derived from the effective ordering so an in-flight move
   * cannot momentarily split a run.
   */
  const proseRuns = React.useMemo(
    () =>
      proseRunMembers(
        orderedIds.map((id) => ({
          id,
          type: blockById.get(id)?.type ?? '',
        })),
      ),
    [orderedIds, blockById],
  )

  function focusBlockAnchor(blockId: string) {
    // Defer so the reordered DOM has committed before we focus.
    requestAnimationFrame(() => {
      const el = documentRef.current?.querySelector<HTMLElement>(
        `[id="block-${blockId}"]`,
      )

      if (!el) return

      if (el.contains(document.activeElement)) {
        el.scrollIntoView({ block: 'nearest' })

        return
      }

      el.focus()
    })
  }

  function focusEmptyNotebook() {
    requestAnimationFrame(() => {
      emptyStartRef.current?.focus()
    })
  }

  /**
   * Optimistically reorder and persist a move. The optimistic ordering is
   * applied immediately, the RPC is fired, and on rejection the exact
   * pre-move order is restored and a contextual error is shown. Selection
   * and focus stay on the moved block in both outcomes.
   */
  async function performMove(block: NotebookBlockData, targetIndex: number) {
    if (!onMoveBlock) return
    const baseline = orderedIds
    const destination = neighboursForTarget(baseline, block.id, targetIndex)
    // No-op: same neighbours as the current position.
    const currentIdx = baseline.indexOf(block.id)

    if (
      currentIdx >= 0 &&
      destination.afterBlockId ===
        (currentIdx > 0 ? (baseline[currentIdx - 1] ?? null) : null) &&
      destination.beforeBlockId ===
        (currentIdx < baseline.length - 1
          ? (baseline[currentIdx + 1] ?? null)
          : null)
    ) {
      return
    }

    // Build the optimistic ordering by removing the block and inserting it
    // at the target index within the remaining list.
    const without = baseline.filter((id) => id !== block.id)
    const clamped = Math.max(0, Math.min(targetIndex, without.length))
    const nextOrder = [...without]
    nextOrder.splice(clamped, 0, block.id)
    setOptimisticOrder(nextOrder)
    setMovingId(block.id)
    setMoveError(null)

    try {
      await onMoveBlock(block, destination)
      // Success: clear the optimistic override; the route's query cache now
      // holds the canonical order returned by the RPC.
      setOptimisticOrder(null)
    } catch (err) {
      // Remove the optimistic override so the route's structure refetch can
      // become visible. Until that refetch settles, the canonical props are
      // still the exact pre-move order.
      setOptimisticOrder(null)

      const stale =
        err instanceof Error && /stale|version|changed/i.test(err.message)

      const message = stale
        ? t('notebook.notebookDocument.theNotebookChangedElsewhere')
        : err instanceof Error
          ? err.message
          : t('notebook.notebookDocument.couldNotMoveThe')

      setMoveError({ blockId: block.id, message, stale })
    } finally {
      setMovingId(null)
      // Keep selection on the moved block and refocus its anchor so keyboard
      // users do not lose their place after a move or a rollback.
      setSelectedId(block.id)
      focusBlockAnchor(block.id)
    }
  }

  // --- Notion-like keyboard & slash command handlers ----------------------

  /**
   * Focus a block's anchor element and select it. Deferred via rAF so the
   * DOM has settled after reorders/inserts before we focus.
   */
  function selectAndFocus(blockId: string) {
    setSelectedId(blockId)
    setActiveId(blockId)
    updateBlockHash(blockId)
    requestAnimationFrame(() => {
      const el = documentRef.current?.querySelector<HTMLElement>(
        `[id="block-${blockId}"]`,
      )

      el?.focus()
    })
  }

  /** Slash command: replace the current empty text block with a new type. */
  async function handleSlashCommand(block: NotebookBlockData, type: string) {
    if (type === 'rich_text') return // handled in the editor itself

    if (type === CALCULATOR_PICKER_TYPE) {
      setCalculatorTarget({ afterBlockId: block.id, replace: block })

      return
    }

    if (type === 'gate') {
      setGateTarget({ afterBlockId: block.id, replace: block })

      return
    }

    let kind = type
    let options: { payload: NotebookBlockData['payload'] } | undefined

    if (type.startsWith(PLUGIN_BLOCK_PREFIX)) {
      const [plugin, pluginBlock] = type
        .slice(PLUGIN_BLOCK_PREFIX.length)
        .split('/')

      kind = 'plugin'
      options = { payload: { plugin, block: pluginBlock } }
    }

    try {
      const newId = onReplaceBlock
        ? options
          ? await onReplaceBlock(block, kind, options)
          : await onReplaceBlock(block, kind)
        : options
          ? await onInsertBlock(kind, block.id, options)
          : await onInsertBlock(kind, block.id)

      if (newId) selectAndFocus(newId)
      setUndo(null)
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : t('notebook.notebookDocument.couldNotInsertThe')

      setErrorById((prev) => ({ ...prev, __insert: message }))
    }
  }

  /** Enter at end of a text block → create a new empty text block below. */
  async function handleEnterAtEnd(block: NotebookBlockData) {
    // A second Enter while the first is still being answered must not make a
    // second block.
    if (enterAtEndPendingRef.current) return
    enterAtEndPendingRef.current = true

    const root = documentRef.current
    const hold = root ? holdTypeAhead(root) : null
    let newId: string | undefined

    try {
      newId = await onInsertBlock('rich_text', block.id)

      if (newId) selectAndFocus(newId)
      setUndo(null)
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : t('notebook.notebookDocument.couldNotCreateA')

      setErrorById((prev) => ({ ...prev, [block.id]: message }))
    } finally {
      enterAtEndPendingRef.current = false

      // What was typed while the block was being made goes into it.
      void hold?.release(
        newId
          ? () =>
              documentRef.current?.querySelector<HTMLElement>(
                `[id="block-${newId}"]`,
              ) ?? null
          : null,
      )
    }
  }

  /**
   * Backspace at the start of a block.
   *
   * Inside a prose run this is a join, not a delete: the rows are one document
   * as far as the author is concerned, so Backspace at the start of a paragraph
   * pulls it up into the row above and the row boundary disappears. Rows the
   * server will not accept are never deleted — the join is saved first, and a
   * failed save leaves the row exactly where it was.
   *
   * Outside a prose run, or when the row brings nothing with it (it is empty),
   * the previous behaviour stands: delete the block and focus its neighbour.
   */
  async function handleBackspaceAtStart(block: NotebookBlockData) {
    const idx = orderedIds.indexOf(block.id)
    const prevId = idx > 0 ? orderedIds[idx - 1] : null

    const nextId =
      idx >= 0 && idx < orderedIds.length - 1 ? orderedIds[idx + 1] : null

    const previous = prevId ? blockById.get(prevId) : null

    const currentIsEmpty =
      block.type === 'rich_text' &&
      isRichTextPayload(block.payload) &&
      richTextToPlainText(block.payload).trim() === ''

    const joined =
      previous && !currentIsEmpty
        ? joinProsePayloads(previous.payload, block.payload)
        : null

    const action = proseBackspaceAction({ currentIsEmpty, joined })

    if (action === 'join' && previous && joined) {
      const previousPayload = previous.payload
      let saved = false

      try {
        saved = (await onSaveBlock(previous, joined)).ok
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : t('notebook.notebookDocument.couldNotJoinThe')

        setErrorById((prev) => ({ ...prev, [block.id]: message }))

        return
      }

      if (!saved) {
        // The row above did not take the text, so the row below stays exactly
        // where it is. Deleting it here would lose the paragraph it carries.
        setErrorById((prev) => ({
          ...prev,
          [previous.id]: t('notebook.notebookDocument.couldNotJoinThe2'),
        }))

        return
      }

      try {
        await onDeleteBlock(block)
      } catch (err) {
        // The text is already in the row above, so the row below must not be
        // left behind: it would duplicate the paragraph. Say so rather than
        // silently leaving both.
        const message =
          err instanceof Error
            ? err.message
            : t('notebook.notebookDocument.theParagraphsWereJoined')

        setErrorById((prev) => ({ ...prev, [block.id]: message }))
        selectAndFocus(previous.id)

        return
      }

      setUndo({
        type: block.type,
        payload: block.payload,
        afterBlockId: prevId,
        beforeBlockId: nextId,
        label: t('notebook.notebookDocument.blockNamed', { label: block.type }),
        message: t('notebook.notebookDocument.message'),
        restorePayload: { blockId: previous.id, payload: previousPayload },
      })
      selectAndFocus(previous.id)

      return
    }

    if (action === 'none') {
      // A row with content and nothing to join into is left exactly as it is:
      // the key does nothing, as it did before joins existed.
      return
    }

    const focusAfterDelete = prevId ?? nextId

    try {
      await onDeleteBlock(block)
      setUndo({
        type: block.type,
        payload: block.payload,
        afterBlockId: prevId,
        beforeBlockId: nextId,
        label: t('notebook.notebookDocument.blockNamed', { label: block.type }),
      })

      if (focusAfterDelete) {
        selectAndFocus(focusAfterDelete)
      } else {
        setSelectedId(null)
        setActiveId(null)
        updateBlockHash(null)
        focusEmptyNotebook()
      }
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : t('notebook.notebookDocument.couldNotDeleteThe')

      setErrorById((prev) => ({ ...prev, [block.id]: message }))
    }
  }

  /** ArrowUp at start of first paragraph → the caret continues in the row above. */
  function handleArrowUpFromStart(block: NotebookBlockData) {
    const idx = orderedIds.indexOf(block.id)

    if (idx <= 0) return
    const target = orderedIds[idx - 1]
    setCaretHint({ blockId: target, to: 'end' })
    selectAndFocus(target)
  }

  /** ArrowDown at end of last paragraph → the caret continues in the row below. */
  function handleArrowDownFromEnd(block: NotebookBlockData) {
    const idx = orderedIds.indexOf(block.id)

    if (idx < 0 || idx >= orderedIds.length - 1) return
    const target = orderedIds[idx + 1]
    setCaretHint({ blockId: target, to: 'start' })
    selectAndFocus(target)
  }

  function handleRowKeyDown(
    e: React.KeyboardEvent<HTMLDivElement>,
    block: NotebookBlockData,
  ) {
    const idx = orderedIds.indexOf(block.id)

    if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowUp') {
      e.preventDefault()
      const previousId = idx > 0 ? orderedIds[idx - 1] : null

      if (previousId) selectAndFocus(previousId)

      return
    }

    if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowDown') {
      e.preventDefault()
      const nextId = idx >= 0 ? orderedIds[idx + 1] : null

      if (nextId) selectAndFocus(nextId)

      return
    }

    if (e.altKey && e.key === 'Enter' && !isReadOnly) {
      e.preventDefault()
      void handleInsert('rich_text', block.id)

      return
    }

    if (
      (e.ctrlKey || e.metaKey) &&
      e.key === 'Backspace' &&
      e.target === e.currentTarget &&
      !isReadOnly
    ) {
      e.preventDefault()
      setConfirmDelete(block)

      return
    }

    if (!canMove) return

    // Alt+Arrow moves the focused block up/down by one position. The row is
    // focusable (tabIndex 0 below) so keyboard users can reorder without a
    // pointer. The menu items below provide the same moves for users who
    // prefer a discoverable affordance, and the grip handle carries the
    // sortable item's own lift-and-move keyboard sensor.
    if (e.altKey && e.key === 'ArrowUp') {
      e.preventDefault()
      moveByOne(block, 'up')
    } else if (e.altKey && e.key === 'ArrowDown') {
      e.preventDefault()
      moveByOne(block, 'down')
    }
  }

  return {
    documentRef,
    emptyStartRef,
    selectedId,
    activeId,
    setActiveId,
    selectBlock,
    caretHint,
    setCaretHint,
    unsavedBlockIds,
    handleStatusChange,
    viewerActions,
    paneReadOnly,
    editingPane,
    makePrimary,
    hasQueryClient,
    isReadOnly,
    isSigned,
    orderedIds,
    blockById,
    proseRuns,
    gates,
    canMove,
    draggingId,
    setDraggingId,
    movingId,
    moveError,
    setMoveError,
    performMove,
    moveByOne,
    hiddenBlockIds,
    hiddenNodeIndexesByBlockId,
    collapsedAnchorByBlockId,
    hiddenCounts,
    errorById,
    undo,
    handleInsert,
    handleDuplicate,
    handleUndo,
    handleRowKeyDown,
    handleSlashCommand,
    handleEnterAtEnd,
    handleBackspaceAtStart,
    handleArrowUpFromStart,
    handleArrowDownFromEnd,
    gateTarget,
    setGateTarget,
    handleGateInsert,
    calculatorTarget,
    setCalculatorTarget,
    handleCalculatorInsert,
    confirmDelete,
    setConfirmDelete,
    pendingDelete,
    handleConfirmDelete,
  }
}

function NotebookDocumentContent(props: NotebookDocumentProps) {
  const { record, readOnly, collaborationWorkspaceId, className } = props
  const notebook = useNotebookDocument(props)

  const {
    documentRef,
    emptyStartRef,
    selectedId,
    viewerActions,
    paneReadOnly,
    editingPane,
    makePrimary,
    hasQueryClient,
    isReadOnly,
    orderedIds,
    blockById,
    setDraggingId,
    setMoveError,
    performMove,
    handleInsert,
  } = notebook

  return (
    <div ref={documentRef} className={cn('pt-2', className)}>
      {/* COLLAB-01: broadcast which block I am editing. Awareness only —
          this never gates or locks editing for anyone. PresenceSync is
          null until the enclosing CollaborationRoom has mounted. */}
      <PresenceSync
        activeBlockId={selectedId}
        mode={selectedId ? 'editing' : 'viewing'}
      />
      {viewerActions ? (
        <NotebookViewerActions
          referenceCopy={paneReadOnly && !readOnly}
          editingPane={editingPane}
          onEditHere={makePrimary}
          projectId={record.projectId}
          commentEnabled={hasQueryClient && Boolean(collaborationWorkspaceId)}
          selectedBlockId={selectedId}
          documentRef={documentRef}
        />
      ) : null}
      {orderedIds.length === 0 && !isReadOnly ? (
        <EmptyState
          className="mx-auto my-8 w-full max-w-3xl items-center rounded-lg border border-dashed bg-surface-muted/20 px-6 text-center"
          title={t('notebook.notebookDocument.title')}
          description={t('notebook.notebookDocument.description')}
          action={
            <>
              <Button
                ref={emptyStartRef}
                type="button"
                variant="primary"
                onClick={() => void handleInsert('rich_text')}
              >
                {t('notebook.notebookDocument.startWriting')}
              </Button>
              <AddBlockControl
                onInsert={(type) => void handleInsert(type)}
                label={t('notebook.notebookDocument.label')}
                className="sm:w-44"
              />
            </>
          }
        />
      ) : null}
      <NotebookBlockList
        ids={orderedIds}
        onMove={(blockId, targetIndex) => {
          const block = blockById.get(blockId)

          if (block) void performMove(block, targetIndex)
        }}
        onDraggingChange={(draggedId) => {
          setDraggingId(draggedId)

          // A new drag supersedes any move error still on screen.
          if (draggedId) setMoveError(null)
        }}
      >
        {orderedIds.map((id, index) => (
          <NotebookDocumentBlockRow
            key={id}
            id={id}
            index={index}
            notebook={notebook}
            options={props}
          />
        ))}
      </NotebookBlockList>
      <NotebookDocumentFooter notebook={notebook} options={props} />
    </div>
  )
}

function NotebookDocumentFooter({
  notebook,
  options,
}: {
  notebook: ReturnType<typeof useNotebookDocument>
  options: NotebookDocumentProps
}) {
  const { record, onUndoDelete } = options

  const {
    isReadOnly,
    isSigned,
    hasQueryClient,
    orderedIds,
    blockById,
    errorById,
    undo,
    handleInsert,
    handleUndo,
  } = notebook

  return (
    <>
      {errorById.__insert ? (
        <p role="alert" className="text-xs text-danger-text">
          {errorById.__insert}
        </p>
      ) : null}

      {!isReadOnly &&
      orderedIds.length > 0 &&
      blockById.get(orderedIds[orderedIds.length - 1] ?? '')?.type !==
        'rich_text' ? (
        // A notebook ending on evidence still offers an empty paragraph below it.
        <div data-print-hide>
          <Button
            variant="quiet"
            icon="plus"
            onClick={() =>
              void handleInsert('rich_text', orderedIds[orderedIds.length - 1])
            }
          >
            {t('notebook.notebookDocument.addTextBelow')}
          </Button>
        </div>
      ) : null}
      {!isReadOnly && orderedIds.length === 1 ? (
        <p className="text-xs text-fg-muted" data-print-hide>
          {t('notebook.notebookDocument.typeInEmptyText')}
        </p>
      ) : null}
      {undo ? (
        <div
          role="status"
          className="flex items-center gap-3 rounded-md border bg-surface-muted/40 px-3 py-2 text-xs"
        >
          <span>
            {undo.message ?? t('notebook.notebookDocument.blockDeleted')}
          </span>
          {onUndoDelete ? (
            <button
              type="button"
              onClick={() => void handleUndo()}
              className="font-medium text-primary-text underline"
            >
              {t('notebook.notebookDocument.undo')}
            </button>
          ) : null}
        </div>
      ) : null}
      {isSigned && hasQueryClient ? (
        <NotebookSignedSection recordId={record.id} />
      ) : null}
      <NotebookDocumentDialogs notebook={notebook} />
    </>
  )
}

function NotebookDocumentDialogs({
  notebook,
}: {
  notebook: ReturnType<typeof useNotebookDocument>
}) {
  const {
    gateTarget,
    gates,
    blockById,
    handleGateInsert,
    setGateTarget,
    calculatorTarget,
    setCalculatorTarget,
    handleCalculatorInsert,
    confirmDelete,
    setConfirmDelete,
    unsavedBlockIds,
    pendingDelete,
    handleConfirmDelete,
  } = notebook

  return (
    <>
      {gateTarget && gates ? (
        <GateDialog
          targets={gates.targetsFor(
            gateTarget.afterBlockId
              ? (blockById.get(gateTarget.afterBlockId)?.order ?? 0) + 0.5
              : undefined,
          )}
          onSave={(draft) => handleGateInsert(draft)}
          onClose={() => setGateTarget(null)}
        />
      ) : null}
      {calculatorTarget ? (
        <BenchCalculatorDialog
          open
          onOpenChange={(open) => {
            if (!open) setCalculatorTarget(null)
          }}
          onInsert={(insert) => void handleCalculatorInsert(insert)}
        />
      ) : null}
      <ConfirmDialog
        open={confirmDelete !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(null)
        }}
      >
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>
              {t('notebook.notebookDocument.deleteThisBlock')}
            </ConfirmDialogTitle>
            <ConfirmDialogDescription>
              {confirmDelete && unsavedBlockIds.has(confirmDelete.id)
                ? t('notebook.notebookDocument.thisBlockHasEdits')
                : confirmDelete &&
                    confirmDelete.type === 'sheet' &&
                    isCanonicalSheetBlock(confirmDelete.payload)
                  ? t('notebook.notebookDocument.theBlockWillBe')
                  : t('notebook.notebookDocument.theBlockWillBe2')}
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <ConfirmDialogFooter>
            <ConfirmDialogCancel disabled={pendingDelete}>
              {t('common.actions.cancel')}
            </ConfirmDialogCancel>
            <ConfirmDialogAction
              onClick={() => void handleConfirmDelete()}
              disabled={pendingDelete}
            >
              {pendingDelete
                ? t('notebook.notebookDocument.deleting')
                : t('common.actions.delete')}
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
    </>
  )
}

/** One stable block row, including its draft-preserving editor and section affordances. */
function NotebookDocumentBlockRow({
  id,
  index,
  notebook,
  options,
}: {
  id: string
  index: number
  notebook: ReturnType<typeof useNotebookDocument>
  options: NotebookDocumentProps
}) {
  const {
    selectedId,
    activeId,
    isReadOnly,
    orderedIds,
    blockById,
    proseRuns,
    canMove,
    draggingId,
    moveByOne,
    handleInsert,
    handleDuplicate,
    setConfirmDelete,
  } = notebook

  const block = blockById.get(id)

  if (!block) return null
  const editable = isEditableBlockType(block.type) && !isReadOnly
  const isSelected = selectedId === block.id
  const editingSelection = editable && isSelected
  const title = z.string().catch('').parse(block.payload.title)

  const isActive = activeId === block.id
  const isDragging = draggingId === block.id

  let blockState: NotebookBlockState = 'default'

  if (isReadOnly) blockState = 'read-only'
  else if (isDragging) blockState = 'dragging'
  else if (editingSelection && isActive) blockState = 'editing'
  else if (isSelected) blockState = 'selected'

  const proseRun = proseRuns[block.id]

  return (
    <React.Fragment key={block.id}>
      <NotebookBlockRow
        itemId={block.id}
        enabled={canMove}
        handle={canMove ? <NotebookBlockHandle /> : undefined}
        row={notebookBlockRowAttributes(block, notebook)}
        frame={{
          label: blockLabel(block),
          continuous: !!proseRun,
          // A sheet is a card with its own toolbar along its top edge, so
          // the row's tools sit in the left gutter under the grip.
          toolbarInGutter: block.type === 'sheet',
          title:
            // Display only: editable payload fields belong to the
            // block's single autosave/conflict state machine below.
            // Chart and plate_map render their own payload.title
            // internally (ChartFrame header, plate map caption).
            // Suppress the wrapper title to avoid duplication.
            block.type !== 'chart' && block.type !== 'plate_map' && title.trim()
              ? title
              : undefined,
          state: blockState,
          ariaLabel: t('notebook.notebookDocument.blockNamed', {
            label: block.type,
          }),
          actions: (
            <NotebookDocumentBlockDiscussion
              blockId={block.id}
              active={editingSelection}
              notebook={notebook}
              options={options}
            />
          ),
          menuItems: isReadOnly
            ? undefined
            : [
                {
                  id: 'insert-below',
                  label: t('notebook.notebookDocument.insertTextBelowLabel'),
                  onSelect: () => void handleInsert('rich_text', block.id),
                  separatorAfter: true,
                  movesSelection: true,
                },
                ...(canMove
                  ? [
                      {
                        id: 'move-up',
                        label: t('notebook.notebookDocument.moveUpLabel'),
                        onSelect: () => moveByOne(block, 'up'),
                        disabled: index === 0,
                      },
                      {
                        id: 'move-down',
                        label: t('notebook.notebookDocument.moveDownLabel'),
                        onSelect: () => moveByOne(block, 'down'),
                        disabled: index === orderedIds.length - 1,
                        separatorAfter: true,
                      },
                    ]
                  : []),
                {
                  id: 'duplicate',
                  label: t('common.actions.duplicate'),
                  onSelect: () => handleDuplicate(block),
                  movesSelection: true,
                },
                {
                  id: 'delete',
                  label: t('common.actions.delete'),
                  onSelect: () => setConfirmDelete(block),
                  separatorAfter: true,
                },
              ],
        }}
      >
        <NotebookDocumentBlockBody
          block={block}
          notebook={notebook}
          options={options}
        />
      </NotebookBlockRow>
      <NotebookDocumentBlockTail
        block={block}
        notebook={notebook}
        onToggleSection={options.onToggleSection}
      />
    </React.Fragment>
  )
}

function NotebookDocumentBlockDiscussion({
  blockId,
  active,
  notebook,
  options,
}: {
  blockId: string
  active: boolean
  notebook: ReturnType<typeof useNotebookDocument>
  options: NotebookDocumentProps
}) {
  const {
    record,
    collaborationWorkspaceId,
    collaborationRole = 'viewer',
  } = options

  return (
    <>
      <BlockCoEditBadge blockId={blockId} active={active} />
      {notebook.hasQueryClient && collaborationWorkspaceId ? (
        // Ordinary comment rows work with or without a live room.
        <LiveBlockComments
          workspaceId={collaborationWorkspaceId}
          recordId={record.id}
          blockId={blockId}
          canComment={
            !record.archivedAt &&
            hasCapability(collaborationRole, 'record.create')
          }
        />
      ) : undefined}
    </>
  )
}

/** Insert seams and collapsed-section summaries never own the editable payload. */
function NotebookDocumentBlockTail({
  block,
  notebook,
  onToggleSection,
}: {
  block: NotebookBlockData
  notebook: ReturnType<typeof useNotebookDocument>
  onToggleSection: NotebookDocumentProps['onToggleSection']
}) {
  const {
    isReadOnly,
    moveError,
    proseRuns,
    hiddenBlockIds,
    collapsedAnchorByBlockId,
    hiddenCounts,
    handleInsert,
  } = notebook

  const proseRun = proseRuns[block.id]
  const collapsedHere = collapsedAnchorByBlockId.get(block.id)
  const isHiddenSection = hiddenBlockIds.has(block.id)
  const insideProseRun = Boolean(proseRun && !proseRun.isLast)

  return (
    <>
      {moveError && moveError.blockId === block.id ? (
        <p
          role="alert"
          className="mt-1 px-1 text-xs text-danger-text"
          data-move-error={moveError.stale ? 'stale' : 'generic'}
        >
          {moveError.message}
        </p>
      ) : null}
      {/* Every block carries the insert affordance, including the
                last: hovering below the end of the document is how a block is
                appended, with no button parked under the work. */}
      {!isReadOnly ? (
        <div
          className={cn(
            'group/insert relative',
            // A seam inside a prose run must not push the paragraphs
            // apart: the run is one column, so the affordance floats over
            // the boundary on a zero-height element instead of occupying
            // a row of its own.
            insideProseRun ? 'h-0' : 'flex h-4 items-center justify-center',
          )}
          data-insertion-gap={`after-${block.id}`}
          data-prose-run-seam={insideProseRun ? '' : undefined}
          data-print-hide
        >
          <div
            className={cn(
              insideProseRun
                ? // On a touch screen there is no hover to reveal it,
                  // so the hidden button would swallow taps on the
                  // text it floats over. Typing / inserts there.
                  'absolute inset-x-0 -top-2 flex h-4 items-center justify-center pointer-coarse:pointer-events-none'
                : 'contents',
            )}
          >
            <div className="absolute inset-x-0 h-px bg-border opacity-0 transition-opacity group-hover/insert:opacity-100 group-focus-within/insert:opacity-100" />
            <AddBlockControl
              onInsert={(type) => void handleInsert(type, block.id)}
              variant="icon"
              after={blockLabel(block)}
              label={t(
                'notebook.notebookDocument.insertBlockAfterBlocklabelLabel',
                { blockLabel: blockLabel(block) },
              )}
              className="relative z-10 opacity-0 transition-opacity group-hover/insert:opacity-100 group-focus-within/insert:opacity-100"
            />
          </div>
        </div>
      ) : null}
      {collapsedHere && !isHiddenSection ? (
        <CollapsedNotebookSection
          anchorId={collapsedHere}
          count={hiddenCounts.get(collapsedHere) ?? 0}
          onToggle={onToggleSection}
        />
      ) : null}
    </>
  )
}

function CollapsedNotebookSection({
  anchorId,
  count,
  onToggle,
}: {
  anchorId: string
  count: number
  onToggle: NotebookDocumentProps['onToggleSection']
}) {
  return (
    <div
      className="mt-1 flex items-center gap-2 rounded-md border border-dashed px-3 py-1.5 text-xs text-fg-muted"
      data-testid={`section-collapsed-${anchorId}`}
      data-print-hide
    >
      <span>
        {count > 0
          ? t('notebook.notebookDocument.sectionCollapsedBlocks', { count })
          : t('notebook.notebookDocument.sectionCollapsedContent')}
      </span>
      <button
        type="button"
        className="underline underline-offset-2 hover:text-fg"
        onClick={() => onToggle?.(anchorId)}
      >
        {t('notebook.notebookDocument.show')}
      </button>
    </div>
  )
}

/** Project document state onto the native row's focus, gate and print contract. */
function notebookBlockRowAttributes(
  block: NotebookBlockData,
  notebook: ReturnType<typeof useNotebookDocument>,
): React.ComponentProps<typeof NotebookBlockRow>['row'] {
  const {
    movingId,
    gates,
    hiddenBlockIds,
    proseRuns,
    isReadOnly,
    canMove,
    activeId,
    selectedId,
    setActiveId,
    selectBlock,
    setCaretHint,
    handleRowKeyDown,
  } = notebook

  const proseRun = proseRuns[block.id]

  return {
    id: `block-${block.id}`,
    className: cn(
      // Owner decision, 2026-10-15: prose is full width, not centred in a 680px measure.
      // The insert seam owns spacing; collapsed content is restored for printing.
      'w-full',
      movingId === block.id && 'opacity-60',
      gates?.held.has(block.id) && 'opacity-45',
      hiddenBlockIds.has(block.id) && 'hidden print:contents',
    ),
    'data-prose-run': proseRun
      ? proseRun.isFirst
        ? 'start'
        : proseRun.isLast
          ? 'end'
          : 'middle'
      : undefined,
    'data-held-by': gates?.held.get(block.id)?.gateId,
    title: gates?.held.has(block.id)
      ? t('notebook.gates.laterHeld')
      : undefined,
    inert: gates?.held.has(block.id) || undefined,
    tabIndex: isReadOnly ? undefined : 0,
    role: isReadOnly ? undefined : 'group',
    'aria-label': canMove
      ? t('notebook.notebookDocument.blockNamedMovable', {
          label: blockLabel(block),
        })
      : t('notebook.notebookDocument.blockNamed', { label: blockLabel(block) }),
    'data-active': activeId === block.id || undefined,
    'data-selected': selectedId === block.id || undefined,
    onFocus: (event) => {
      // Keep preview links/timer controls mounted until their own event lands.
      if (
        event.target instanceof Element &&
        event.target.closest('a[href], [data-keep-preview]')
      )
        return
      setActiveId(block.id)
      selectBlock(block)
    },
    onBlur: (event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) {
        setActiveId((current) => (current === block.id ? null : current))
      }
    },
    onClick: () => {
      // A pointer, rather than the prior arrow key, determines the next caret position.
      setCaretHint(null)
      selectBlock(block)
    },
    onKeyDown: (event) => handleRowKeyDown(event, block),
  }
}

/** Choose the read view without unmounting an editor that still owns unsaved work. */
function NotebookDocumentBlockBody({
  block,
  notebook,
  options,
}: {
  block: NotebookBlockData
  notebook: ReturnType<typeof useNotebookDocument>
  options: NotebookDocumentProps
}) {
  const {
    isReadOnly,
    selectedId,
    unsavedBlockIds,
    orderedIds,
    hiddenNodeIndexesByBlockId,
  } = notebook

  const {
    record,
    onCellSelectionChange,
    frozenSheetEvidence,
    actionBlockContext,
  } = options

  if (block.type === 'sheet') {
    return (
      <NotebookSheetBlock
        block={block}
        record={record}
        readOnly={isReadOnly}
        onCellSelectionChange={onCellSelectionChange}
        frozenEvidence={
          frozenSheetEvidence
            ? (frozenSheetEvidence.get(block.id) ?? null)
            : undefined
        }
      />
    )
  }

  // New prose/import blocks open for writing; plugin screens always retain their editor.
  const opensForWriting =
    block.type === 'dataset_import' ||
    (orderedIds.length === 1 &&
      block.type === 'rich_text' &&
      isEmptyRichText(block.payload))

  const showEditor =
    isEditableBlockType(block.type) &&
    !isReadOnly &&
    (selectedId === block.id ||
      unsavedBlockIds.has(block.id) ||
      opensForWriting ||
      block.type === 'plugin')

  if (showEditor)
    return (
      <NotebookDocumentBlockEditor
        block={block}
        notebook={notebook}
        options={options}
      />
    )

  return (
    <BlockPreview
      block={block}
      hiddenNodeIndexes={hiddenNodeIndexesByBlockId.get(block.id)}
      actionContext={actionBlockContext}
    />
  )
}

/** Bind one editor to the document's canonical mutations and keyboard actions. */
function NotebookDocumentBlockEditor({
  block,
  notebook,
  options,
}: {
  block: NotebookBlockData
  notebook: ReturnType<typeof useNotebookDocument>
  options: NotebookDocumentProps
}) {
  const {
    onSaveBlock,
    offline,
    onPinProtocol,
    onAttachFile,
    onMakeSheet,
    onFreezeChart,
    onUnfreezeChart,
    onFreezeAnalysis,
    onUnfreezeAnalysis,
  } = options

  const {
    handleInsert,
    hiddenNodeIndexesByBlockId,
    proseRuns,
    handleStatusChange,
    isReadOnly,
    selectedId,
    activeId,
    caretHint,
    handleSlashCommand,
    handleEnterAtEnd,
    handleBackspaceAtStart,
    handleArrowUpFromStart,
    handleArrowDownFromEnd,
  } = notebook

  return (
    <BlockEditor
      block={block}
      onInsertBelow={(type, payload) =>
        void handleInsert(type, block.id, payload ? { payload } : undefined)
      }
      headingAnchorPrefix={`section-${block.id}`}
      hiddenRichTextNodeIndexes={hiddenNodeIndexesByBlockId.get(block.id)}
      // Mid-run an empty row is an empty line, not an invitation.
      placeholder={
        proseRuns[block.id]
          ? undefined
          : t('notebook.notebookDocument.placeholder')
      }
      save={(payload) => onSaveBlock(block, payload)}
      pinProtocol={
        onPinProtocol
          ? (protocolRecordId) => onPinProtocol(block, protocolRecordId)
          : undefined
      }
      onAttachFile={
        onAttachFile ? (file) => onAttachFile(block, file) : undefined
      }
      onMakeSheet={
        onMakeSheet ? (request) => onMakeSheet(block, request) : undefined
      }
      onFreezeChart={onFreezeChart ? () => onFreezeChart(block) : undefined}
      onUnfreezeChart={
        onUnfreezeChart ? () => onUnfreezeChart(block) : undefined
      }
      onFreezeAnalysis={
        onFreezeAnalysis ? () => onFreezeAnalysis(block) : undefined
      }
      onUnfreezeAnalysis={
        onUnfreezeAnalysis ? () => onUnfreezeAnalysis(block) : undefined
      }
      offline={offline}
      onStatusChange={(status) => handleStatusChange(block.id, status)}
      readOnly={isReadOnly}
      autoFocus={selectedId === block.id && activeId === block.id}
      caretHint={caretHint?.blockId === block.id ? caretHint.to : undefined}
      onSlashCommand={(type) => void handleSlashCommand(block, type)}
      onEnterAtEnd={() => void handleEnterAtEnd(block)}
      onBackspaceAtStart={() => void handleBackspaceAtStart(block)}
      onArrowUpFromStart={() => handleArrowUpFromStart(block)}
      onArrowDownFromEnd={() => handleArrowDownFromEnd(block)}
    />
  )
}

function blockLabel(block: NotebookBlockData): string {
  const labels = new Map(
    Object.entries({
      rich_text: t('notebook.notebookDocument.text'),
      checklist: t('notebook.notebookDocument.list'),
      callout: t('notebook.notebookDocument.note'),
      linked_record: t('notebook.notebookDocument.link'),
      table: t('notebook.notebookDocument.table'),
      sheet: t('notebook.notebookDocument.sheet'),
      dataset_import: t('notebook.notebookDocument.importData'),
      chart: t('notebook.notebookDocument.chart'),
      plate_map: t('notebook.notebookDocument.plateMap'),
      file: t('notebook.notebookDocument.file'),
      metric: t('notebook.notebookDocument.metric'),
      procedure_step: t('notebook.notebookDocument.procedureStep'),
      protocol_reference: t('notebook.notebookDocument.protocol'),
      materials: t('notebook.notebookDocument.materials'),
      analysis: t('notebook.notebookDocument.analysis'),
      pipeline_output: t('notebook.notebookDocument.pipelineOutput'),
      code_cell: t('notebook.notebookDocument.codeCell'),
      signature_request: t('notebook.notebookDocument.signatureRequest'),
      corrective_actions: t('notebook.notebookDocument.correctiveActions'),
      conclusion: t('notebook.notebookDocument.conclusion'),
    }),
  )

  return labels.get(block.type) ?? block.type
}

/**
 * Visible title for blocks that lack their own heading. Blocks that render
 * their own title internally (rich_text with a heading node, materials,
 * protocol_reference, chart, plate_map, metric, file) return undefined so
 * NotebookBlock doesn't add a duplicate header.
 */
// NOTE: blockTitle removed — titles are now user-editable via the block
// payload's optional `title` field. When empty, no heading space is rendered.
