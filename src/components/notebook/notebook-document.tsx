import * as React from 'react'

import { cn } from '#/lib/utils'
import type {
  NotebookBlock as NotebookBlockData,
  NotebookRecord,
} from '#/lib/notebook-data'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#/components/ui'
import { NotebookBlock } from './notebook-block'
import { BlockPreview } from './block-preview'
import { BlockEditor } from './block-editor'
import type { AutosaveStatus, SaveResult } from './block-editor'
import { BlockPicker } from './block-picker'
import { ScientificSheetBlock } from '#/components/sheet/scientific-sheet-block'
import { ScientificWorkbookProvider } from './scientific-workbook-provider'

export type { AutosaveStatus, SaveResult }

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
 * `readOnly` disables all mutations (archived notebooks).
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
  onInsertBlock: (type: string, afterBlockId?: string) => Promise<void>
  /** Duplicate an existing block (same type/payload, inserted after it). */
  onDuplicateBlock: (block: NotebookBlockData) => Promise<void>
  /** Delete a block. */
  onDeleteBlock: (block: NotebookBlockData) => Promise<void>
  /** Re-insert a previously deleted block (undo). */
  onUndoDelete?: (
    type: string,
    payload: Record<string, unknown>,
    afterBlockId: string | null,
  ) => Promise<void>
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
  readOnly?: boolean
  className?: string
}

const EDITABLE_TYPES = new Set([
  'heading',
  'rich_text',
  'checklist',
  'linked_record',
])

export function NotebookDocument(props: NotebookDocumentProps) {
  return (
    <ScientificWorkbookProvider>
      <NotebookDocumentContent {...props} />
    </ScientificWorkbookProvider>
  )
}

