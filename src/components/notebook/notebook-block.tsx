import { t } from '#/copy'
import * as React from 'react'

import { cn } from '#/lib/utils'
import { Button } from '#/components/v3/ui/button'
import { Skeleton } from '#/components/v3/ui/skeleton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/v3/ui/dropdown-menu'
import { Icon } from '#/components/v3/icons'

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
   * The gutter handle itself, for a caller that owns how a row is picked up.
   * The notebook passes `NotebookBlockHandle`, which is the sortable item's
   * own handle and carries its drag listeners; when this is given, `draggable`
   * and the built-in button are not used.
   */
  handle?: React.ReactNode
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
  /**
   * This block is a member of a multi-row prose run. The frame is removed so
   * the run reads as one column: no state ring, no vertical padding and no
   * title row. The hover gutter handle and the overflow menu stay, because
   * they are how the row is reordered, duplicated and commented.
   */
  continuous?: boolean
}

/**
 * The row's state treatment.
 *
 * A selected or edited block does **not** change colour. Notion's convention,
 * and the one that keeps work dominant over chrome: while you are writing in a
 * callout, the callout is still a callout — the field you are in, the caret and
 * the hover-revealed handle already say which block is active. A tinted ring
 * around it puts a blue box around the work instead.
 *
 * The states that do paint are the ones with something to say: dragging,
 * invalid and locked. Keyboard focus is separate, and stays visible through
 * `focus-visible` on the row.
 */
const stateRing: Record<NotebookBlockState, string> = {
  default: 'bg-transparent',
  selected: 'bg-transparent',
  editing: 'bg-transparent',
  dragging: 'bg-surface opacity-60 shadow-sm ring-1 ring-inset ring-primary/50',
  invalid: 'ring-1 ring-inset ring-destructive/60',
  locked: 'bg-surface-muted/20',
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
  handle,
  onDragStart,
  onDragEnd,
  actions,
  menuItems,
  menuExtra,
  className,
  ariaLabel,
  continuous = false,
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
        'group relative',
        // A prose run member contributes no frame of its own: the run is one
        // column, so a ring or a vertical gap here would re-create the seams
        // the run exists to hide.
        continuous ? 'py-0' : 'py-1 transition-[background-color,box-shadow]',
        !continuous && stateRing[state],
        className,
      )}
      aria-label={ariaLabel}
      data-block-type={label}
      data-state={state}
      data-continuous={continuous || undefined}
    >
      {/* Left-margin grip handle, rendered at every width.
          It is the row's single drag control: a pointer or touch drag starts
          here through the sortable item's listeners, and the keyboard sensor
          lifts it from the same element. Below `lg` the row carries this gutter
          itself (`NotebookBlockRow`'s leading padding), because the page margin
          there is not wide enough to hold it.
          Clicking the grip opens the block actions menu; dragging it reorders
          the block. A pointer drag leaves no click behind, because the sortable
          item's sensor stops it once the drag is under way, so the two
          interactions do not conflict. Positioned in the negative left margin so
          it doesn't indent the content, and it joins the print-hide set with the
          rest of the row's chrome. */}
      {handle || draggable ? (
        <div
          data-print-hide
          onClick={() => {
            if (hasMenu) setMenuOpen(true)
          }}
          className="absolute -left-8 top-2 flex w-7 items-center justify-center"
        >
          {handle ?? (
            <button
              type="button"
              aria-label={t('notebook.notebookBlock.ariaLabel')}
              draggable
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              className="cursor-grab rounded p-0.5 text-fg-muted opacity-0 outline-none transition-opacity focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100 active:cursor-grabbing"
            >
              <Icon name="move" size={14} />
            </button>
          )}
        </div>
      ) : null}

      {/* Right-edge hover toolbar — no overlap with content */}
      <div
        data-slot="block-toolbar"
        data-print-hide
        className="pointer-events-none absolute right-1 top-1 z-10 flex items-center gap-1"
      >
        <div className="pointer-events-auto flex items-center gap-1">
          {actions}
          {locked ? (
            <Icon
              name="lock"
              size={14}
              className="text-fg-muted"
              aria-label={t('notebook.notebookBlock.blockLockedAriaLabel')}
            />
          ) : null}
          {invalid ? (
            <Icon
              name="warn"
              size={14}
              className="text-danger-text"
              aria-label={t('notebook.notebookBlock.blockHasErrorsAriaLabel')}
            />
          ) : null}
          {hasMenu ? (
            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="quiet"
                    size="icon"
                    aria-label={t(
                      'notebook.notebookBlock.blockActionsAriaLabel',
                    )}
                    className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                    icon="more"
                  />
                }
              />
              <DropdownMenuContent align="end">
                {menuExtra}
                {menuItems?.map((item) => (
                  <React.Fragment key={item.id}>
                    <DropdownMenuItem
                      onClick={item.onSelect}
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

      {continuous ? null : isEditing ? (
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
          placeholder={t('common.states.untitled')}
          className="mb-1 w-full border-0 bg-transparent p-0 font-display text-sm font-semibold text-fg outline-none placeholder:text-fg-muted/40 focus:ring-0"
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
