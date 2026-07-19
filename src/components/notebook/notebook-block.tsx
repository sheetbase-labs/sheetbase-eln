import * as React from 'react'
import { GripVertical, Lock, MoreHorizontal, TriangleAlert } from 'lucide-react'

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
 * (heading, paragraph, table, chart, plate map, …). It is presentational
 * only; notebook persistence (order, content, saving) lives in the route,
 * not here (UI-006).
 *
 * States: default, selected, editing, dragging, invalid, locked, loading
 * and read-only. Drag handle and action menu are focusable buttons so
 * keyboard users can reach them; they become visible on hover/focus rather
 * than being mouse-only.
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
  /** Block type tag, e.g. "H2", "Paragraph", "Table". */
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
  default: 'border-border',
  selected: 'border-primary ring-2 ring-primary/40',
  editing: 'border-primary ring-2 ring-primary',
  dragging: 'border-primary/60 opacity-60 shadow-md',
  invalid: 'border-destructive/70 ring-2 ring-destructive/40',
  locked: 'border-border bg-muted/30',
  loading: 'border-border',
  'read-only': 'border-border bg-muted/20',
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

  return (
    <div
      className={cn(
        'group relative rounded-lg border bg-card p-4 shadow-xs transition-shadow focus-within:shadow-sm',
        stateRing[state],
        className,
      )}
      aria-label={ariaLabel}
      data-state={state}
    >
      {/* Drag handle — focusable, visible on hover/focus, keyboard-operable */}
      {draggable ? (
        <div className="absolute -left-7 top-4 hidden items-center lg:flex">
          <button
            type="button"
            aria-label="Drag block"
            draggable
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            className="cursor-grab rounded p-1 text-muted-foreground opacity-0 outline-none transition-opacity focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100 active:cursor-grabbing"
          >
            <GripVertical className="size-4" />
          </button>
        </div>
      ) : null}

      <div className="mb-3 flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        {title ? (
          <h3 className="min-w-0 flex-1 truncate font-display text-sm font-semibold">
            {title}
          </h3>
        ) : (
          <span className="flex-1" />
        )}
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
        <div className="ml-auto flex items-center gap-1">
          {actions}
          {menuItems && menuItems.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Block actions"
                  className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {menuItems.map((item) => (
                  <React.Fragment key={item.id}>
                    <DropdownMenuItem
                      onSelect={item.onSelect}
                      disabled={item.disabled || readOnly}
                    >
                      {item.label}
                    </DropdownMenuItem>
                    {item.separatorAfter ? <DropdownMenuSeparator /> : null}
                  </React.Fragment>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>

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