function NotebookDocumentContent({
  record,
  blocks,
  onSaveBlock,
  offline,
  onUnsavedWorkChange,
  onInsertBlock,
  onDuplicateBlock,
  onDeleteBlock,
  onUndoDelete,
  onMoveBlock,
  readOnly,
  className,
}: NotebookDocumentProps) {
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
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
    label: string
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

  function selectBlock(block: NotebookBlockData) {
    setSelectedId(block.id)
    try {
      // Replace, not navigate, so the route guard and queries do not refire.
      window.history.replaceState(null, '', `#block-${block.id}`)
    } catch {
      /* jsdom/SSR: ignore */
    }
  }

  async function handleInsert(type: string, afterBlockId?: string) {
    try {
      await onInsertBlock(type, afterBlockId)
      setUndo(null)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not insert the block.'
      setErrorById((prev) => ({ ...prev, __insert: message }))
    }
  }

  async function handleDuplicate(block: NotebookBlockData) {
    try {
      await onDuplicateBlock(block)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not duplicate the block.'
      setErrorById((prev) => ({ ...prev, [block.id]: message }))
    }
  }

  async function handleConfirmDelete() {
    if (!confirmDelete) return
    setPendingDelete(true)
    try {
      await onDeleteBlock(confirmDelete)
      setUndo({
        type: confirmDelete.type,
        payload: confirmDelete.payload,
        afterBlockId: null,
        label: `${confirmDelete.type} block`,
      })
      setConfirmDelete(null)
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
      await onUndoDelete(undo.type, undo.payload, undo.afterBlockId)
      setUndo(null)
    } catch {
      // If undo fails the user can still insert manually.
      setUndo(null)
    }
  }

  const isReadOnly = readOnly || record.archivedAt !== null

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
      if (el && typeof el.focus === 'function') {
        el.focus()
      } else if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ block: 'nearest' })
      }
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
      // Roll back to the exact pre-move order and surface a contextual error.
      setOptimisticOrder(baseline)
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

  function handleRowKeyDown(
    e: React.KeyboardEvent<HTMLDivElement>,
    block: NotebookBlockData,
  ) {
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
    <div className={cn('space-y-3', className)}>
      {orderedIds.map((id, index) => {
        const block = blockById.get(id)
        if (!block) return null
        const editable = EDITABLE_TYPES.has(block.type) && !isReadOnly
        const isSelected = selectedId === block.id
        const isDragging = draggingId === block.id
        const isMoving = movingId === block.id
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
            : isSelected
              ? 'editing'
              : 'default'
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
                isMoving && 'opacity-60',
              )}
              tabIndex={canMove ? 0 : undefined}
              role={canMove ? 'group' : undefined}
              aria-label={
                canMove
                  ? `${block.type} block — drag or use Alt+Arrow keys to move`
                  : undefined
              }
              onFocus={() => selectBlock(block)}
              onClick={() => selectBlock(block)}
              onKeyDown={(e) => handleRowKeyDown(e, block)}
              onDragOver={(e) => handleDragOver(e, block)}
              onDragEnter={(e) => {
                if (draggingId && draggingId !== block.id) e.preventDefault()
              }}
              onDrop={(e) => handleDrop(e)}
            >
              <NotebookBlock
                label={blockLabel(block.type)}
                state={blockState}
                ariaLabel={`${block.type} block`}
                draggable={canMove}
                onDragStart={(e) => handleDragStart(e, block)}
                onDragEnd={handleDragEnd}
                menuItems={
                  isReadOnly
                    ? undefined
                    : [
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
                        ...(block.type === 'sheet'
                          ? []
                          : [
                              {
                                id: 'duplicate',
                                label: 'Duplicate',
                                onSelect: () => handleDuplicate(block),
                              },
                            ]),
                        ...(block.type === 'sheet'
                          ? []
                          : [
                              {
                                id: 'delete',
                                label: 'Delete',
                                onSelect: () => setConfirmDelete(block),
                                separatorAfter: true,
                              },
                            ]),
                      ]
                }
              >
                {block.type === 'sheet' ? (
                  <ScientificSheetBlock block={block} readOnly={isReadOnly} />
                ) : editable ? (
                  <BlockEditor
                    block={block}
                    save={(payload) => onSaveBlock(block, payload)}
                    offline={offline}
                    onStatusChange={(status) =>
                      handleStatusChange(block.id, status)
                    }
                    readOnly={isReadOnly}
                    autoFocus={isSelected}
                  />
                ) : (
                  <BlockPreview block={block} />
                )}
              </NotebookBlock>
              {moveError && moveError.blockId === block.id ? (
                <p
                  role="alert"
                  className="mt-1 px-1 text-xs text-destructive"
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
          </React.Fragment>
        )
      })}

      {errorById.__insert ? (
        <p role="alert" className="text-xs text-destructive">
          {errorById.__insert}
        </p>
      ) : null}

      {isReadOnly ? null : (
        <BlockPicker
          onInsert={(type) => void handleInsert(type)}
          disabled={false}
          label="Add block"
        />
      )}

      {undo ? (
        <div
          role="status"
          className="flex items-center gap-3 rounded-md border bg-muted/40 px-3 py-2 text-xs"
        >
          <span>Block deleted.</span>
          {onUndoDelete ? (
            <button
              type="button"
              onClick={() => void handleUndo()}
              className="font-medium text-primary underline"
            >
              Undo
            </button>
          ) : null}
        </div>
      ) : null}

      <AlertDialog
        open={confirmDelete !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this block?</AlertDialogTitle>
            <AlertDialogDescription>
              The block will be removed from the notebook. You can undo
              immediately after deleting.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pendingDelete}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleConfirmDelete()}
              disabled={pendingDelete}
            >
              {pendingDelete ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function blockLabel(type: string): string {
  const map: Record<string, string> = {
    heading: 'Heading',
    rich_text: 'Text',
    checklist: 'Checklist',
    list: 'List',
    callout: 'Callout',
    linked_record: 'Linked record',
    table: 'Table',
    sheet: 'Sheet',
    chart: 'Chart',
    plate_map: 'Plate map',
    file: 'File',
    metric: 'Metric',
    procedure_step: 'Procedure step',
  }
  return map[type] ?? type
}
