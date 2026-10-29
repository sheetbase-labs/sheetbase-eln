import { t } from '#/copy'
import * as React from 'react'

import {
  BLOCK_PICKER_GROUPS,
  BLOCK_PICKER_OPTIONS,
} from '#/lib/blocks/registry'
import type { BlockPickerOption } from '#/lib/blocks/registry'
import { cn } from '#/lib/utils'
import { Icon } from '#/components/v3/icons'
import { Kbd } from '#/components/v3/ui/kbd'

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
 *
 * EXP-04.3 — the chrome follows `canvas/NbEditing.dc.html`: the menu is
 * titled "Insert block", grouped in the shared catalogue's design order, and
 * marks the highlighted entry with the design's ↵ hint.
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

function optionMatches(opt: BlockPickerOption, query: string): boolean {
  const q = query.toLowerCase().trim()
  if (!q) return true
  return (
    opt.label.toLowerCase().includes(q) ||
    opt.type.toLowerCase().includes(q) ||
    opt.description.toLowerCase().includes(q) ||
    opt.aliases.some((alias) => alias.toLowerCase().includes(q))
  )
}

export function SlashCommandMenu({
  query,
  selectedIndex,
  onSelect,
  style,
  onHoverIndex,
}: SlashCommandMenuProps) {
  const filtered = React.useMemo(
    () => slashCommandFilteredOptions(query),
    [query],
  )

  if (filtered.length === 0) {
    return (
      <div
        className="z-50 w-72 rounded-lg border bg-popover p-3 text-sm text-fg-muted shadow-md"
        style={style}
        role="listbox"
        aria-label={t('notebook.slashCommandMenu.ariaLabel')}
      >
        {t('notebook.slashCommandMenu.noMatchingBlockTypes')}
      </div>
    )
  }

  let optionIndex = -1

  return (
    <div
      className="z-50 max-h-80 w-72 overflow-y-auto rounded-lg border bg-popover p-1 shadow-md"
      style={style}
      role="listbox"
      aria-label={t('notebook.slashCommandMenu.ariaLabel')}
    >
      <p className="px-2 py-1 text-[11px] font-medium text-fg-muted">
        {t('notebook.slashCommandMenu.ariaLabel')}
      </p>
      {BLOCK_PICKER_GROUPS.map((group) => {
        const items = filtered.filter((opt) => opt.group === group.id)
        if (items.length === 0) return null
        return (
          <div key={group.id} className="mb-1">
            <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-muted">
              {group.label}
            </p>
            {items.map((opt) => {
              optionIndex += 1
              const index = optionIndex
              const iconName = opt.icon
              const active = index === selectedIndex
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
                    onHoverIndex?.(index)
                  }}
                  className={cn(
                    'flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
                    active
                      ? 'bg-selection text-fg'
                      : 'text-fg hover:bg-surface-hover',
                  )}
                >
                  <Icon
                    name={iconName}
                    size={16}
                    className="mt-0.5 shrink-0 text-fg-muted"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{opt.label}</span>
                    <span className="block text-xs text-fg-muted">
                      {opt.description}
                    </span>
                  </span>
                  {active ? (
                    <Kbd className="mt-0.5 shrink-0 self-center">↵</Kbd>
                  ) : null}
                </button>
              )
            })}
          </div>
        )
      })}
      <p className="border-t px-2 py-1.5 text-[10px] text-fg-muted">
        {t('notebook.slashCommandMenu.toMoveEnterTo')}
      </p>
    </div>
  )
}

/** Filter the block picker options by a query string. */
export function slashCommandFilteredOptions(query: string) {
  return BLOCK_PICKER_OPTIONS.filter((opt) => optionMatches(opt, query))
}

/** Return the number of filtered options for a query (used by parent for
 *  clamping the selected index). */
export function slashCommandFilterCount(query: string): number {
  return slashCommandFilteredOptions(query).length
}
