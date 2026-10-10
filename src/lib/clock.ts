/**
 * The application's notion of "now".
 *
 * Development and test runs can pin it with `SHEETBASE_NOW` so that
 * time-dependent surfaces (hold meters, expiry windows, relative dates) render
 * deterministically against the design clock instead of drifting as real time
 * passes. Deployed environments ignore the variable: it is a test seam, in the
 * same spirit as `SHEETBASE_DEV_AUTH_FREE`, never a production control.
 */
const PINNED = resolvePinnedNow()

function resolvePinnedNow(): Date | null {
  const environment = process.env.SHEETBASE_ENV
  if (environment !== 'development' && environment !== 'test') return null
  const raw = process.env.SHEETBASE_NOW
  if (!raw) return null
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/** True when a pinned clock is in force, so callers can say so if they need to. */
export function isClockPinned(): boolean {
  return PINNED !== null
}

export function now(): Date {
  return PINNED ? new Date(PINNED.getTime()) : new Date()
}
