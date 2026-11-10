import { t } from '#/copy'
import {
  daysSinceStart,
  formatPartDate,
  partDate,
} from '#/lib/experiment-parts'
import type { PartProgress } from '#/lib/experiment-parts'

/** Every part, or one part's stable identifier. */
export type PartFilterValue = string

/** The URL of a part: `/experiments/<id>/notebook/<number>`. */
export function partHref(expId: string, number: number): string {
  return `/experiments/${expId}/notebook/${number}`
}

/** "Day 3 · Mon 2 Nov", or "Day 3 · Today" on the day itself. */
export function partDayLine(
  part: Pick<PartProgress, 'dayOffset'>,
  startedAt: string,
  now: Date = new Date(),
): string {
  const day = String(part.dayOffset)

  if (daysSinceStart(startedAt, now) === part.dayOffset) {
    return t('notebook.parts.dayToday', { day })
  }

  return t('notebook.parts.dayOn', {
    day,
    date: formatPartDate(partDate(startedAt, part.dayOffset)),
  })
}

/** Unassigned items remain visible under every part, as in the list UI. */
export function showsForPart(
  itemPartId: string | null | undefined,
  filter: PartFilterValue,
): boolean {
  return filter === 'all' || !itemPartId || itemPartId === filter
}
