import * as React from 'react'
import {
  EllipsisVertical,
  GripVertical,
  Lock,
  TriangleAlert,
} from 'lucide-react'

import { cn } from '#/lib/utils'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Skeleton,
} from '#/components/ui'

/**
 * NotebookBlock — a composable visual frame for one block in a notebook
 * (structured prose, table, chart, plate map, …). It is presentational
 * only; notebook persistence (order, content, saving) lives in the route,
 * not here (UI-006).
 *
 * States: default, selected, editing, dragging, invalid, locked, loading
 * and read-only. Drag handle and action menu are focusable buttons so
 * keyboard users can reach them; they become visible on hover/focus rather
 * than being mouse-only.
 *
 * The drag handle (six-dots grip icon) also serves as a click target for
 * the block actions menu — a Notion-style pattern where clicking the handle
 * opens Delete / Duplicate / Move up / Move down.
 */

export type NotebookBlockState =
  | 'default'
  | 'selected'
  | 'editing'
  | 'dragging'
  | 'invalid'
  | 'locked'
  | 'loading'
  | 'read-only'

export interface NotebookBlockProps {
  /** Block type tag, e.g. "Text", "Table", "Chart". */
  label: string
  title?: string
  children: React.ReactNode
  state?: NotebookBlockState
  /** Drag handle affordance. Focusable; aria-label customisable. */
  draggable?: boolean
  /**
   * Native drag event forwarded from the handle so the owning document can
   * set dataTransfer and a drag image (ELN-006). Older `() => void` callers
   * still work — the event is an extra argument they can ignore.
   */
  onDragStart?: (event: React.DragEvent<HTMLButtonElement>) => void
  /** Fired when the OS drag ends (including cancelled drops) so the owner
   * can clear drag/drop-target state. */
  onDragEnd?: (event: React.DragEvent<HTMLButtonElement>) => void
  /** Action buttons rendered in the header (e.g. "Edit", "Insert below"). */
  actions?: React.ReactNode
  /** Overflow menu items (rendered as a DropdownMenu). */
  menuItems?: {
    id: string
    label: string
    onSelect?: () => void
    disabled?: boolean
    separatorAfter?: boolean
  }[]
  className?: string
  /** Accessible label for the block region. */
  ariaLabel?: string
}

const stateRing: Record<NotebookBlockState, string> = {
  default: 'bg-transparent',
  selected: 'bg-primary/[0.015]',
  editing: 'bg-primary/[0.015]',
  dragging: 'bg-background opacity-60 shadow-sm',
  invalid: 'ring-1 ring-inset ring-destructive/60',
  locked: 'bg-muted/20',
  loading: 'bg-transparent',
  'read-only': 'bg-transparent',
}

export function NotebookBlock({
  label,
  title,
  children,
  state = 'default',
  draggable = false,
  onDragStart,
  onDragEnd,
  actions,
  menuItems,
  className,
  ariaLabel,
}: NotebookBlockProps) {
  const locked = state === 'locked'
  const readOnly = state === 'read-only' || locked
  const invalid = state === 'invalid'
  const loading = state === 'loading'
  const hasMenu = !!menuItems && menuItems.length > 0
  const [menuOpen, setMenuOpen] = React.useState(false)

  return (
    <div
      className={cn(
        'group relative px-4 py-3 transition-[background-color,box-shadow] sm:px-6 lg:pl-12',
        stateRing[state],
        className,
      )}
      aria-label={ariaLabel}
      data-block-type={label}
      data-state={state}
    >
      {/* Left-margin drag handle (visible on desktop).
          Clicking the handle opens the block actions menu; dragging it
          reorders the block. HTML5 drag-and-drop suppresses the click
          event when a drag actually starts, so the two interactions do
          not conflict. */}
      <div className="absolute left-1 top-3 hidden w-8 items-center lg:flex">
        {draggable ? (
          <button
            type="button"
            aria-label="Drag block"
            draggable
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onClick={() => hasMenu && setMenuOpen(true)}
            className="cursor-grab rounded p-0.5 text-muted-foreground opacity-0 outline-none transition-opacity focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100 active:cursor-grabbing"
          >
            <GripVertical className="size-3.5" />
          </button>
        ) : null}
      </div>

      {/* Right-edge hover toolbar — no overlap with content */}
      <div className="pointer-events-none absolute right-1 top-1 z-10 flex items-center gap-1">
        <div className="pointer-events-auto flex items-center gap-1">
          {actions}
          {locked ? (
            <Lock
              className="size-3.5 text-muted-foreground"
              aria-label="Block locked"
            />
          ) : null}
          {invalid ? (
            <TriangleAlert
              className="size-3.5 text-destructive"
              aria-label="Block has errors"
            />
          ) : null}
          {hasMenu ? (
            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Block actions"
                  className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <EllipsisVertical />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {menuItems!.map((item) => (
                  <React.Fragment key={item.id}>
                    <DropdownMenuItem
                      onSelect={item.onSelect}
                      disabled={item.disabled || readOnly}
                    >
                      {item.label}
                    </DropdownMenuItem>
                    {item.separatorAfter ? (
                      <DropdownMenuSeparator />
                    ) : null}
                  </React.Fragment>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>

      {title ? (
        <h3 className="mb-1 font-display text-sm font-semibold">
          {title}
        </h3>
      ) : null}

      {loading ? (
        <div className="space-y-2" aria-busy="true" aria-live="polite">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : (
        <div className={cn(readOnly && 'pointer-events-none select-none')}>
          {children}
        </div>
      )}
    </div>
  )
}
