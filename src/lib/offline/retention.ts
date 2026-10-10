/**
 * EXP-05.5 — sign-out retention for the offline device store.
 *
 * ADR-0018 §5: unsynced drafts live on the device and survive sign-out until
 * their owner explicitly discards them. This module owns both halves of that
 * promise:
 *
 * - **Sign-out never clears the store.** `retainDraftsOnSignOut` only records
 *   how much work is waiting so the `SignedOut` surface can say so truthfully.
 *   It has no delete path at all; the device store's `clear` is for an
 *   explicit discard, never for signing out.
 * - **Only the owner gets the drafts back.** `restoreDraftsForUser` reads the
 *   scopes the store reports for the signed-in user and rebuilds every scope
 *   from that user id, so a store that mis-keyed a scope cannot leak one
 *   person's work to another.
 *
 * The concrete store is EXP-05.1's `src/lib/offline/store.ts`, whose reads are
 * per (user, record) scope. This module depends on the narrow
 * `RetainedDraftStore` port rather than importing that file, so wiring it is
 * two method delegations wherever the notebook mounts the store:
 *
 * ```ts
 * const port: RetainedDraftStore<OfflineEdit> = {
 *   listScopes: (userId) => store.listScopes(userId),
 *   listDrafts: (scope) => store.listEdits(scope),
 * }
 * ```
 */

/** One user's drafts for one record: the store's unit of isolation. */
export interface DraftScope {
  userId: string
  recordId: string
}

/**
 * The device store as sign-out retention needs it. `listScopes` returns the
 * record ids holding drafts for `userId`; `listDrafts` returns that scope's
 * drafts. Neither may return another user's work.
 */
export interface RetainedDraftStore<TDraft> {
  listScopes: (userId: string) => Promise<string[]>
  listDrafts: (scope: DraftScope) => Promise<TDraft[]>
}

/** What a sign-out leaves behind for the `SignedOut` surface to report. */
export interface SignOutRetention {
  /** The user who signed out; their drafts stay keyed to this id. */
  userId: string
  /** Unsynced drafts waiting on this device for `userId`. */
  retained: number
  signedOutAt: string
}

/** Device-local home of the retention marker; survives sign-out. */
export interface SignOutRetentionStorage {
  read: () => SignOutRetention | null
  write: (value: SignOutRetention) => void
  clear: () => void
}

export const SIGN_OUT_RETENTION_KEY = 'sheetbase.signed-out-retention'

function isSignOutRetention(value: unknown): value is SignOutRetention {
  if (typeof value !== 'object' || value === null) return false
  const marker = value as Record<string, unknown>
  return (
    typeof marker.userId === 'string' &&
    marker.userId.length > 0 &&
    typeof marker.retained === 'number' &&
    Number.isFinite(marker.retained) &&
    typeof marker.signedOutAt === 'string'
  )
}

/**
 * A marker over web storage. Every call is guarded: a browser with storage
 * denied (private mode, a blocked origin) simply reports "nothing retained"
 * rather than breaking sign-out.
 */
export function webSignOutRetentionStorage(
  storage: Storage,
): SignOutRetentionStorage {
  return {
    read() {
      try {
        const raw = storage.getItem(SIGN_OUT_RETENTION_KEY)
        if (!raw) return null
        const parsed: unknown = JSON.parse(raw)
        return isSignOutRetention(parsed) ? parsed : null
      } catch {
        return null
      }
    },
    write(value) {
      try {
        storage.setItem(SIGN_OUT_RETENTION_KEY, JSON.stringify(value))
      } catch {
        /* private mode / disabled storage */
      }
    },
    clear() {
      try {
        storage.removeItem(SIGN_OUT_RETENTION_KEY)
      } catch {
        /* private mode / disabled storage */
      }
    },
  }
}

/** In-memory marker storage for tests and storage-less environments. */
export function createInMemorySignOutRetentionStorage(
  initial: SignOutRetention | null = null,
): SignOutRetentionStorage {
  let value = initial
  return {
    read: () => value,
    write: (next) => {
      value = next
    },
    clear: () => {
      value = null
    },
  }
}

/** Drafts waiting on this device for one user, across every record. */
export async function countRetainedDrafts<TDraft>(
  store: RetainedDraftStore<TDraft>,
  userId: string,
): Promise<number> {
  let total = 0
  for (const recordId of await store.listScopes(userId)) {
    total += (await store.listDrafts({ userId, recordId })).length
  }
  return total
}

/**
 * Record that `userId` has signed out with `retained` drafts still waiting.
 * The store itself is deliberately untouched: drafts stay on the device for
 * their owner to reclaim on their next sign-in.
 */
export async function retainDraftsOnSignOut<TDraft>(
  store: RetainedDraftStore<TDraft>,
  retention: SignOutRetentionStorage,
  userId: string,
  now: () => Date = () => new Date(),
): Promise<SignOutRetention> {
  const marker: SignOutRetention = {
    userId,
    retained: await countRetainedDrafts(store, userId),
    signedOutAt: now().toISOString(),
  }
  retention.write(marker)
  return marker
}

/**
 * The signed-in user's retained drafts, per record. Scopes are rebuilt from
 * `userId`, so another user's drafts can never come back through this call.
 */
export async function restoreDraftsForUser<TDraft>(
  store: RetainedDraftStore<TDraft>,
  userId: string,
): Promise<Array<{ recordId: string; drafts: TDraft[] }>> {
  const restored: Array<{ recordId: string; drafts: TDraft[] }> = []
  for (const recordId of await store.listScopes(userId)) {
    const drafts = await store.listDrafts({ userId, recordId })
    if (drafts.length > 0) restored.push({ recordId, drafts })
  }
  return restored
}
