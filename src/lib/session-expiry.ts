import { useSyncExternalStore } from 'react'

/**
 * A tiny store for "the session ended while this tab was open" (J-SET-05).
 *
 * The data client marks it on any 401 from the data boundary, and the live
 * stream reports it as a reset reason. The shell reads it to say so and offer
 * sign-in, instead of each screen showing its own generic load error.
 */
let expired = false
const listeners = new Set<() => void>()

export function markSessionExpired(): void {
  if (expired) return
  expired = true
  for (const listener of listeners) listener()
}

export function resetSessionExpired(): void {
  if (!expired) return
  expired = false
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useSessionExpired(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => expired,
    () => false,
  )
}

/** The sign-in URL that returns to the page the person was on. */
export function signInHrefFor(path: string): string {
  const next = path.startsWith('/sign-in') ? '/' : path
  return `/sign-in?next=${encodeURIComponent(next)}`
}
