import { Progress } from '#/components/v3/ui/progress'
import { now as clockNow } from '#/lib/clock'

/**
 * LAB-03 / step 4 — the sample inspector's hold-time meter (SampleDetail).
 *
 * LAB-02 step 1 adds the real hold-limit fields to a sample:
 * `holdCondition` (label), `holdStartedAt` (harvest/registration) plus
 * `holdDurationDays`, or an explicit `holdUntil` deadline. This meter prefers
 * those: the window runs from the hold start (falling back to the record's
 * registered `createdAt`) to the effective deadline. For older samples that
 * only carry an `expiryDate`, that remains the fallback. When nothing usable
 * is stored it reports that honestly instead of inventing a window.
 */

const DAY_MS = 86_400_000

export interface HoldMeterRecord {
  createdAt: string
  properties?: Record<string, unknown> | null
  customFields?: Record<string, unknown> | null
}

export interface SampleHoldState {
  expiry: Date
  condition: string | null
  totalDays: number
  daysUsed: number
  daysLeft: number
  daysAgo: number
  percentUsed: number
  expired: boolean
}

function readString(record: HoldMeterRecord, key: string): string | null {
  for (const source of [record.properties, record.customFields]) {
    const value = source?.[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return null
}

function readNumber(record: HoldMeterRecord, key: string): number | null {
  for (const source of [record.properties, record.customFields]) {
    const value = source?.[key]
    if (value === null || value === undefined || value === '') continue
    const n = typeof value === 'number' ? value : Number(value)
    if (Number.isFinite(n)) return n
  }
  return null
}

/**
 * Resolve the effective deadline: `holdUntil` wins, else the hold start plus
 * `holdDurationDays`, else a legacy `expiryDate`.
 */
function resolveHold(
  record: HoldMeterRecord,
): { start: Date; expiry: Date; condition: string | null } | null {
  const untilIso = readString(record, 'holdUntil')
  const durationDays = readNumber(record, 'holdDurationDays')
  const startedIso = readString(record, 'holdStartedAt')
  const expiryIso = readString(record, 'expiryDate')

  const start = new Date(startedIso ?? record.createdAt)
  if (Number.isNaN(start.getTime())) return null

  let expiry: Date | null = null
  if (untilIso) expiry = new Date(untilIso)
  else if (durationDays != null)
    expiry = new Date(start.getTime() + durationDays * DAY_MS)
  else if (expiryIso) expiry = new Date(expiryIso)
  if (!expiry || Number.isNaN(expiry.getTime())) return null

  return { start, expiry, condition: readString(record, 'holdCondition') }
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
  now: Date = clockNow(),
): SampleHoldState | null {
  const resolved = resolveHold(record)
  if (!resolved) return null
  const { start, expiry, condition } = resolved

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
    condition,
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

/** Design label short form, e.g. "04-Oct" (zero-padded day). */
export function formatHoldDateShort(date: Date): string {
  return `${String(date.getUTCDate()).padStart(2, '0')}-${MONTHS[date.getUTCMonth()]}`
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
      <p className="m-0 text-caption text-fg-muted">
        No hold or expiry date recorded.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="num text-caption">
        {state.daysUsed} of {state.totalDays} {dayLabel(state.totalDays)} used
      </div>
      <Progress
        label="Hold time used"
        value={state.percentUsed}
        tone={state.expired ? 'danger' : 'neutral'}
      />
    </div>
  )
}
