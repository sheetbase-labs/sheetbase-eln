import * as React from 'react'

/**
 * Notebook list reordering (ELN-006).
 *
 * These mechanics lived inline in `notebook-document.tsx`. They are extracted
 * here because a second surface now drives them: the component-comparison
 * harness (`src/routes/component-compare.tsx`) renders this list beside the
 * candidate that would replace it. An A/B argument has to be measured against
 * the code that ships, not a copy of it, so both surfaces share this module.
 *
 * Two input paths land in the same `onMove(itemId, targetIndex)` callback:
 *
 * - pointer: native HTML5 drag-and-drop, started at a row's handle
 *   (`handleProps`) and resolved on another row (`rowProps`) by comparing the
 *   pointer's Y with that row's midpoint;
 * - keyboard: alt+arrow, which moves the focused item by one position
 *   (`moveByOne`).
 *
 * The hook owns only what both paths share: what is being dragged, which gap
 * carries the insertion indicator, and the index a drop resolves to. It never
 * touches persistence or ordering — the caller decides what a move means, and
 * clamps the index it receives.
 */

/** The neighbours a move would land between, used for both the no-op check
 * and the insertion indicator. `beforeBlockId` null means end of list. */
export interface DropNeighbours {
  afterBlockId: string | null
  beforeBlockId: string | null
}

/** Which side of one row the insertion indicator belongs on, if any. */
export type DropIndicator = 'above' | 'below' | null

/**
 * Compute the (afterBlockId, beforeBlockId) neighbours for moving `itemId` to
 * `targetIndex` within `ids`. Dropping at index 0 → (null, first); at the end →
 * (last, null); otherwise (ids[targetIndex-1], ids[targetIndex]). The moved
 * item is excluded from the neighbour candidates so a no-op move resolves
 * cleanly.
 */
export function neighboursForTarget(
  ids: readonly string[],
  itemId: string,
  targetIndex: number,
): DropNeighbours {
  const others = ids.filter((id) => id !== itemId)
  const clamped = Math.max(0, Math.min(targetIndex, others.length))
  const afterBlockId = clamped > 0 ? (others[clamped - 1] ?? null) : null
  const beforeBlockId =
    clamped < others.length ? (others[clamped] ?? null) : null
  return { afterBlockId, beforeBlockId }
}

/**
 * Resolve the index a drop lands at, from the neighbours recorded during the
 * preceding `dragover`. The index is not clamped: `-1` means the recorded
 * neighbour is no longer in the ordering, and callers clamp as they do for any
 * other target. Recomputing from the drop event's `clientY` would be redundant
 * — the OS fires `drop` at the same position as the last `dragover` — and
 * unreliable in jsdom, which zeroes bounding rects.
 */
export function targetIndexForDrop(
  ids: readonly string[],
  itemId: string,
  dropTarget: DropNeighbours,
): number {
  const others = ids.filter((id) => id !== itemId)
  if (dropTarget.beforeBlockId !== null) {
    return others.indexOf(dropTarget.beforeBlockId)
  }
  if (dropTarget.afterBlockId !== null) {
    return others.indexOf(dropTarget.afterBlockId) + 1
  }
  return others.length
}

/**
 * Show exactly one insertion indicator per gap: "above" when this row is the
 * following neighbour, and "below" only for the end-of-list position
 * (after=row, before=null) where no following row exists to carry the "above"
 * indicator.
 */
export function dropIndicatorFor(
  dropTarget: DropNeighbours | null,
  itemId: string,
): DropIndicator {
  if (!dropTarget) return null
  if (dropTarget.beforeBlockId === itemId) return 'above'
  if (dropTarget.afterBlockId === itemId && dropTarget.beforeBlockId === null) {
    return 'below'
  }
  return null
}

/** The insertion indicator itself: one shape in both consumers. */
export function DropIndicatorLine({
  position,
}: {
  position: 'above' | 'below'
}) {
  return (
    <div
      aria-hidden="true"
      className="h-0.5 rounded-full bg-primary/70"
      data-drop-indicator={position}
    />
  )
}

/** Handle props: spread onto the element a user picks up to drag a row. */
export interface ReorderHandleProps {
  draggable: boolean
  onDragStart: (event: React.DragEvent<HTMLElement>) => void
  onDragEnd: () => void
}

