/**
 * Which tabs fit in an overflow tab row.
 *
 * The row's own width decides: everything stays when it fits; otherwise the
 * tabs from the end move into the More menu until the rest fit beside it. The
 * selected tab is never the one hidden: it takes the last place in the row.
 */

/** The space between two tabs. */
const GAP = 12

/** The More button's width, reserved whenever some tab is moved into it. */
const MORE_WIDTH = 64

/** Spare room so a tab never ends up a pixel short of its label. */
const SLACK = 4

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
