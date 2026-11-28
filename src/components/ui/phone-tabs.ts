/**
 * How a list's tab strip fits a phone: the width it has, and how many tabs
 * stay in the row beside More. Used by `Tabs` (url mode) and set by the list
 * header (`ListHeader`).
 */
import { createContext } from 'react'
import { z } from 'zod'

/** Only the fields the width estimate reads. */
interface PhoneTab {
  label: unknown
  count?: unknown
}

/**
 * The width, in pixels, a phone gives a URL tab strip that does not set its
 * own `phoneKeep`. A list header sets it, so every list's views stay on one
 * line on a phone, with the rest under More, and no list has to opt in.
 */
export const PhoneTabsWidth = createContext<number | undefined>(undefined)

/** Rough width of a strip tab at phone size: 7.5px a character of label,
 * 7px a character of count, and the gap after it. A label that is not plain
 * text counts as wide. */
function phoneTabWidth(item: PhoneTab): number {
  const label = z.string().safeParse(item.label)
  const count = z.union([z.string(), z.number()]).safeParse(item.count)

  return (
    (label.success ? label.data.length * 7.5 : 120) +
    (count.success ? String(count.data).length * 7 + 6 : 0) +
    16
  )
}

/** How many tabs from the start fit in `width` beside a More button. */
export function phoneTabsThatFit(
  items: readonly PhoneTab[],
  width: number,
): number | undefined {
  const all = items.reduce((sum, item) => sum + phoneTabWidth(item), 0)

  if (all <= width) return undefined
  const MORE = 64
  let used = MORE
  let keep = 0

  for (const item of items) {
    used += phoneTabWidth(item)

    if (used > width) break
    keep += 1
  }

  return Math.max(1, keep)
}
