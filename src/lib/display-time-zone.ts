import { useSyncExternalStore } from 'react'

/**
 * The time zone every stored instant is shown in. Instants are stored and
 * transported in UTC; this only chooses the wall clock a person reads them on.
 * It is the signed-in person's own zone (`user_preferences.timezone`), falling
 * back to the workspace zone, and is resolved with the signed-in context so a
 * plain formatter anywhere in the app can read it without a hook.
 *
 * The server never stores it: concurrent requests share the module, so only the
 * browser sets it (the shell does, on hydration and whenever the profile saves).
 */
let displayTimeZone: string | undefined
const listeners = new Set<() => void>()

/** True when the runtime can resolve `zone` as an IANA time zone name. */
export function isUsableTimeZone(
  zone: string | null | undefined,
): zone is string {
  if (!zone) return false
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

export function getDisplayTimeZone(): string | undefined {
  return displayTimeZone
}

export function setDisplayTimeZone(zone: string | null | undefined): void {
  if (typeof window === 'undefined') return
  const next = isUsableTimeZone(zone) ? zone : undefined
  if (next === displayTimeZone) return
  displayTimeZone = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The display zone as state, so a component re-renders when it changes. */
export function useDisplayTimeZone(fallback = 'UTC'): string {
  return (
    useSyncExternalStore(subscribe, getDisplayTimeZone, () => undefined) ??
    fallback
  )
}

/**
 * A stored instant on the display zone's clock, with the zone's short name
 * ("BST", "GMT+2") when `zone` is set. Audit and signature times pass it so a
 * reader never has to guess which clock they are looking at.
 */
export function formatInstant(
  iso: string | null | undefined,
  options: Intl.DateTimeFormatOptions & { zone?: boolean } = {},
): string {
  if (!iso) return '—'
  const parsed = Date.parse(iso)
  if (Number.isNaN(parsed)) return '—'
  const { zone, ...format } = options
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: getDisplayTimeZone(),
    ...format,
    ...(zone ? { timeZoneName: 'short' as const } : {}),
  }).format(new Date(parsed))
}
