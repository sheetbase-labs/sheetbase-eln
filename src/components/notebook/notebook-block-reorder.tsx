import * as React from 'react'

import { Icon } from '#/components/v3/icons'
import {
  Sortable,
  SortableItem,
  SortableItemHandle,
} from '#/components/reui/sortable'
import { cn } from '#/lib/utils'
import { NotebookBlock } from './notebook-block'
import type { NotebookBlockProps } from './notebook-block'

/**
 * Notebook list reordering (ELN-006).
 *
 * The notebook reorders its blocks with the vendored ReUI `Sortable`
 * (`src/components/reui/sortable.tsx`, a `@dnd-kit` wrapper, installed from the
 * base-nova registry — see ADR-0055 and
 * `docs/knowledge/design/component-comparison-record.md` row 1). This module is
 * the notebook's end of it: the row and its handle, the list that binds a drop
 * to the notebook's own move contract, and the move maths the caller's
 * optimistic writer needs.
 *
 * It is a module rather than inline code because a second surface drives it:
 * the component-comparison harness
 * (`src/components/component-compare/pairs/notebook-sortable.tsx`) renders the
 * notebook's list beside the registry item it was measured against. An A/B
 * argument has to be measured against the code that ships, not a copy of it, so
 * both surfaces render these.
 *
 * Three input paths land in the same `onMove(itemId, targetIndex)` callback:
 *
 * - pointer and touch: `@dnd-kit`'s sensors on the row's handle — the only
 *   route a touchscreen has, and the reason the handle is rendered at every
 *   width rather than from `lg` up;
 * - keyboard: the same handle. Enter or Space lifts the row, the arrow keys
 *   move it, Enter or Space drops it, and `@dnd-kit` announces the row it is
 *   over;
 * - Alt+arrow from the focused row, and the block menu's Move up/down, which
 *   are the same call: `moveTargetIndex` then `onMove`.
 *
 * The list owns no ordering and no persistence. It reports the index a drop
 * resolved to; the caller decides what a move means and clamps what it receives.
 */

/** The neighbours a move would land between, used for both the no-op check
 * and the RPC destination. `beforeBlockId` null means end of list. */
export interface DropNeighbours {
  afterBlockId: string | null
  beforeBlockId: string | null
}

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
 * The index one position up or down lands at, in the same convention
 * `neighboursForTarget` takes: an index into the ordering with the moved item
 * removed. Null at the top and bottom edges, where there is nowhere to go.
 * The Alt+arrow path and the menu's Move up/down are the same call.
 */
export function moveTargetIndex(
  ids: readonly string[],
  itemId: string,
  direction: 'up' | 'down',
): number | null {
  const index = ids.indexOf(itemId)
  if (index < 0) return null
  const target = direction === 'up' ? index - 1 : index + 1
  if (target < 0 || target >= ids.length) return null
  return target
}

/**
 * `Sortable` requires `onValueChange`, but the notebook never uses it: the
 * order is the route's canonical `blocks` plus an optimistic override the
 * caller holds, so it is never the list's local state. `onMove` is the whole
 * contract. Module-scoped so its identity is stable.
 */
const ignoreValueChange = () => {}

export interface NotebookBlockListProps {
  /** The effective ordering, excluding optimistic overrides the caller owns. */
  ids: readonly string[]
  /** Called with the item to move and the index it lands at, unclamped. */
  onMove: (itemId: string, targetIndex: number) => void
  /**
   * The item being dragged, or null when nothing is. A drag that is cancelled
   * reports null too, so a caller can never be left holding a stale row.
   */
  onDraggingChange?: (itemId: string | null) => void
  className?: string
  children: React.ReactNode
}

/**
 * The notebook's block list: the vendored `Sortable` bound to the notebook's
 * move contract.
 *
 * The rows are our own components rather than bare `SortableItem`s, and that is
 * deliberate. The item clones the dragged child into its overlay portal when
 * the child *is* a `SortableItem`; a notebook row holds a live editor, and for
 * a sheet block a canonical sheet grid, so the clone would mount a second one.
 * The drag is shown instead by the item's own dimming and by the movement
 * transforms on the rows around it.
 */
export function NotebookBlockList({
  ids,
  onMove,
  onDraggingChange,
  className,
  children,
}: NotebookBlockListProps) {
  const value = React.useMemo(() => Array.from(ids), [ids])
  return (
    <Sortable
      value={value}
      onValueChange={ignoreValueChange}
      getItemValue={(itemId: string) => itemId}
      strategy="vertical"
      onMove={({ activeIndex, overIndex }) => {
        // `overIndex` indexes the ordering *including* the dragged row, and
        // `neighboursForTarget` inserts at an index in the ordering *without*
        // it. For a move within one list the two conventions agree, so the
        // index passes through as-is.
        const movedId = ids.at(activeIndex)
        if (movedId === undefined) return
        onMove(movedId, overIndex)
      }}
      onDragStart={(event) => onDraggingChange?.(String(event.active.id))}
      onDragEnd={() => onDraggingChange?.(null)}
      onDragCancel={() => onDraggingChange?.(null)}
      className={className}
    >
      {children}
    </Sortable>
  )
}

