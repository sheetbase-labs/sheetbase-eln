/**
 * Offline device store (EXP-05.1, ADR-0018 amendment "durable offline edits").
 *
 * The store persists the current user's *un-synced* drafts on the device and
 * nothing else: block text, sheet-cell edits, added rows and draft comments,
 * each carrying the expected server revision it was based on and the time it
 * was made. Server-authoritative values are never copied here. Reads are
 * scoped by user *and* record, so one user's — or one record's — drafts can
 * never be seen from another scope, and a successful replay removes exactly
 * the edits it committed.
 *
 * Out of scope here (see EXP-05): the offline UI (EXP-05.2), the replay
 * (EXP-05.3) and conflict resolution (EXP-05.4). This module only stores.
 *
 * Two backends sit behind the `OfflineStorage` interface: a thin IndexedDB
 * wrapper for the browser and an in-memory implementation for tests. jsdom has
 * no IndexedDB, so the tests run against the in-memory backend; the IndexedDB
 * backend's shape is covered by the types.
 *
 * Workspace setting (SET-01): `workspace_settings.allow_offline_editing`
 * (`src/db/schema.ts`) is the domain switch that decides whether offline
 * editing is permitted at all. It is not yet exposed through
 * `WorkspaceSettingsWire` / `WorkspaceSettings` (`src/lib/workspace-admin.ts`),
 * so there is no client-readable value to gate on yet. This store therefore
 * never decides whether editing is allowed — it only persists drafts it is
 * given.
 */
import { z } from 'zod'

/** A user editing a record; the unit of isolation for stored drafts. */
export interface OfflineEditScope {
  userId: string
  recordId: string
}

/** JSON-serialisable value, matching what a cell or row can hold. */
export type OfflineJsonValue =
  | string
  | number
  | boolean
  | null
  | OfflineJsonValue[]
  | { [key: string]: OfflineJsonValue }

const offlineJsonValueSchema: z.ZodType<OfflineJsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(offlineJsonValueSchema),
    z.record(z.string(), offlineJsonValueSchema),
  ]),
)

const offlineEditBaseSchema = z.object({
  /** Client-generated identity; also how a replay names the edit to clear. */
  id: z.string().min(1),
  /** Monotonic within a scope; replay order. */
  sequence: z.number().int().min(1),
  /**
   * The server revision the edit was based on — the block `expectedVersion`
   * or the sheet instance's expected revision. A replayed write that no
   * longer matches surfaces a conflict rather than overwriting the server.
   */
  expectedRevision: z.number().int().min(0),
  /** ISO-8601 timestamp of when the edit was made. */
  createdAt: z.string(),
})

/**
 * One unsynced edit. The `kind` pins the target the replay must address and
 * the payload it must carry.
 */
export const offlineEditSchema = z.discriminatedUnion('kind', [
  offlineEditBaseSchema.extend({
    kind: z.literal('block_text'),
    blockId: z.string().min(1),
    text: z.string(),
  }),
  offlineEditBaseSchema.extend({
    kind: z.literal('cell'),
    sheetInstanceId: z.string().min(1),
    rowId: z.string().min(1),
    columnId: z.string().min(1),
    value: offlineJsonValueSchema,
  }),
  offlineEditBaseSchema.extend({
    kind: z.literal('row'),
    sheetInstanceId: z.string().min(1),
    values: z.record(z.string(), offlineJsonValueSchema),
  }),
  offlineEditBaseSchema.extend({
    kind: z.literal('comment'),
    sheetInstanceId: z.string().min(1),
    body: z.string(),
    mentions: z.array(z.string()),
    parentId: z.string().nullable(),
  }),
])

export type OfflineEdit = z.infer<typeof offlineEditSchema>

type DistributiveOmit<T, TKey extends PropertyKey> = T extends unknown
  ? Omit<T, TKey>
  : never

/**
 * An edit as handed to the store: the store assigns `id`, `sequence` and
 * `createdAt` when the caller does not supply them.
 */
export type OfflineEditDraft = DistributiveOmit<
  OfflineEdit,
  'id' | 'sequence' | 'createdAt'
> & {
  id?: string
  createdAt?: string
}

