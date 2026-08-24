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
  /** Visible, user-editable title for the block. When empty/undefined,
   * no heading is rendered and no space is consumed. */
  title?: string
  /** Called when the user edits the title (blur/Enter). When provided,
   * the title renders as an editable input in editing state. */
  onTitleChange?: (title: string) => void
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
  /** Extra menu nodes (for example an Insert below submenu). */
  menuExtra?: React.ReactNode
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
  onTitleChange,
  children,
  state = 'default',
  draggable = false,
  onDragStart,
  onDragEnd,
  actions,
  menuItems,
  menuExtra,
  className,
  ariaLabel,
}: NotebookBlockProps) {
  const locked = state === 'locked'
  const readOnly = state === 'read-only' || locked
  const invalid = state === 'invalid'
  const loading = state === 'loading'
  const hasMenu = (!!menuItems && menuItems.length > 0) || menuExtra != null
  const [menuOpen, setMenuOpen] = React.useState(false)
  const isEditing = state === 'editing' && !!onTitleChange
  const [titleDraft, setTitleDraft] = React.useState(title ?? '')
  const titleInputRef = React.useRef<HTMLInputElement>(null)

  // Sync local draft when the prop changes externally (e.g. after save round-trip)
  React.useEffect(() => {
    setTitleDraft(title ?? '')
  }, [title])

  function commitTitle() {
    const trimmed = titleDraft.trim()
    if (trimmed !== (title ?? '')) {
      onTitleChange!(trimmed)
    }
  }

  return (
    <div
      className={cn(
        'group relative py-1 transition-[background-color,box-shadow]',
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
          not conflict. Positioned in the negative left margin so it
          doesn't indent the content. */}
      <div className="absolute -left-8 top-2 hidden w-7 items-center justify-center lg:flex">
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
      <div
        data-slot="block-toolbar"
        data-print-hide
        className="pointer-events-none absolute right-1 top-1 z-10 flex items-center gap-1"
      >
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
                {menuExtra}
                {menuItems?.map((item) => (
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

      {isEditing ? (
        <input
          ref={titleInputRef}
          type="text"
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              titleInputRef.current?.blur()
            }
          }}
          placeholder="Untitled"
          className="mb-1 w-full border-0 bg-transparent p-0 font-display text-sm font-semibold text-foreground outline-none placeholder:text-muted-foreground/40 focus:ring-0"
        />
      ) : title ? (
        <h3 className="mb-1 font-display text-sm font-semibold">{title}</h3>
      ) : null}

      {loading ? (
        <div className="space-y-2" aria-busy="true" aria-live="polite">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : (
        <div className={cn(readOnly && 'select-none')}>{children}</div>
      )}
    </div>
  )
}
