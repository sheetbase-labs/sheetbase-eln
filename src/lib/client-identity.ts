/**
 * LIVE-003: per-tab stable client identity. Each browser tab gets a
 * random UUID stored in `sessionStorage`, so:
 *   - the same tab keeps the same client id across reloads (sessionStorage
 *     survives reload but not tab close);
 *   - a second tab gets a distinct id, so two-tab semantics work and the
 *     client can reconcile its own echoed events without confusing them
 *     with another tab's events.
 *
 * The id is sent to `/api/db` as `x-sheetbase-client-id`; the proxy mints
 * it into the PostgREST JWT as `client_id`, and the durable change-event
 * trigger (LIVE-001) records it on every emitted event. The live-event
 * coordinator (LIVE-003) uses it to skip its own echoed events and apply
 * only other clients' changes to the TanStack Query cache.
 *
 * `sessionStorage` is tab-scoped: opening a new tab creates a fresh
 * browsing session, so each tab gets its own id. This is the desired
 * two-tab behaviour.
 */

const STORAGE_KEY = 'sheetbase-client-id'

/**
 * Lazily get the tab-scoped client id, creating and persisting one on
 * first call. Returns `null` when storage is unavailable (SSR, private
 * mode, disabled storage) so callers can degrade gracefully — the proxy
 * accepts a missing id and the trigger records `client_id = null`.
 */
export function getOrCreateClientId(
  storage: Storage | null = safeSessionStorage(),
): string | null {
  if (!storage) return null
  const existing = storage.getItem(STORAGE_KEY)
  if (existing) return existing
  const id = newClientId()
  try {
    storage.setItem(STORAGE_KEY, id)
  } catch {
    // Storage is full or blocked; return the ephemeral id for this
    // session. It will not persist across reloads, but live-event
    // reconciliation still works within the tab's lifetime.
    return id
  }
  return id
}

/**
 * Read the tab-scoped client id without creating one. Returns `null` when
 * storage is unavailable or no id has been minted yet.
 */
export function getClientId(
  storage: Storage | null = safeSessionStorage(),
): string | null {
  if (!storage) return null
  return storage.getItem(STORAGE_KEY)
}

/** Generate a fresh client id. Uses `crypto.randomUUID` when available. */
function newClientId(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID()
  }
  // Fallback for very old browsers; sufficient for tab-scoped identity.
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** Safely access `sessionStorage`; returns null when blocked or undefined. */
function safeSessionStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

/** Header name the proxy reads to mint `client_id` into the JWT. */
export const CLIENT_ID_HEADER = 'x-sheetbase-client-id'