/** Mutable drafts for one user and one record. */
export interface OfflineEditStore {
  /** The scope's edits, in replay order. Never returns another scope's. */
  listEdits: (scope: OfflineEditScope) => Promise<OfflineEdit[]>
  /** Persist a draft, stamping id, sequence and timestamp as needed. */
  putEdit: (
    scope: OfflineEditScope,
    draft: OfflineEditDraft,
  ) => Promise<OfflineEdit>
  /** Drop exactly the named edits; returns how many were removed. */
  removeEdits: (
    scope: OfflineEditScope,
    ids: readonly string[],
  ) => Promise<number>
  /** Drop every draft for the scope (used on discard, not on successful replay). */
  clear: (scope: OfflineEditScope) => Promise<void>
  /**
   * The record ids for which `userId` has at least one retained draft, sorted.
   * Never includes another user's records, and never triggers a device-wide
   * wipe — it only reports what sign-out retention must preserve.
   */
  listScopes: (userId: string) => Promise<string[]>
}

// ---------------------------------------------------------------------------
// Backend interface and implementations
// ---------------------------------------------------------------------------

/** Minimal async key/value persistence; the store owns all domain meaning. */
export interface OfflineStorage {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<void>
  delete: (key: string) => Promise<void>
  /** Every key currently persisted; omit if the backend cannot enumerate. */
  keys?: () => Promise<string[]>
}

const DEFAULT_DATABASE_NAME = 'sheetbase-offline'
const DEFAULT_STORE_NAME = 'edits'

