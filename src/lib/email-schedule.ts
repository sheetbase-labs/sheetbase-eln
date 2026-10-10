/**
 * WORK-03.4 — quiet hours.
 *
 * A non-urgent email that would arrive inside the user's quiet window is held
 * until the window ends. Reviews due today and signature requests are always
 * delivered. Pure so the worker can compute a deferral without SMTP.
 */
export interface QuietHours {
  start: string | null
  end: string | null
}

const TIME = /^([0-2][0-9]):([0-5][0-9])$/

function minutesOfDay(value: string | null): number | null {
  const match = value ? TIME.exec(value) : null
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

/** Events that always come through, even during quiet hours. */
export const ALWAYS_DELIVERED = new Set([
  'review_requested',
  'review_returned_or_signed',
  'signature_requested',
])

export function isWithinQuietHours(now: Date, quiet: QuietHours): boolean {
  const start = minutesOfDay(quiet.start)
  const end = minutesOfDay(quiet.end)
  if (start === null || end === null || start === end) return false
  const minute = now.getHours() * 60 + now.getMinutes()
  // Overnight window (e.g. 22:00–07:00) wraps midnight.
  return start < end
    ? minute >= start && minute < end
    : minute >= start || minute < end
}

/**
 * The time an email should actually be sent: `now` unless it is non-urgent and
 * falls inside quiet hours, in which case the end of the window (today or
 * tomorrow).
 */
export function nextSendAt(
  now: Date,
  quiet: QuietHours,
  eventType: string,
): Date {
  if (ALWAYS_DELIVERED.has(eventType)) return now
  if (!isWithinQuietHours(now, quiet)) return now
  const end = minutesOfDay(quiet.end) as number
  const result = new Date(now)
  result.setSeconds(0, 0)
  result.setHours(Math.floor(end / 60), end % 60, 0, 0)
  if (result <= now) result.setDate(result.getDate() + 1)
  return result
}
