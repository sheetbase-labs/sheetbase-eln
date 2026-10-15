import * as React from 'react'

import { QueryClientContext } from '@tanstack/react-query'

import { cn } from '#/lib/utils'
import type {
  NotebookBlock as NotebookBlockData,
  NotebookRecord,
} from '#/lib/notebook-data'
import type { ActionBlockContext } from '#/lib/notebook-action-blocks'
import { isEditableBlockType } from '#/lib/blocks/registry'
import { richTextToPlainText } from '#/lib/blocks'
import type { RichTextPayload } from '#/lib/blocks'
import {
  joinProsePayloads,
  proseBackspaceAction,
  proseRunMembers,
} from '#/lib/notebook-prose-runs'
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '#/components/v3/ui/popover'
import { NotebookBlock } from './notebook-block'
import { BlockPreview } from './block-preview'
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
import { AddBlockControl } from './add-block-menu'
import { NotebookSheetBlock } from './notebook-sheet-block'
import {
  NotebookSignedSection,
  NotebookViewerActions,
} from './notebook-viewer-actions'
import { ScientificWorkbookProvider } from './scientific-workbook-provider'
import {
  useCollaborationEnabled,
  useThreads,
} from '#/lib/collaboration/liveblocks.config'
import { CommentButton } from '#/components/collaboration/comment-button'
import { PresenceSync } from '#/components/collaboration/use-set-presence'
import { BlockCoEditBadge } from '#/components/collaboration/presence-co-editing'
import {
  ThreadPanel,
  threadMatchesAnchor,
} from '#/components/collaboration/thread-panel'
import { useCollaborationRoomReady } from '#/components/collaboration/collaboration-room'
import type { ThreadAnchor } from '#/lib/collaboration/types'
import {
  useRegisterShortcuts,
  useShortcutScope,
} from '#/components/shortcuts/shortcut-provider'
import { notebookShortcuts } from '#/lib/shortcut-scopes'

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
    payload: Record<string, unknown>,
  ) => Promise<SaveResult<Record<string, unknown>>>
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
    options?: { datasetSchemaId?: string },
  ) => Promise<string | undefined>
  /** Pin a protocol to an empty protocol-reference block. */
  onPinProtocol?: (
    block: NotebookBlockData,
    protocolRecordId: string,
  ) => Promise<void>
  /** SCI-003: attach an uploaded file to an empty file block. */
  onAttachFile?: (block: NotebookBlockData, file: File) => Promise<void>
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
    payload: Record<string, unknown>,
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
    options?: { datasetSchemaId?: string },
  ) => Promise<string | undefined>
  readOnly?: boolean
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
  className?: string
}

export function NotebookDocument(props: NotebookDocumentProps) {
  return (
    <ScientificWorkbookProvider>
      <NotebookDocumentContent {...props} />
    </ScientificWorkbookProvider>
  )
}

const NOTE02_EMPTY_COLLAPSED_SECTIONS: ReadonlySet<string> = new Set<string>()

