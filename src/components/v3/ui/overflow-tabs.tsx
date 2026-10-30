import { useLayoutEffect, useRef, useState } from 'react'

import { Icon } from '#/components/v3/icons'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/v3/ui/dropdown-menu'
import { TabsList, TabsTab } from '#/components/v3/ui/tabs'
import { t } from '#/copy'
import { cn } from '#/lib/utils'

export interface OverflowTabItem {
  value: string
  label: React.ReactNode
  /** Trailing count, shown after the label. */
  count?: React.ReactNode
}

const GAP = 12
/** The More button's width, reserved whenever some tab is moved into it. */
const MORE_WIDTH = 64
/** Spare room so a tab never ends up a pixel short of its label. */
const SLACK = 4

/**
 * Which tabs stay in the row. Everything stays when it fits; otherwise the
 * tabs from the end move into the More menu until the rest fit beside it. The
 * selected tab is never the one hidden: it takes the last place in the row.
 */
export function visibleTabIndexes(
  widths: readonly number[],
  available: number,
  activeIndex: number,
): number[] {
  const all = widths.map((_, index) => index)
  const span = (indexes: number[]) =>
    indexes.reduce((sum, index) => sum + (widths[index] ?? 0), 0) +
    GAP * Math.max(indexes.length - 1, 0)
  if (span(all) <= available) return all
  for (let keep = widths.length - 1; keep >= 1; keep -= 1) {
    const head = all.slice(0, keep)
    const row =
      activeIndex >= keep ? [...head.slice(0, keep - 1), activeIndex] : head
    if (span(row) + GAP + MORE_WIDTH + SLACK <= available) return row
  }
  return activeIndex >= 0 ? [activeIndex] : [0]
}

/**
 * A tab row for a narrow panel. The tabs that fit stay in the row and the rest
 * move into a More menu, so no label is ever clipped or scrolled out of view.
 * It measures its own width, so it follows the panel when it is resized.
 */
export function OverflowTabs({
  items,
  value,
  onValueChange,
  className,
}: {
  items: readonly OverflowTabItem[]
  value: string
  onValueChange: (value: string) => void
  className?: string
}) {
  const rowRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const [available, setAvailable] = useState(0)
  const [widths, setWidths] = useState<number[]>([])

  useLayoutEffect(() => {
    const row = rowRef.current
    const measure = measureRef.current
    if (!row || !measure) return
    const read = () => {
      setAvailable(row.clientWidth)
      const next = [...measure.children].map(
        (child) => (child as HTMLElement).offsetWidth,
      )
      setWidths((previous) =>
        previous.length === next.length &&
        previous.every((width, index) => width === next[index])
          ? previous
          : next,
      )
    }
    read()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(read)
    observer.observe(row)
    observer.observe(measure)
    return () => observer.disconnect()
  })

  const activeIndex = items.findIndex((item) => item.value === value)
  const shown =
    available === 0 || widths.length !== items.length
      ? items.map((_, index) => index)
      : visibleTabIndexes(widths, available, activeIndex)
  const hidden = items.filter((_, index) => !shown.includes(index))

  return (
    <div
      ref={rowRef}
      className={cn('relative flex min-w-0 flex-1 items-center', className)}
    >
      <TabsList className="h-auto min-w-0 gap-3 overflow-hidden">
        {shown.map((index) => (
          <TabsTab key={items[index].value} value={items[index].value}>
            {items[index].label}
            {items[index].count !== undefined ? (
              <span className="num text-label text-fg-muted">
                {items[index].count}
              </span>
            ) : null}
          </TabsTab>
        ))}
      </TabsList>
      {hidden.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={t('notebook.inspector.moreTabsAriaLabel')}
            className="ml-auto inline-flex h-9 shrink-0 cursor-pointer items-center gap-1 border-0 border-b-2 border-transparent bg-transparent pl-3 text-body font-medium text-fg-muted hover:text-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
          >
            {t('notebook.inspector.moreTabs')}
            <Icon name="chevronDown" size={12} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[160px]">
            {hidden.map((item) => (
              <DropdownMenuItem
                key={item.value}
                onClick={() => onValueChange(item.value)}
              >
                {item.label}
                {item.count !== undefined ? (
                  <span className="num ml-1 text-fg-muted">{item.count}</span>
                ) : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      <div
        ref={measureRef}
        aria-hidden
        className="pointer-events-none invisible absolute left-0 top-0 flex gap-3 whitespace-nowrap"
      >
        {items.map((item) => (
          <span
            key={item.value}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 px-0.5 text-body font-medium"
          >
            {item.label}
            {item.count !== undefined ? (
              <span className="num text-label">{item.count}</span>
            ) : null}
          </span>
        ))}
      </div>
    </div>
  )
}