function cloneJsonValue<T>(value: T): T {
  if (value === null || value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}

/** In-memory backend for tests and for browsers where IndexedDB is denied. */
export function createInMemoryStorage(
  initial?: Record<string, unknown>,
): OfflineStorage {
  const entries = new Map<string, unknown>()
  if (initial) {
    for (const [key, value] of Object.entries(initial)) {
      entries.set(key, cloneJsonValue(value))
    }
  }
  return {
    async get(key) {
      return entries.has(key) ? cloneJsonValue(entries.get(key)) : undefined
    },
    async set(key, value) {
      entries.set(key, cloneJsonValue(value))
    },
    async delete(key) {
      entries.delete(key)
    },
    async keys() {
      return [...entries.keys()]
    },
  }
}

/**
 * The DOM lib types `indexedDB` as always present, but Node, SSR and jsdom do
 * not provide it; this named cast keeps the runtime absence guard meaningful.
 */
const indexedDbGlobal = globalThis as { indexedDB?: IDBFactory }

/**
 * Thin IndexedDB wrapper: one database, one object store, no schema beyond
 * the key. Opening is lazy and errors surface as rejections, never as throws
 * at construction time.
 */
export function createIndexedDbStorage(
  options: { databaseName?: string; storeName?: string } = {},
): OfflineStorage {
  const databaseName = options.databaseName ?? DEFAULT_DATABASE_NAME
  const storeName = options.storeName ?? DEFAULT_STORE_NAME
  let databasePromise: Promise<IDBDatabase> | null = null

  function openDatabase(): Promise<IDBDatabase> {
    if (databasePromise) return databasePromise
    databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      const factory = indexedDbGlobal.indexedDB
      if (!factory) {
        reject(new Error('IndexedDB is not available in this environment.'))
        return
      }
      const request = factory.open(databaseName, 1)
      request.onupgradeneeded = () => {
        const database = request.result
        if (!database.objectStoreNames.contains(storeName)) {
          database.createObjectStore(storeName)
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () =>
        reject(request.error ?? new Error('Failed to open the offline database.'))
      request.onblocked = () =>
        reject(new Error('Opening the offline database was blocked.'))
    })
    return databasePromise
  }

  async function run<T>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest,
  ): Promise<T> {
    const database = await openDatabase()
    return new Promise<T>((resolve, reject) => {
      let result: T | undefined
      let settled = false
      const fail = (error: unknown) => {
        if (settled) return
        settled = true
        reject(
          error instanceof Error
            ? error
            : new Error(String(error ?? 'Offline database request failed.')),
        )
      }
      const transaction = database.transaction(storeName, mode)
      const request = operation(transaction.objectStore(storeName))
      request.onsuccess = () => {
        result = request.result as T
      }
      request.onerror = () => fail(request.error)
      transaction.oncomplete = () => {
        if (settled) return
        settled = true
        resolve(result as T)
      }
      transaction.onerror = () => fail(transaction.error)
      transaction.onabort = () => fail(transaction.error)
    })
  }

  return {
    get: (key) => run<unknown>('readonly', (store) => store.get(key)),
    set: (key, value) =>
      run<IDBValidKey>('readwrite', (store) => store.put(value, key)).then(
        () => undefined,
      ),
    delete: (key) =>
      run<undefined>('readwrite', (store) => store.delete(key)).then(
        () => undefined,
      ),
    keys: () =>
      run<IDBValidKey[]>('readonly', (store) => store.getAllKeys()).then(
        (keys) => keys.map(String),
      ),
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const OFFLINE_EDITS_KEY_PREFIX = 'sheetbase-offline-edits-v1'

/** Key scheme that keeps one user's or record's drafts out of another's. */
export function offlineEditsKey(scope: OfflineEditScope): string {
  return [
    OFFLINE_EDITS_KEY_PREFIX,
    encodeURIComponent(scope.userId),
    encodeURIComponent(scope.recordId),
  ].join(':')
}

function assertScope(scope: OfflineEditScope): void {
  if (!scope.userId) {
    throw new TypeError('An offline edit scope requires a user id.')
  }
  if (!scope.recordId) {
    throw new TypeError('An offline edit scope requires a record id.')
  }
}

function makeEditId(): string {
  try {
    return globalThis.crypto.randomUUID()
  } catch {
    return `edit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  }
}

/** The record id a scope key carries for `userId`, or null if it is not theirs. */
function recordIdFromKey(userId: string, key: string): string | null {
  const prefix = `${OFFLINE_EDITS_KEY_PREFIX}:${encodeURIComponent(userId)}:`
  if (!key.startsWith(prefix)) return null
  try {
    return decodeURIComponent(key.slice(prefix.length))
  } catch {
    // A malformed key is not a scope we can report.
    return null
  }
}

function compareEdits(a: OfflineEdit, b: OfflineEdit): number {
  if (a.sequence !== b.sequence) return a.sequence - b.sequence
  const byTime = a.createdAt.localeCompare(b.createdAt)
  if (byTime !== 0) return byTime
  return a.id.localeCompare(b.id)
}

/**
 * Read + validate one scope's edits. Anything that is not an array of
 * well-formed edits — a missing key, a scalar, unknown kinds, corrupt
 * members — is dropped rather than thrown, so a damaged store cannot wedge
 * the editor.
 */
async function readValidEdits(
  storage: OfflineStorage,
  scope: OfflineEditScope,
): Promise<OfflineEdit[]> {
  const raw = await storage.get(offlineEditsKey(scope))
  if (!Array.isArray(raw)) return []
  const edits: OfflineEdit[] = []
  for (const entry of raw) {
    const parsed = offlineEditSchema.safeParse(entry)
    if (parsed.success) edits.push(parsed.data)
  }
  return edits.sort(compareEdits)
}

export function createOfflineEditStore(
  storage: OfflineStorage,
): OfflineEditStore {
  return {
    async listEdits(scope) {
      assertScope(scope)
      return readValidEdits(storage, scope)
    },

    async putEdit(scope, draft) {
      assertScope(scope)
      const existing = await readValidEdits(storage, scope)
      const sequence =
        existing.reduce((highest, edit) => Math.max(highest, edit.sequence), 0) +
        1
      const edit = offlineEditSchema.parse({
        ...draft,
        id: draft.id ?? makeEditId(),
        sequence,
        createdAt: draft.createdAt ?? new Date().toISOString(),
      })
      await storage.set(offlineEditsKey(scope), [...existing, edit])
      return edit
    },

    async removeEdits(scope, ids) {
      assertScope(scope)
      const wanted = new Set(ids)
      if (wanted.size === 0) return 0
      const existing = await readValidEdits(storage, scope)
      const remaining = existing.filter((edit) => !wanted.has(edit.id))
      const removed = existing.length - remaining.length
      if (removed === 0) return 0
      if (remaining.length === 0) {
        await storage.delete(offlineEditsKey(scope))
      } else {
        await storage.set(offlineEditsKey(scope), remaining)
      }
      return removed
    },

    async clear(scope) {
      assertScope(scope)
      await storage.delete(offlineEditsKey(scope))
    },

    async listScopes(userId) {
      if (!userId) {
        throw new TypeError('Listing offline edit scopes requires a user id.')
      }
      const enumerate = storage.keys
      if (!enumerate) return []
      const recordIds = new Set<string>()
      for (const key of await enumerate()) {
        const recordId = recordIdFromKey(userId, key)
        if (recordId === null) continue
        recordIds.add(recordId)
      }
      const scopes: string[] = []
      for (const recordId of recordIds) {
        const edits = await readValidEdits(storage, { userId, recordId })
        if (edits.length > 0) scopes.push(recordId)
      }
      return scopes.sort()
    },
  }
}
