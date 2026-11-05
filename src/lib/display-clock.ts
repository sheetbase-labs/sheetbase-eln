import { useSyncExternalStore } from 'react'

/**
 * Whether times read on a 12 or a 24 hour clock. It is the signed-in person's
 * own choice (`user_preferences.preferences.clock`, set on Profile) and is held
 * here, like the display time zone, so a plain formatter anywhere in the app can
 * read it without a hook. Only the browser sets it; the server renders 24 hour.
 */
export type ClockFormat = '12h' | '24h'

let clock: ClockFormat = '24h'
const listeners = new Set<() => void>()

export function toClockFormat(value: unknown): ClockFormat {
  return value === '12h' ? '12h' : '24h'
}

export function getDisplayClock(): ClockFormat {
  return clock
}

export function setDisplayClock(next: unknown): void {
  if (typeof window === 'undefined') return
  const value = toClockFormat(next)
  if (value === clock) return
  clock = value
  for (const listener of listeners) listener()
}

/** The `hour12` option to pass `Intl.DateTimeFormat` for the person's clock. */
export function displayHour12(): boolean {
  return clock === '12h'
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The clock as state, so a component re-renders when it changes. */
export function useDisplayClock(): ClockFormat {
  return useSyncExternalStore(subscribe, getDisplayClock, () => '24h' as const)
}

/** Spread into `Intl` options that show a time of day. */
export function clockOption(): { hour12: boolean } {
  return { hour12: displayHour12() }
}