/** Row props: spread onto the element a drop lands on. */
export interface ReorderRowProps {
  onDragOver: (event: React.DragEvent<HTMLElement>) => void
  onDragEnter: (event: React.DragEvent<HTMLElement>) => void
  onDrop: (event: React.DragEvent<HTMLElement>) => void
}

export interface UseNotebookBlockReorderOptions {
  /** The effective ordering, excluding optimistic overrides the caller owns. */
  ids: readonly string[]
  /** Reordering is offered (not read-only, more than one row, a move handler). */
  enabled: boolean
  /** Called with the item to move and the index it lands at, unclamped. */
  onMove: (itemId: string, targetIndex: number) => void
}

export interface NotebookBlockReorder {
  /** The row currently being dragged, or null. */
  draggingId: string | null
  /** The gap the in-flight drag would land in, or null. */
  dropTarget: DropNeighbours | null
  /** Handle and row props for one row, bound to that row's id. */
  handleProps: (itemId: string) => ReorderHandleProps
  rowProps: (itemId: string) => ReorderRowProps
  /** Alt+arrow path: move the focused row one position. */
  moveByOne: (itemId: string, direction: 'up' | 'down') => void
}

export function useNotebookBlockReorder({
  ids,
  enabled,
  onMove,
}: UseNotebookBlockReorderOptions): NotebookBlockReorder {
  const [draggingId, setDraggingId] = React.useState<string | null>(null)
  const [dropTarget, setDropTarget] = React.useState<DropNeighbours | null>(
    null,
  )

  function handleProps(itemId: string): ReorderHandleProps {
    return {
      draggable: enabled,
      onDragStart: (event) => {
        if (!enabled) return
        setDraggingId(itemId)
        try {
          event.dataTransfer.effectAllowed = 'move'
          // Firefox requires data to be set or no drag fires at all.
          event.dataTransfer.setData('text/plain', itemId)
        } catch {
          /* jsdom: dataTransfer may be a stub */
        }
      },
      onDragEnd: () => {
        setDraggingId(null)
        setDropTarget(null)
      },
    }
  }

  function rowProps(itemId: string): ReorderRowProps {
    return {
      /**
       * As the pointer moves over a row, decide whether the drop would land
       * above or below it based on the pointer's Y relative to the row's
       * midpoint, and nudge the window to auto-scroll near the viewport edge.
       */
      onDragOver: (event) => {
        if (!enabled || !draggingId || draggingId === itemId) return
        event.preventDefault()
        try {
          event.dataTransfer.dropEffect = 'move'
        } catch {
          /* jsdom */
        }
        const rect = event.currentTarget.getBoundingClientRect()
        const before = event.clientY < rect.top + rect.height / 2
        // The hovered row's index in `others` differs from its index in `ids`
        // when the dragged row sat above it, so derive it from `others`.
        const others = ids.filter((id) => id !== draggingId)
        const hoverIdxInOthers = others.indexOf(itemId)
        const target = before ? hoverIdxInOthers : hoverIdxInOthers + 1
        setDropTarget(neighboursForTarget(ids, draggingId, target))
        // Auto-scroll near the viewport edges so long lists stay reachable.
        const margin = 64
        if (typeof window.scrollBy === 'function') {
          if (event.clientY < margin) {
            window.scrollBy(0, -10)
          } else if (event.clientY > window.innerHeight - margin) {
            window.scrollBy(0, 10)
          }
        }
      },
      onDragEnter: (event) => {
        if (draggingId && draggingId !== itemId) event.preventDefault()
      },
      onDrop: (event) => {
        if (!draggingId) return
        event.preventDefault()
        // Use the target computed during the preceding dragOver: if the
        // pointer never entered a row, there is no drop target and the drop
        // is ignored.
        if (!dropTarget) return
        const movedId = draggingId
        setDropTarget(null)
        setDraggingId(null)
        if (!ids.includes(movedId)) return
        onMove(movedId, targetIndexForDrop(ids, movedId, dropTarget))
      },
    }
  }

  function moveByOne(itemId: string, direction: 'up' | 'down') {
    if (!enabled) return
    const idx = ids.indexOf(itemId)
    if (idx < 0) return
    const target = direction === 'up' ? idx - 1 : idx + 1
    if (target < 0 || target >= ids.length) return
    onMove(itemId, target)
  }

  return { draggingId, dropTarget, handleProps, rowProps, moveByOne }
}