function NotebookDocumentContent({
  record,
  blocks,
  onSaveBlock,
  offline,
  onUnsavedWorkChange,
  onInsertBlock,
  onPinProtocol,
  onAttachFile,
  onFreezeChart,
  onUnfreezeChart,
  onFreezeAnalysis,
  onUnfreezeAnalysis,
  onDuplicateBlock,
  onDeleteBlock,
  onUndoDelete,
  onMoveBlock,
  onReplaceBlock,
  readOnly,
  collaborationWorkspaceId,
  collaborationRole = 'viewer',
  frozenSheetEvidence,
  onCellSelectionChange,
  actionBlockContext,
  className,
  /** NOTE-02 section collapse — presentation state only, route-owned. */
  collapsedSections,
  onToggleSection,
}: NotebookDocumentProps) {
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [activeId, setActiveId] = React.useState<string | null>(null)
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
  const pendingSelectionRef = React.useRef<string | null>(null)
  // Per-block error messages for insert / duplicate / delete (ELN-005).
  // Save errors are owned per-editor by `useAutosave` (ELN-007).
  const [errorById, setErrorById] = React.useState<Record<string, string>>({})
  const [confirmDelete, setConfirmDelete] =
    React.useState<NotebookBlockData | null>(null)
  const [pendingDelete, setPendingDelete] = React.useState(false)
  const [undo, setUndo] = React.useState<{
    type: string
    payload: Record<string, unknown>
    afterBlockId: string | null
    beforeBlockId: string | null
    label: string
    /** What the banner says. Defaults to the delete copy. */
    message?: string
    /**
     * Set when the undo has to restore the row above as well, because a join
     * moved this row's content into it.
     */
    restorePayload?: { blockId: string; payload: Record<string, unknown> }
  } | null>(null)

  // --- Movement (ELN-006) -------------------------------------------------
  // `optimisticOrder` holds a temporary id ordering applied immediately on
  // a move so the UI feels instant; it is cleared on success (the canonical
  // blocks from the route's query cache then render) or restored to the
  // pre-move snapshot on rejection. `draggingId` / `dropTarget` drive the
  // native drag insertion indicator; `movingId` marks the block whose RPC
  // is in flight so its row can show a subtle pending state.
  const [optimisticOrder, setOptimisticOrder] = React.useState<string[] | null>(
    null,
  )
  const [draggingId, setDraggingId] = React.useState<string | null>(null)
  const [dropTarget, setDropTarget] = React.useState<{
    afterBlockId: string | null
    beforeBlockId: string | null
  } | null>(null)
  const [movingId, setMovingId] = React.useState<string | null>(null)
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
    if (
      selectedId &&
      !currentIds.has(selectedId) &&
      pendingSelectionRef.current !== selectedId
    ) {
      setSelectedId(null)
      setActiveId(null)
      updateBlockHash(null)
    }
    pendingSelectionRef.current = null
  }, [blocks, selectedId])

  const hasUnsavedWork = unsavedBlockIds.size > 0
  React.useEffect(() => {
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

  // Scroll to the block named in the URL hash on mount (deep link to a block).
  React.useEffect(() => {
    const hash = window.location.hash.replace('#', '')
    if (hash.startsWith('block-')) {
      const el = document.getElementById(hash)
      if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ block: 'start' })
      }
    }
  }, [])

  function updateBlockHash(blockId: string | null) {
    try {
      // Replace, not navigate, so the route guard and queries do not refire.
      const next = blockId
        ? `#block-${blockId}`
        : `${window.location.pathname}${window.location.search}`
      window.history.replaceState(null, '', next)
    } catch {
      /* jsdom/SSR: ignore */
    }
  }

  function selectBlock(block: NotebookBlockData) {
    setSelectedId(block.id)
    updateBlockHash(block.id)
  }

  async function handleInsert(type: string, afterBlockId?: string) {
    try {
      const newId = await onInsertBlock(type, afterBlockId)
      if (newId) selectAndFocus(newId)
      setUndo(null)
      return newId
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not insert the block.'
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
        err instanceof Error ? err.message : 'Could not duplicate the block.'
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
        label: `${confirmDelete.type} block`,
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
        err instanceof Error ? err.message : 'Could not delete the block.'
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

  const isReadOnly = readOnly || record.archivedAt !== null
  // EXP-04.5: a signed (locked) record shows its signatures inline, and a
  // view-only reader gets the actions they still have. Archived records are
  // neither: they are read-only for everyone and no access request applies.
  const isSigned = record.lockedAt !== null
  const viewerActions = isReadOnly && record.archivedAt === null && !isSigned
  // A signed section only reads where a query client exists — presentational
  // and pre-hydration renders must not open a connection.
  const hasQueryClient = React.useContext(QueryClientContext) !== undefined
  // COLLAB-02: block comment affordances render only when the deployment
  // has collaboration enabled; ThreadPanel further gates on room readiness.
  const collabComments = useCollaborationEnabled()
  const collabReady = useCollaborationRoomReady()

  // Cell operations belong to SheetKeyboardShortcuts, not block navigation.
  useShortcutScope('notebook')
  useRegisterShortcuts(
    React.useMemo(() => {
      const selectedBlock = () =>
        document.activeElement?.closest('[id^="block-"]') ??
        (selectedId ? document.getElementById(`block-${selectedId}`) : null)
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
              void handleInsert('rich_text', selectedId ?? undefined)
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
    for (const anchor of sectionCollapsed) {
      const entry = outlineEntries.find((item) => item.anchorId === anchor)
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

  /**
   * Compute the (afterBlockId, beforeBlockId) neighbours for moving
   * `blockId` to `targetIndex` within the effective ordering. Dropping at
   * index 0 → (null, firstId); at the end → (lastId, null); otherwise
   * (ids[targetIndex-1], ids[targetIndex]). The moved block is excluded
   * from the neighbour candidates so a no-op move resolves cleanly.
   */
  function neighboursForTarget(
    ids: string[],
    blockId: string,
    targetIndex: number,
  ): { afterBlockId: string | null; beforeBlockId: string | null } {
    const others = ids.filter((id) => id !== blockId)
    const clamped = Math.max(0, Math.min(targetIndex, others.length))
    const afterBlockId = clamped > 0 ? (others[clamped - 1] ?? null) : null
    const beforeBlockId =
      clamped < others.length ? (others[clamped] ?? null) : null
    return { afterBlockId, beforeBlockId }
  }

  function focusBlockAnchor(blockId: string) {
    // Defer so the reordered DOM has committed before we focus.
    requestAnimationFrame(() => {
      const el = document.getElementById(`block-${blockId}`)
      if (!el) return
      if (el.contains(document.activeElement)) {
        if (typeof el.scrollIntoView === 'function') {
          el.scrollIntoView({ block: 'nearest' })
        }
        return
      }
      el.focus()
    })
  }

  function focusEmptyNotebook() {
    requestAnimationFrame(() => {
      document.getElementById('notebook-empty-start')?.focus()
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
        ? 'The notebook changed elsewhere. The latest order was restored.'
        : err instanceof Error
          ? err.message
          : 'Could not move the block.'
      setMoveError({ blockId: block.id, message, stale })
    } finally {
      setMovingId(null)
      // Keep selection on the moved block and refocus its anchor so keyboard
      // users do not lose their place after a move or a rollback.
      setSelectedId(block.id)
      focusBlockAnchor(block.id)
    }
  }

  function moveByOne(block: NotebookBlockData, dir: 'up' | 'down') {
    const idx = orderedIds.indexOf(block.id)
    if (idx < 0) return
    const target = dir === 'up' ? idx - 1 : idx + 1
    if (target < 0 || target >= orderedIds.length) return
    void performMove(block, target)
  }

  // --- Notion-like keyboard & slash command handlers ----------------------

  /**
   * Focus a block's anchor element and select it. Deferred via rAF so the
   * DOM has settled after reorders/inserts before we focus.
   */
  function selectAndFocus(blockId: string) {
    pendingSelectionRef.current = blockId
    setSelectedId(blockId)
    setActiveId(blockId)
    updateBlockHash(blockId)
    requestAnimationFrame(() => {
      const el = document.getElementById(`block-${blockId}`)
      if (el && typeof el.focus === 'function') el.focus()
    })
  }

  /** Slash command: replace the current empty text block with a new type. */
  async function handleSlashCommand(block: NotebookBlockData, type: string) {
    if (type === 'rich_text') return // handled in the editor itself
    try {
      const newId = onReplaceBlock
        ? await onReplaceBlock(block, type)
        : await onInsertBlock(type, block.id)
      if (newId) selectAndFocus(newId)
      setUndo(null)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not insert the block.'
      setErrorById((prev) => ({ ...prev, __insert: message }))
    }
  }

  /** Enter at end of a text block → create a new empty text block below. */
  async function handleEnterAtEnd(block: NotebookBlockData) {
    try {
      const newId = await onInsertBlock('rich_text', block.id)
      if (newId) selectAndFocus(newId)
      setUndo(null)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not create a block.'
      setErrorById((prev) => ({ ...prev, [block.id]: message }))
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
      richTextToPlainText(block.payload as RichTextPayload).trim() === ''
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
          err instanceof Error ? err.message : 'Could not join the paragraphs.'
        setErrorById((prev) => ({ ...prev, [block.id]: message }))
        return
      }
      if (!saved) {
        // The row above did not take the text, so the row below stays exactly
        // where it is. Deleting it here would lose the paragraph it carries.
        setErrorById((prev) => ({
          ...prev,
          [previous.id]: 'Could not join the paragraphs. Nothing was changed.',
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
            : 'The paragraphs were joined, but the block below could not be removed.'
        setErrorById((prev) => ({ ...prev, [block.id]: message }))
        selectAndFocus(previous.id)
        return
      }
      setUndo({
        type: block.type,
        payload: block.payload,
        afterBlockId: prevId,
        beforeBlockId: nextId,
        label: `${block.type} block`,
        message: 'Paragraphs joined.',
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
        label: `${block.type} block`,
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
        err instanceof Error ? err.message : 'Could not delete the block.'
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
    // prefer a discoverable affordance.
    if (e.altKey && e.key === 'ArrowUp') {
      e.preventDefault()
      moveByOne(block, 'up')
    } else if (e.altKey && e.key === 'ArrowDown') {
      e.preventDefault()
      moveByOne(block, 'down')
    }
  }

  function handleDragStart(
    e: React.DragEvent<HTMLButtonElement>,
    block: NotebookBlockData,
  ) {
    if (!canMove) return
    setDraggingId(block.id)
    setMoveError(null)
    try {
      e.dataTransfer.effectAllowed = 'move'
      // Firefox requires data to be set or no drag fires at all.
      e.dataTransfer.setData('text/plain', block.id)
    } catch {
      /* jsdom: dataTransfer may be a stub */
    }
  }

  function handleDragEnd() {
    setDraggingId(null)
    setDropTarget(null)
  }

  /**
   * As the pointer moves over a row, decide whether the drop would land
   * above or below that row based on the pointer's Y relative to the row's
   * midpoint. Sets `dropTarget` to the corresponding neighbours and nudges
   * the window to auto-scroll when the pointer is near the viewport edge.
   */
  function handleDragOver(
    e: React.DragEvent<HTMLDivElement>,
    block: NotebookBlockData,
  ) {
    if (!draggingId || draggingId === block.id) return
    e.preventDefault()
    try {
      e.dataTransfer.dropEffect = 'move'
    } catch {
      /* jsdom */
    }
    const rect = e.currentTarget.getBoundingClientRect()
    const before = e.clientY < rect.top + rect.height / 2
    // Compute the drop target as an index within the `others` list (the
    // ordering with the dragged block removed). The hovered row's index in
    // `others` differs from its index in `orderedIds` when the dragged block
    // sat above it, so we must re-derive it from `others` rather than
    // reusing the full-order index.
    const others = orderedIds.filter((id) => id !== draggingId)
    const hoverIdxInOthers = others.indexOf(block.id)
    const target = before ? hoverIdxInOthers : hoverIdxInOthers + 1
    setDropTarget(neighboursForTarget(orderedIds, draggingId, target))
    // Auto-scroll near the viewport edges so long notebooks stay reachable.
    const margin = 64
    if (e.clientY < margin && typeof window.scrollBy === 'function') {
      window.scrollBy(0, -10)
    } else if (
      e.clientY > window.innerHeight - margin &&
      typeof window.scrollBy === 'function'
    ) {
      window.scrollBy(0, 10)
    }
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    if (!draggingId) return
    e.preventDefault()
    // Use the drop target computed during the preceding dragOver. The OS
    // fires `drop` at the same pointer position as the last `dragover`, so
    // recomputing from the drop event's clientY would be redundant and is
    // unreliable in jsdom (which zeros bounding rects). If no drag-over
    // target was established (e.g. the pointer never entered a row), skip.
    if (!dropTarget) return
    const moved = blockById.get(draggingId)
    setDropTarget(null)
    setDraggingId(null)
    if (!moved) return
    // Re-derive the target index within the `others` list (excluding the
    // dragged block) from the stored neighbours so the move matches the
    // indicator the user saw.
    const others = orderedIds.filter((id) => id !== draggingId)
    let targetIdx: number
    if (dropTarget.beforeBlockId !== null) {
      targetIdx = others.indexOf(dropTarget.beforeBlockId)
    } else if (dropTarget.afterBlockId !== null) {
      targetIdx = others.indexOf(dropTarget.afterBlockId) + 1
    } else {
      targetIdx = others.length
    }
    void performMove(moved, targetIdx)
  }

  return (
    <div className={cn('pt-3', className)}>
      {/* COLLAB-01: broadcast which block I am editing. Awareness only —
          this never gates or locks editing for anyone. PresenceSync is
          null until the enclosing CollaborationRoom has mounted. */}
      <PresenceSync
        activeBlockId={selectedId}
        mode={selectedId ? 'editing' : 'viewing'}
      />
      {viewerActions ? (
        <NotebookViewerActions
          projectId={record.projectId}
          commentEnabled={collabComments && collabReady}
          selectedBlockId={selectedId}
        />
      ) : null}
      {orderedIds.length === 0 && !isReadOnly ? (
        <div
          className="rounded-lg border border-dashed bg-surface-muted/20 px-6 py-8 text-center"
          data-empty-notebook
        >
          <h2 className="font-display text-base font-semibold">
            Start this Notebook
          </h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-fg-muted">
            Begin with an objective, method, observation, or another scientific
            block. The new block opens in place and saves automatically.
          </p>
          <div className="mx-auto mt-4 flex max-w-sm flex-col gap-2 sm:flex-row sm:justify-center">
            <button
              id="notebook-empty-start"
              type="button"
              onClick={() => void handleInsert('rich_text')}
              className="inline-flex h-8 items-center justify-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Start writing
            </button>
            <AddBlockControl
              onInsert={(type) => void handleInsert(type)}
              label="Choose block type"
              className="sm:w-44"
            />
          </div>
        </div>
      ) : null}
      {orderedIds.map((id, index) => {
        const block = blockById.get(id)
        if (!block) return null
        const editable = isEditableBlockType(block.type) && !isReadOnly
        const isSelected = selectedId === block.id
        const isActive = activeId === block.id
        const isDragging = draggingId === block.id
        const isMoving = movingId === block.id
        const hasUnsavedDraft = unsavedBlockIds.has(block.id)
        // Show exactly one insertion indicator per gap: "above" when this
        // block is the following neighbour, and "below" only for the
        // end-of-list position (after=block, before=null) where no
        // following block exists to carry the "above" indicator.
        const showAbove = !!dropTarget && dropTarget.beforeBlockId === block.id
        const showBelow =
          !!dropTarget &&
          dropTarget.afterBlockId === block.id &&
          dropTarget.beforeBlockId === null
        const blockState = isReadOnly
          ? 'read-only'
          : isDragging
            ? 'dragging'
            : isSelected && isActive && editable
              ? 'editing'
              : isSelected
                ? 'selected'
                : 'default'
        const isHiddenSection = hiddenBlockIds.has(block.id)
        const collapsedHere = collapsedAnchorByBlockId.get(block.id)
        const proseRun = proseRuns[block.id]
        return (
          <React.Fragment key={block.id}>
            {showAbove ? (
              <div
                aria-hidden="true"
                className="h-0.5 rounded-full bg-primary/70"
                data-drop-indicator="above"
              />
            ) : null}
            <div
              id={`block-${block.id}`}
              className={cn(
                'scroll-mt-28 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring',
                // The container no longer spaces rows: spacing is per row, so a
                // run continuation can sit flush against the row above it and
                // the seam inside a run costs nothing at all.
                index > 0 && !(proseRun && !proseRun.isFirst) && 'mt-2',
                // The document reads the full width of the working surface.
                // The designed screens (ui-system-v3/canvas/NbEditing.dc.html
                // and the rest of the Nb* set) put prose in a 680px centred
                // measure, so this is a deliberate deviation from the design
                // reference, taken by the owner on 2026-10-15: the notebook is
                // not to be width-constrained or centred. Do not "fix" it back
                // without re-reading that decision.
                'w-full',
                isMoving && 'opacity-60',
                // NOTE-02: collapsed sections are removed from view but
                // restored in print, so printed structure stays complete.
                isHiddenSection && 'hidden print:contents',
              )}
              data-prose-run={
                proseRun
                  ? proseRun.isFirst
                    ? 'start'
                    : proseRun.isLast
                      ? 'end'
                      : 'middle'
                  : undefined
              }
              tabIndex={isReadOnly ? undefined : 0}
              role={isReadOnly ? undefined : 'group'}
              aria-label={`${blockLabel(block)} block${canMove ? ' — Alt+Arrow keys move; Ctrl+Arrow keys navigate' : ''}`}
              data-active={isActive || undefined}
              data-selected={isSelected || undefined}
              onFocus={() => {
                setActiveId(block.id)
                selectBlock(block)
              }}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) {
                  setActiveId((current) =>
                    current === block.id ? null : current,
                  )
                }
              }}
              onClick={() => {
                // A pointer puts the caret where it was clicked, so any
                // keyboard hint from an arrow key no longer applies.
                setCaretHint(null)
                selectBlock(block)
              }}
              onKeyDown={(e) => handleRowKeyDown(e, block)}
              onDragOver={(e) => handleDragOver(e, block)}
              onDragEnter={(e) => {
                if (draggingId && draggingId !== block.id) e.preventDefault()
              }}
              onDrop={(e) => handleDrop(e)}
            >
              <NotebookBlock
                label={blockLabel(block)}
                continuous={!!proseRun}
                title={
                  // Display only: editable payload fields belong to the
                  // block's single autosave/conflict state machine below.
                  // Chart and plate_map render their own payload.title
                  // internally (ChartFrame header, plate map caption).
                  // Suppress the wrapper title to avoid duplication.
                  block.type !== 'chart' &&
                  block.type !== 'plate_map' &&
                  typeof block.payload.title === 'string' &&
                  block.payload.title.trim()
                    ? block.payload.title
                    : undefined
                }
                state={blockState}
                ariaLabel={`${block.type} block`}
                actions={
                  <>
                    {/* COLLAB-01 co-editing awareness: only while this
                        block is the one I am editing. */}
                    <BlockCoEditBadge
                      blockId={block.id}
                      active={editable && isSelected}
                    />
                    {collabComments ? (
                      <BlockComments
                        workspaceId={collaborationWorkspaceId}
                        recordId={record.id}
                        blockId={block.id}
                        role={collaborationRole}
                      />
                    ) : undefined}
                  </>
                }
                draggable={canMove}
                onDragStart={(e) => handleDragStart(e, block)}
                onDragEnd={handleDragEnd}
                menuItems={
                  isReadOnly
                    ? undefined
                    : [
                        {
                          id: 'insert-below',
                          label: 'Insert text below',
                          onSelect: () =>
                            void handleInsert('rich_text', block.id),
                          separatorAfter: true,
                        },
                        ...(canMove
                          ? [
                              {
                                id: 'move-up',
                                label: 'Move up',
                                onSelect: () => moveByOne(block, 'up'),
                                disabled: index === 0,
                              },
                              {
                                id: 'move-down',
                                label: 'Move down',
                                onSelect: () => moveByOne(block, 'down'),
                                disabled: index === orderedIds.length - 1,
                                separatorAfter: true,
                              },
                            ]
                          : []),
                        {
                          id: 'duplicate',
                          label: 'Duplicate',
                          onSelect: () => handleDuplicate(block),
                        },
                        {
                          id: 'delete',
                          label: 'Delete',
                          onSelect: () => setConfirmDelete(block),
                          separatorAfter: true,
                        },
                      ]
                }
              >
                {block.type === 'sheet' ? (
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
                ) : editable && (isSelected || hasUnsavedDraft) ? (
                  <BlockEditor
                    block={block}
                    headingAnchorPrefix={`section-${block.id}`}
                    hiddenRichTextNodeIndexes={hiddenNodeIndexesByBlockId.get(
                      block.id,
                    )}
                    // Mid-run an empty row is an empty line, not an invitation.
                    placeholder={
                      proseRun
                        ? undefined
                        : 'Type / for blocks, or just start writing'
                    }
                    save={(payload) => onSaveBlock(block, payload)}
                    pinProtocol={
                      onPinProtocol
                        ? (protocolRecordId) =>
                            onPinProtocol(block, protocolRecordId)
                        : undefined
                    }
                    onAttachFile={
                      onAttachFile
                        ? (file) => onAttachFile(block, file)
                        : undefined
                    }
                    onFreezeChart={
                      onFreezeChart ? () => onFreezeChart(block) : undefined
                    }
                    onUnfreezeChart={
                      onUnfreezeChart ? () => onUnfreezeChart(block) : undefined
                    }
                    onFreezeAnalysis={
                      onFreezeAnalysis
                        ? () => onFreezeAnalysis(block)
                        : undefined
                    }
                    onUnfreezeAnalysis={
                      onUnfreezeAnalysis
                        ? () => onUnfreezeAnalysis(block)
                        : undefined
                    }
                    offline={offline}
                    onStatusChange={(status) =>
                      handleStatusChange(block.id, status)
                    }
                    readOnly={isReadOnly}
                    autoFocus={isSelected && isActive}
                    caretHint={
                      caretHint?.blockId === block.id ? caretHint.to : undefined
                    }
                    onSlashCommand={(type) =>
                      void handleSlashCommand(block, type)
                    }
                    onEnterAtEnd={() => void handleEnterAtEnd(block)}
                    onBackspaceAtStart={() =>
                      void handleBackspaceAtStart(block)
                    }
                    onArrowUpFromStart={() => handleArrowUpFromStart(block)}
                    onArrowDownFromEnd={() => handleArrowDownFromEnd(block)}
                  />
                ) : (
                  <BlockPreview
                    block={block}
                    hiddenNodeIndexes={hiddenNodeIndexesByBlockId.get(block.id)}
                    actionContext={actionBlockContext}
                  />
                )}
              </NotebookBlock>
              {moveError && moveError.blockId === block.id ? (
                <p
                  role="alert"
                  className="mt-1 px-1 text-xs text-danger-text"
                  data-move-error={moveError.stale ? 'stale' : 'generic'}
                >
                  {moveError.message}
                </p>
              ) : null}
            </div>
            {showBelow ? (
              <div
                aria-hidden="true"
                className="h-0.5 rounded-full bg-primary/70"
                data-drop-indicator="below"
              />
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
                  proseRun && !proseRun.isLast
                    ? 'h-0'
                    : 'flex h-4 items-center justify-center',
                )}
                data-insertion-gap={`after-${block.id}`}
                data-prose-run-seam={
                  proseRun && !proseRun.isLast ? '' : undefined
                }
                data-print-hide
              >
                <div
                  className={cn(
                    proseRun && !proseRun.isLast
                      ? 'absolute inset-x-0 -top-2 flex h-4 items-center justify-center'
                      : 'contents',
                  )}
                >
                  <div className="absolute inset-x-0 h-px bg-border opacity-0 transition-opacity group-hover/insert:opacity-100 group-focus-within/insert:opacity-100" />
                  <AddBlockControl
                    onInsert={(type) => void handleInsert(type, block.id)}
                    variant="icon"
                    after={blockLabel(block)}
                    label={`Insert block after ${blockLabel(block)}`}
                    className="relative z-10 opacity-0 transition-opacity group-hover/insert:opacity-100 group-focus-within/insert:opacity-100"
                  />
                </div>
              </div>
            ) : null}
            {collapsedHere && !isHiddenSection ? (
              <div
                className="mt-1 flex items-center gap-2 rounded-md border border-dashed px-3 py-1.5 text-xs text-fg-muted"
                data-testid={`section-collapsed-${collapsedHere}`}
                data-print-hide
              >
                <span>
                  Section collapsed —{' '}
                  {(() => {
                    const blocksHidden = hiddenCounts.get(collapsedHere) ?? 0
                    if (blocksHidden > 0) {
                      return `${blocksHidden} block${blocksHidden === 1 ? '' : 's'} hidden.`
                    }
                    return 'content in this block is hidden.'
                  })()}
                </span>
                <button
                  type="button"
                  className="underline underline-offset-2 hover:text-fg"
                  onClick={() => onToggleSection?.(collapsedHere)}
                >
                  Show
                </button>
              </div>
            ) : null}
          </React.Fragment>
        )
      })}

      {errorById.__insert ? (
        <p role="alert" className="text-xs text-danger-text">
          {errorById.__insert}
        </p>
      ) : null}

      {!isReadOnly && orderedIds.length === 1 ? (
        // Shown while the document is still being started. A full notebook does
        // not need three lines of key instructions under it every time, and the
        // same list lives in Help → Keyboard shortcuts.
        <p className="text-xs text-fg-muted" data-print-hide>
          Type / in empty text to insert a block. Alt+↑/↓ reorders the focused
          block; Ctrl+↑/↓ moves focus between blocks. Alt+Enter adds text below.
          The block menu also duplicates or deletes.
        </p>
      ) : null}

      {undo ? (
        <div
          role="status"
          className="flex items-center gap-3 rounded-md border bg-surface-muted/40 px-3 py-2 text-xs"
        >
          <span>{undo.message ?? 'Block deleted.'}</span>
          {onUndoDelete ? (
            <button
              type="button"
              onClick={() => void handleUndo()}
              className="font-medium text-primary-text underline"
            >
              Undo
            </button>
          ) : null}
        </div>
      ) : null}

      {isSigned && hasQueryClient ? (
        <NotebookSignedSection recordId={record.id} />
      ) : null}

      <ConfirmDialog
        open={confirmDelete !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(null)
        }}
      >
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>Delete this block?</ConfirmDialogTitle>
            <ConfirmDialogDescription>
              {confirmDelete && unsavedBlockIds.has(confirmDelete.id)
                ? 'This block has edits that have not saved. Deleting now discards those edits. You can undo immediately after deleting.'
                : confirmDelete &&
                    confirmDelete.type === 'sheet' &&
                    isCanonicalSheetBlock(confirmDelete.payload)
                  ? 'The block will be removed from the notebook. The Sheet Instance is not archived or deleted, and you can undo immediately after deleting.'
                  : 'The block will be removed from the notebook. You can undo immediately after deleting.'}
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <ConfirmDialogFooter>
            <ConfirmDialogCancel disabled={pendingDelete}>
              Cancel
            </ConfirmDialogCancel>
            <ConfirmDialogAction
              onClick={() => void handleConfirmDelete()}
              disabled={pendingDelete}
            >
              {pendingDelete ? 'Deleting…' : 'Delete'}
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
    </div>
  )
}

function blockLabel(block: NotebookBlockData): string {
  const map: Record<string, string> = {
    rich_text: 'Text',
    checklist: 'List',
    callout: 'Note',
    linked_record: 'Link',
    table: 'Table',
    sheet: 'Sheet',
    chart: 'Chart',
    plate_map: 'Plate map',
    file: 'File',
    metric: 'Metric',
    procedure_step: 'Procedure step',
    protocol_reference: 'Protocol',
    materials: 'Materials',
    analysis: 'Analysis',
    pipeline_output: 'Pipeline output',
    signature_request: 'Signature request',
    corrective_actions: 'Corrective actions',
  }
  return map[block.type] ?? block.type
}

/**
 * Visible title for blocks that lack their own heading. Blocks that render
 * their own title internally (rich_text with a heading node, materials,
 * protocol_reference, chart, plate_map, metric, file) return undefined so
 * NotebookBlock doesn't add a duplicate header.
 */
// NOTE: blockTitle removed — titles are now user-editable via the block
// payload's optional `title` field. When empty, no heading space is rendered.

// ---------------------------------------------------------------------------
// COLLAB-02: per-block discussion affordance
// ---------------------------------------------------------------------------

/**
 * Hover-revealed comment button in the block header toolbar. Shows the
 * unresolved comment count for this block and opens a ThreadPanel anchored
 * to the block's stable UUID in the record room.
 *
 * Renders null until the enclosing CollaborationRoom is ready, so SSR and
 * the pre-hydration paint stay free of room hooks.
 */
function BlockComments({
  workspaceId,
  recordId,
  blockId,
  role,
}: {
  workspaceId: string | undefined
  recordId: string
  blockId: string
  role: string
}) {
  const ready = useCollaborationRoomReady()
  // No canonical workspace identity means no anchor can be built.
  if (!ready || !workspaceId) return null
  return (
    <BlockCommentsInner
      workspaceId={workspaceId}
      recordId={recordId}
      blockId={blockId}
      role={role}
    />
  )
}

function BlockCommentsInner({
  workspaceId,
  recordId,
  blockId,
  role,
}: {
  workspaceId: string
  recordId: string
  blockId: string
  role: string
}) {
  const { threads } = useThreads()
  const [open, setOpen] = React.useState(false)
  const anchor: ThreadAnchor = {
    anchorType: 'notebook-block',
    workspaceId,
    recordId,
    blockId,
  }
  const unresolvedCount = threads.filter(
    (thread) =>
      !thread.resolved && threadMatchesAnchor(thread.metadata, anchor),
  ).length
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<span className="inline-flex" />}>
        <CommentButton
          count={unresolvedCount}
          label={`Comments on block ${blockId}`}
          className={cn(
            'size-6 transition-opacity',
            unresolvedCount === 0 &&
              'opacity-0 focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100',
          )}
        />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-3">
        <ThreadPanel anchor={anchor} currentRole={role} compact />
      </PopoverContent>
    </Popover>
  )
}
