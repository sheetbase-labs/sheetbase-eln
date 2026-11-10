import { now as appNow } from '#/lib/clock'

/** A UTC calendar day, offset from today, as the date inputs want it. */
export function isoDay(offsetDays = 0): string {
  const d = appNow()
  d.setUTCDate(d.getUTCDate() + offsetDays)

  return d.toISOString().slice(0, 10)
}
