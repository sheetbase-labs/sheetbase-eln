import * as React from 'react'

import { BLOCK_PICKER_OPTIONS } from './block-picker'
import { cn } from '#/lib/utils'

/**
 * Slash command menu — a Notion-style floating dropdown that appears when
 * the user types `/` at the start of an empty paragraph in a rich-text
 * block. Filters block types as the user types, supports arrow-key
 * navigation, Enter to select, and Escape to close.
 *
 * The menu is purely presentational: it renders the filtered options and
 * reports the selected type via `onSelect`. All keyboard handling
 * (Arrow/Enter/Escape) is driven by the parent editor, which owns the
 * `selectedIndex` and calls `onSelect` / `onClose`.
 */
export interface SlashCommandMenuProps {
  query: string
  selectedIndex: number
  onSelect: (type: string) => void
  /** Style override for the floating container (position). */
  style?: React.CSSProperties
  /** Called when the pointer enters an item, so the parent can update
   *  `selectedIndex` for hover-to-highlight (Notion-style). */
  onHoverIndex?: (index: number) => void
}

export function SlashCommandMenu({
  query,
  selectedIndex,
  onSelect,
  style,
  onHoverIndex,
}: SlashCommandMenuProps) {
  const filtered = React.useMemo(() => {
    const q = query.toLowerCase().trim()
    if (!q) return BLOCK_PICKER_OPTIONS
    return BLOCK_PICKER_OPTIONS.filter(
      (opt) =>
        opt.label.toLowerCase().includes(q) ||
        opt.type.toLowerCase().includes(q),
    )
  }, [query])

  if (filtered.length === 0) {
    return (
      <div
        className="z-50 w-64 rounded-lg border bg-popover p-3 text-sm text-muted-foreground shadow-md"
        style={style}
        role="listbox"
        aria-label="Block types"
      >
        No matching block types
      </div>
    )
  }

  return (
    <div
      className="z-50 max-h-72 w-64 overflow-y-auto rounded-lg border bg-popover p-1 shadow-md"
      style={style}
      role="listbox"
      aria-label="Block types"
    >
      {filtered.map((opt, i) => {
        const Icon = opt.icon
        const active = i === selectedIndex
        return (
          <button
            key={opt.type}
            type="button"
            role="option"
            aria-selected={active}
            onMouseDown={(e) => {
              e.preventDefault()
              onSelect(opt.type)
            }}
            onMouseEnter={() => {
              onHoverIndex?.(i)
            }}
            className={cn(
              'flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
              active
                ? 'bg-accent text-accent-foreground'
                : 'text-popover-foreground hover:bg-accent/50',
            )}
          >
            <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0">
              <span className="block font-medium">{opt.label}</span>
              <span className="block text-xs text-muted-foreground">
                {opt.description}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** Filter the block picker options by a query string. */
export function slashCommandFilteredOptions(query: string) {
  const q = query.toLowerCase().trim()
  if (!q) return BLOCK_PICKER_OPTIONS
  return BLOCK_PICKER_OPTIONS.filter(
    (opt) =>
      opt.label.toLowerCase().includes(q) ||
      opt.type.toLowerCase().includes(q),
  )
}

/** Return the number of filtered options for a query (used by parent for
 *  clamping the selected index). */
export function slashCommandFilterCount(query: string): number {
  return slashCommandFilteredOptions(query).length
}
