/**
 * The application's notion of "now".
 *
 * Development and test runs can pin it with `SHEETBASE_NOW` so that
 * time-dependent surfaces (hold meters, expiry windows, relative dates) render
 * deterministically against the design clock instead of drifting as real time
 * passes. Deployed environments ignore the variable: it is a test seam, in the
 * same spirit as `SHEETBASE_DEV_AUTH_FREE`, never a production control.
 */
/** Replaced at build time by Vite (vite.config.ts); empty outside dev/test. */
declare const __SHEETBASE_NOW__: string | undefined

const PINNED = resolvePinnedNow()

function resolvePinnedNow(): Date | null {
  const raw = readPinnedValue()
  if (!raw) return null
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/**
 * The server reads the variable directly; the browser reads the value Vite
 * substituted, which vite.config.ts only fills for development and test builds.
 */
function readPinnedValue(): string | null {
  const environment = process.env.SHEETBASE_ENV
  if (environment === 'development' || environment === 'test') {
    if (process.env.SHEETBASE_NOW) return process.env.SHEETBASE_NOW
  }
  if (typeof __SHEETBASE_NOW__ === 'string' && __SHEETBASE_NOW__) {
    return __SHEETBASE_NOW__
  }
  return null
}

/** True when a pinned clock is in force, so callers can say so if they need to. */
export function isClockPinned(): boolean {
  return PINNED !== null
}

export function now(): Date {
  return PINNED ? new Date(PINNED.getTime()) : new Date()
}
