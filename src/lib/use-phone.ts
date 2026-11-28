import { useSyncExternalStore } from 'react'

/** Phone width: below Tailwind's `md` breakpoint, where `max-md:` applies. */
export const PHONE_QUERY = '(max-width: 767.98px)'

function phoneQuery(): MediaQueryList | null {
  return 'matchMedia' in globalThis ? globalThis.matchMedia(PHONE_QUERY) : null
}

function subscribe(onChange: () => void): () => void {
  const query = phoneQuery()

  if (!query) return () => {}

  query.addEventListener('change', onChange)

  return () => query.removeEventListener('change', onChange)
}

/**
 * True at phone width. For the few places where a phone needs different parts,
 * not just different classes; prefer `max-md:` where classes are enough. False
 * on the server, so the first paint matches desktop markup and a phone
 * swaps its parts in after hydration.
 */
export function usePhone(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => phoneQuery()?.matches ?? false,
    () => false,
  )
}
