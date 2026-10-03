import { cn } from '#/lib/utils'

/**
 * LAB-03 / step 4 — the sample inspector's hold-time meter (SampleDetail).
 *
 * The design's meter reads "5 of 14 days used" from a hold duration counted
 * from harvest. A sample does not model a hold duration or a harvest date
 * (LAB-02 owns those fields and is not implemented), so this meter is derived
 * only from an optional per-sample `expiryDate` plus the record's registered
 * (`createdAt`) time. When no expiry date is stored it reports that honestly
 * instead of inventing a window.
 */

const DAY_MS = 86_400_000

export interface HoldMeterRecord {
  createdAt: string
  properties?: Record<string, unknown> | null
  customFields?: Record<string, unknown> | null
}

export interface SampleHoldState {
  expiry: Date
  totalDays: number
  daysUsed: number
  daysLeft: number
  daysAgo: number
  percentUsed: number
  expired: boolean
}

function readExpiryIso(record: HoldMeterRecord): string | null {
  for (const source of [record.properties, record.customFields]) {
    const value = source?.expiryDate
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return null
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/**
 * Derive the hold/expiry state, or null when the sample carries no usable
 * expiry date. Pure so the boundary cases are unit tested.
 */
export function computeSampleHold(
  record: HoldMeterRecord,
  now: Date = new Date(),
): SampleHoldState | null {
  const iso = readExpiryIso(record)
  if (!iso) return null
  const expiry = new Date(iso)
  if (Number.isNaN(expiry.getTime())) return null
  const start = new Date(record.createdAt)
  if (Number.isNaN(start.getTime())) return null

  const nowMs = now.getTime()
  const expiryMs = expiry.getTime()
  const windowMs = expiryMs - start.getTime()
  const expired = nowMs >= expiryMs

  const totalDays =
    windowMs > 0 ? Math.max(1, Math.round(windowMs / DAY_MS)) : 1
  const daysUsed = expired
    ? totalDays
    : clamp(Math.floor((nowMs - start.getTime()) / DAY_MS), 0, totalDays)
  const daysLeft = expired
    ? 0
    : Math.max(0, Math.ceil((expiryMs - nowMs) / DAY_MS))
  const daysAgo = expired
    ? Math.max(0, Math.floor((nowMs - expiryMs) / DAY_MS))
    : 0
  const percentUsed =
    windowMs > 0
      ? clamp(Math.round(((nowMs - start.getTime()) / windowMs) * 100), 0, 100)
      : expired
        ? 100
        : 0

  return {
    expiry,
    totalDays,
    daysUsed,
    daysLeft,
    daysAgo,
    percentUsed,
    expired,
  }
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const

export function formatHoldDate(date: Date): string {
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`
}

function dayLabel(count: number): string {
  return count === 1 ? 'day' : 'days'
}

export function SampleHoldMeter({
  record,
  now,
}: {
  record: HoldMeterRecord
  /** Clock override for deterministic rendering/tests. */
  now?: Date
}) {
  const state = computeSampleHold(record, now)
  if (!state) {
    return (
      <p className="m-0 text-label text-fg-muted">
        No hold or expiry date recorded.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-label">
        {state.expired ? (
          <span className="num font-medium text-danger-text">
            Expired
            {state.daysAgo > 0
              ? ` ${state.daysAgo} ${dayLabel(state.daysAgo)} ago`
              : ' today'}
          </span>
        ) : (
          <span className="num font-medium">
            {state.daysLeft} {dayLabel(state.daysLeft)} left
          </span>
        )}
        <span className="num text-fg-muted">
          use by {formatHoldDate(state.expiry)}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label="Hold time used"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={state.percentUsed}
        className="h-1.5 overflow-hidden rounded-full bg-skeleton"
      >
        <div
          className={cn(
            'h-1.5',
            state.expired ? 'bg-danger-text' : 'bg-fg-muted',
          )}
          style={{ width: `${state.percentUsed}%` }}
        />
      </div>
      <div className="num text-label text-fg-muted">
        {state.daysUsed} of {state.totalDays} {dayLabel(state.totalDays)} used
      </div>
    </div>
  )
}