export interface NotebookBlockHandleProps {
  /** The handle's accessible name. */
  label?: string
  className?: string
}

/**
 * The row's grip: the vendored `SortableItemHandle` rendered as a real button,
 * wearing the notebook's hover reveal.
 *
 * A real button is what makes `@dnd-kit`'s keyboard sensor reachable at all —
 * the item's default handle is a non-focusable `div` — and `NotebookBlockRow`
 * takes the item's widget role and tab stop off the row container, so this
 * handle is the row's single drag control. Enter and Space lift the row here,
 * which is why the block menu is opened from the row's own "Block actions"
 * button or from a pointer click on the grip; `@dnd-kit` prevents the default
 * that would have activated the button, and stops the click that a pointer drag
 * would otherwise leave behind.
 */
export function NotebookBlockHandle({
  label = 'Drag block',
  className,
}: NotebookBlockHandleProps) {
  return (
    <SortableItemHandle
      render={<button type="button" />}
      aria-label={label}
      className={cn(
        'rounded p-0.5 text-fg-muted transition-opacity focus-visible:ring-2 focus-visible:ring-ring',
        // Hover-revealed only where a hover exists. A touchscreen cannot
        // hover, and the grip is its only route to a reorder, so there it is
        // simply visible — which is why the reveal is gated on the pointer
        // rather than on a width. Note that Tailwind's own `hover:` variant is
        // already hover-capability-scoped; `group-hover:` is not.
        'pointer-fine:opacity-0 pointer-fine:focus-visible:opacity-100 pointer-fine:group-hover:opacity-100',
        className,
      )}
    >
      <Icon name="move" size={14} />
    </SortableItemHandle>
  )
}

export interface NotebookBlockRowProps {
  /** Row identity: the block id (a fixture row id in the harness). */
  itemId: string
  /** This row can be picked up, moved and dropped. */
  enabled: boolean
  /**
   * The row element's own props: its anchor id, its accessible name and
   * shortcut hint, its `data-*`, and the document's focus, click and keyboard
   * handlers. They are applied *over* the item's defaults — the vendored item
   * puts `@dnd-kit`'s widget role and tab stop on the row container while the
   * drag listeners sit on the handle inside it, and a notebook row is a
   * labelled group, not a button. That override is condition C1 of the
   * adoption, recorded in `docs/knowledge/design/component-comparison-record.md`.
   */
  row?: React.ComponentProps<'div'> & {
    /** The notebook's row markers: `data-prose-run`, `data-active`, … */
    [key: `data-${string}`]: unknown
  }
  /** The row's frame, minus the handle and the children. */
  frame: Omit<
    NotebookBlockProps,
    'children' | 'handle' | 'draggable' | 'onDragStart' | 'onDragEnd'
  >
  /**
   * The gutter handle. Omit it for a row with no reorder affordance — the
   * underlying item is disabled then, so nothing can pick the row up.
   */
  handle?: React.ReactNode
  children: React.ReactNode
}

/**
 * One row: the vendored sortable item wearing the notebook's row semantics,
 * with the notebook's own frame inside it.
 *
 * `aria-disabled` and `aria-pressed` are cleared from the item's defaults: both
 * describe a widget, and this row is a labelled group. A row that cannot move
 * renders no handle, so there is no disabled state to announce here, and the
 * drag is announced by `@dnd-kit`'s own live region.
 */
export function NotebookBlockRow({
  itemId,
  enabled,
  row,
  frame,
  handle,
  children,
}: NotebookBlockRowProps) {
  const { className, ...rowProps } = row ?? {}
  return (
    <SortableItem
      value={itemId}
      disabled={!enabled}
      render={<div />}
      aria-disabled={undefined}
      aria-pressed={undefined}
      {...rowProps}
      className={cn(
        'scroll-mt-28 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring',
        // The grip lives in the row's negative left margin, as Notion's does.
        // Below `lg` there is no page margin to put it in — the shell's rail
        // is 24px from the row's edge — so the row carries that space itself
        // and the grip sits inside it. Printing has one column and no handle,
        // so it keeps none of it.
        handle && 'pl-7 print:pl-0 lg:pl-0',
        className,
      )}
    >
      <NotebookBlock {...frame} handle={handle}>
        {children}
      </NotebookBlock>
    </SortableItem>
  )
}
