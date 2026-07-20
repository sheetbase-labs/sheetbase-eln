/**
 * LIVE-003: the client-side live-event coordinator. Connects to the
 * authenticated SSE stream at `/api/events`, parses durable change
 * events, and reconciles them into the TanStack Query cache so a second
 * tab's edits arrive without a full-page reload.
 *
 * Design (see docs/decisions/0017-live-event-reconciliation.md):
 *
 * - **Stable client identity.** Each tab mints a UUID in sessionStorage
 *   (`src/lib/client-identity.ts`) and sends it as `x-sheetbase-client-id`
 *   on every `/api/db` request. The proxy mints it into the JWT as
 *   `client_id`; the durable change-event trigger records it. When an
 *   event's `clientId` matches this tab's id, the coordinator skips
 *   application — the mutation's own `onSuccess` already reconciled the
 *   canonical result into the cache, so the echo would be redundant.
 *
 * - **Targeted invalidation.** Each event maps to the narrowest set of
 *   query keys it affects (project → project + projects-list; record →
 *   record + project's records list; block → blocks + record; link →
 *   links). The coordinator never does a global cache invalidation; it
 *   refetches only the collections whose data changed.
 *
 * - **Duplicate suppression.** The coordinator tracks the highest
 *   sequence it has applied per workspace and drops any event whose
 *   sequence is ≤ that cursor, so a replayed event delivered again or a
 *   duplicate live notification is applied at most once.
 *
 * - **Reset recovery.** On a `reset` (history_unavailable or
 *   replay_bound), the coordinator invalidates every workspace-scoped
 *   collection and reconnects from `resumeFrom` via `?after=<seq>`,
 *   avoiding the infinite-reset loop that native Last-Event-ID would
 *   cause when the cursor points into cleaned-up history.
 *
 * - **Optimistic state preserved.** The coordinator never overwrites a
 *   pending optimistic mutation's cache entry. Self-echoes are skipped
 *   entirely; other-client events trigger background invalidation, which
 *   refetches canonical state without clobbering in-flight optimistic
 *   updates (TanStack Query keeps optimistic data while a mutation is
 *   pending and reconciles on settle).
 *
 * The coordinator is a pure function of injectable deps: an EventSource
 * factory and a query client. Tests inject a fake EventSource to simulate
 * two-tab editing, reconnect, duplicate delivery and reset without a
 * database or a network.
 */
import type { QueryClient } from '@tanstack/react-query'

import { notebookQueryKeys } from './notebook-data'

// ---------------------------------------------------------------------------
// Types.
// ---------------------------------------------------------------------------

/** Wire shape of a durable change event, as delivered by the SSE stream. */
export interface ChangeEventWire {
  id: string
  workspaceId: string
  sequence: number
  entityType: string
  entityUuid: string
  operation: string
  recordId: string | null
  projectId: string | null
  actorUserId: string | null
  actorCredentialId: string | null
  clientId: string | null
  payload: Record<string, unknown>
  createdAt: string
}

/** Connection status surfaced to the UI. */
export type LiveConnectionStatus =
  'connecting' | 'live' | 'reconnecting' | 'offline'

export interface LiveStatus {
  status: LiveConnectionStatus
  /** Highest sequence applied to the cache for the current workspace. */
  lastAppliedSeq: number
  /** Workspace id the stream is scoped to, once known from `hello`. */
  workspaceId: string | null
  /** Last reset reason, if any. Cleared on successful reconnect. */
  lastResetReason: string | null
}

/**
 * Minimal EventSource surface the coordinator depends on. Native
 * `EventSource` satisfies this; tests inject a fake. The server sends
 * `event: <type>` lines; native EventSource dispatches to matching
 * listeners registered via `addEventListener(type, ...)`.
 */
export interface EventSourceLike {
  readonly readyState: number
  onopen: (() => void) | null
  onerror: (() => void) | null
  addEventListener: (
    type: string,
    listener: (ev: { type: string; data: string }) => void,
  ) => void
  close: () => void
}

export interface EventSourceFactory {
  (url: string): EventSourceLike
}

export interface LiveEventDeps {
  queryClient: QueryClient
  eventSourceFactory: EventSourceFactory
  /** Base URL of the SSE endpoint; defaults to `/api/events`. */
  url?: string
  /** Returns this tab's client id, or null if none was minted. */
  getClientId: () => string | null
  /** Keys to invalidate; defaults to the shared `notebookQueryKeys`. */
  keys?: typeof notebookQueryKeys
}

export interface LiveCoordinator {
  connect: () => void
  disconnect: () => void
  getStatus: () => LiveStatus
  subscribe: (listener: (status: LiveStatus) => void) => () => void
}

// ---------------------------------------------------------------------------
// Coordinator.
// ---------------------------------------------------------------------------

const DEFAULT_URL = '/api/events'

export function createLiveEventCoordinator(
  deps: LiveEventDeps,
): LiveCoordinator {
  const url = deps.url ?? DEFAULT_URL
  const keys = deps.keys ?? notebookQueryKeys

  let status: LiveConnectionStatus = 'offline'
  let lastAppliedSeq = 0
  let workspaceId: string | null = null
  let lastResetReason: string | null = null
  let source: EventSourceLike | null = null
  let disposed = false
  /** Reconnect timer for manual reconnects (after reset / bye). */
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  /** Cursor to reconnect from; set by reset/bye, cleared on successful hello. */
  let reconnectAfter: number | null = null
  const listeners = new Set<(s: LiveStatus) => void>()

  function snapshot(): LiveStatus {
    return { status, lastAppliedSeq, workspaceId, lastResetReason }
  }

  function emit(): void {
    const s = snapshot()
    for (const l of listeners) l(s)
  }

  function setStatus(next: LiveConnectionStatus): void {
    if (status === next) return
    status = next
    emit()
  }

  /**
   * Apply one durable change event to the query cache. Self-echoes
   * (clientId === this tab's id) are skipped — the mutation layer owns
   * canonical reconciliation for the actor's own writes. Other clients'
   * events trigger the narrowest invalidation that refetches the
   * affected collection(s).
   */
  function applyEvent(event: ChangeEventWire): void {
    // Duplicate suppression: drop anything at or below the cursor.
    if (event.sequence <= lastAppliedSeq) return

    const self = deps.getClientId()
    if (self && event.clientId === self) {
      // Own echo: the mutation's onSuccess already reconciled the cache.
      // Advance the cursor so a later replayed batch does not re-apply.
      lastAppliedSeq = event.sequence
      emit()
      return
    }

    // Other client (or null client id from a seed/migration): apply
    // targeted invalidation. Background refetch preserves pending
    // optimistic state for unrelated in-flight mutations.
    invalidateForEvent(event)
    lastAppliedSeq = event.sequence
    emit()
  }

  function invalidateForEvent(event: ChangeEventWire): void {
    const qc = deps.queryClient
    switch (event.entityType) {
      case 'project': {
        void qc.invalidateQueries({
          queryKey: keys.project(event.entityUuid),
        })
        void qc.invalidateQueries({ queryKey: keys.projectsList() })
        break
      }
      case 'record': {
        void qc.invalidateQueries({
          queryKey: keys.record(event.entityUuid),
        })
        if (event.projectId) {
          void qc.invalidateQueries({
            queryKey: keys.records(event.projectId),
          })
        }
        // Records list on the home/projects views may also reflect this.
        void qc.invalidateQueries({ queryKey: keys.projectsList() })
        break
      }
      case 'block': {
        if (event.recordId) {
          void qc.invalidateQueries({
            queryKey: keys.blocks(event.recordId),
          })
          // Block structural changes bump the record's structure_version.
          void qc.invalidateQueries({
            queryKey: keys.record(event.recordId),
          })
        }
        break
      }
      case 'record_link': {
        if (event.recordId) {
          void qc.invalidateQueries({
            queryKey: keys.links(event.recordId),
          })
        }
        break
      }
      case 'scientific_table': {
        void qc.invalidateQueries({
          queryKey: ['scientific-table', event.entityUuid],
        })
        if (event.recordId) {
          void qc.invalidateQueries({
            queryKey: ['scientific-tables', event.recordId],
          })
        }
        // Use the same metadata and row prefixes for every table event. This
        // intentionally includes display/reorder changes: a future operation
        // must not need a client release to avoid a stale grid shape.
        void qc.invalidateQueries({
          queryKey: ['scientific-rows', event.entityUuid],
        })
        void qc.invalidateQueries({
          queryKey: ['scientific-all-rows', event.entityUuid],
        })
        void qc.invalidateQueries({
          queryKey: ['scientific-calculation-results'],
        })
        break
      }
      case 'scientific_row': {
        const tableId = event.payload.tableId
        if (typeof tableId === 'string') {
          void qc.invalidateQueries({ queryKey: ['scientific-rows', tableId] })
          void qc.invalidateQueries({
            queryKey: ['scientific-all-rows', tableId],
          })
          void qc.invalidateQueries({
            queryKey: ['scientific-calculation-results'],
          })
        }
        break
      }
      case 'formula': {
        const tableId = event.payload.tableId
        if (typeof tableId === 'string') {
          void qc.invalidateQueries({ queryKey: ['formula', tableId] })
          void qc.invalidateQueries({
            queryKey: ['scientific-formulas', tableId],
          })
          void qc.invalidateQueries({
            queryKey: ['scientific-dependencies'],
          })
          void qc.invalidateQueries({
            queryKey: ['scientific-calculation-results'],
          })
          void qc.invalidateQueries({ queryKey: ['calculation', tableId] })
        }
        break
      }
      case 'calculation': {
        void qc.invalidateQueries({
          queryKey: ['scientific-calculation-results'],
        })
        const tableId = event.payload.tableId
        if (typeof tableId === 'string')
          void qc.invalidateQueries({ queryKey: ['calculation', tableId] })
        break
      }
      default: {
        // Unknown entity type: invalidate nothing rather than the whole
        // cache. A future schema entry will map it.
      }
    }
  }

  /**
   * On reset, the requested history is unavailable or exceeded the
   * replay bound. Invalidate every workspace-scoped collection so the
   * UI refetches canonical state, then reconnect from `resumeFrom` via
   * `?after=` to avoid the infinite-reset loop native Last-Event-ID
   * would cause when the cursor points into cleaned-up history.
   */
  function handleReset(reason: string, resumeFrom: number): void {
    lastResetReason = reason
    invalidateAllWorkspaceCollections()
    // Close the current stream; reconnect manually with ?after.
    if (source) {
      source.close()
      source = null
    }
    reconnectAfter = resumeFrom
    setStatus('reconnecting')
    if (!disposed) {
      scheduleReconnect(0)
    }
  }

  function invalidateAllWorkspaceCollections(): void {
    const qc = deps.queryClient
    // Invalidate by the notebook prefix and the projects-list key. This
    // is the recover-from-reset path, not the per-event path, so a broad
    // (but still workspace-scoped) invalidation is correct: the client
    // has lost contiguous history and must refetch current state.
    void qc.invalidateQueries({ queryKey: ['notebook'] })
    void qc.invalidateQueries({ queryKey: keys.projectsList() })
    for (const prefix of [
      'scientific-table',
      'scientific-tables',
      'scientific-rows',
      'scientific-all-rows',
      'scientific-formulas',
      'scientific-dependencies',
      'scientific-calculation-results',
      'formula',
      'calculation',
    ])
      void qc.invalidateQueries({ queryKey: [prefix] })
  }

  function scheduleReconnect(delayMs: number): void {
    if (reconnectTimer) clearTimeout(reconnectTimer)
    const next = Math.min(delayMs + 500, 10_000)
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      if (disposed) return
      openStream()
    }, next)
  }

  function openStream(): void {
    if (disposed) return
    if (source) {
      source.close()
      source = null
    }
    const fullUrl =
      reconnectAfter !== null ? `${url}?after=${reconnectAfter}` : url
    setStatus('connecting')
    const es = deps.eventSourceFactory(fullUrl)
    source = es

    es.addEventListener('open', () => {
      // Wait for `hello` before declaring live; the server sends hello
      // once the workspace is resolved and replay has started.
    })

    es.addEventListener('error', () => {
      // Native EventSource auto-reconnects with Last-Event-ID; we only
      // surface the status. If we are in a manual-reconnect regime
      // (after reset), the native retry will use the fresh connection's
      // Last-Event-ID tracking, which is correct.
      if (disposed) return
      setStatus('reconnecting')
    })

    // The server emits `event: change` for durable events and
    // `event: hello|reset|bye` for control events. Route each through a
    // dedicated listener that switches on the event type.
    es.addEventListener('change', (ev) => {
      handleChangeMessage(ev.data)
    })
    es.addEventListener('hello', (ev) => {
      handleControlMessage('hello', ev.data)
    })
    es.addEventListener('reset', (ev) => {
      handleControlMessage('reset', ev.data)
    })
    es.addEventListener('bye', (ev) => {
      handleControlMessage('bye', ev.data)
    })
    // Some EventSource polyfills dispatch unknown event types to
    // `onmessage`; route those too, switching on a parsed `type` field.
    es.addEventListener('message', (ev) => {
      handleGenericMessage(ev.data)
    })
  }

  function handleChangeMessage(data: string): void {
    let event: ChangeEventWire
    try {
      event = JSON.parse(data) as ChangeEventWire
    } catch {
      return
    }
    if (typeof event.sequence !== 'number') return
    if (workspaceId && event.workspaceId !== workspaceId) return
    applyEvent(event)
  }

  function handleControlMessage(
    type: 'hello' | 'reset' | 'bye',
    data: string,
  ): void {
    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(data) as Record<string, unknown>
    } catch {
      payload = {}
    }
    if (type === 'hello') {
      workspaceId =
        typeof payload.workspaceId === 'string'
          ? payload.workspaceId
          : workspaceId
      const resumeFrom =
        typeof payload.resumeFrom === 'number' ? payload.resumeFrom : 0
      // The server's starting cursor becomes the floor for duplicate
      // suppression: anything at or below it has been replayed (or is
      // about to be) and should not be double-applied.
      if (resumeFrom > lastAppliedSeq) lastAppliedSeq = resumeFrom
      lastResetReason = null
      reconnectAfter = null
      // Assign status and emit exactly once for the whole hello payload
      // (fields + status), so subscribers see one transition, not two.
      status = 'live'
      emit()
    } else if (type === 'reset') {
      const reason =
        typeof payload.reason === 'string' ? payload.reason : 'unknown'
      const resumeFrom =
        typeof payload.resumeFrom === 'number'
          ? payload.resumeFrom
          : lastAppliedSeq
      handleReset(reason, resumeFrom)
    } else {
      const reason =
        typeof payload.reason === 'string' ? payload.reason : 'unknown'
      lastResetReason = reason
      if (source) {
        source.close()
        source = null
      }
      // session_expired → stop; replay_failed → try again.
      if (reason === 'session_expired') {
        setStatus('offline')
      } else {
        setStatus('reconnecting')
        if (!disposed) scheduleReconnect(1000)
      }
    }
  }

  function handleGenericMessage(data: string): void {
    // Polyfill dispatch: peek at a `type` field if present.
    let payload: Record<string, unknown> & { type?: string }
    try {
      payload = JSON.parse(data) as Record<string, unknown> & { type?: string }
    } catch {
      return
    }
    switch (payload.type) {
      case 'change':
        handleChangeMessage(data)
        break
      case 'hello':
      case 'reset':
      case 'bye':
        handleControlMessage(payload.type, data)
        break
      default:
        break
    }
  }

  return {
    connect() {
      if (disposed) return
      if (source) return
      openStream()
    },
    disconnect() {
      disposed = true
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      if (source) {
        source.close()
        source = null
      }
      setStatus('offline')
    },
    getStatus() {
      return snapshot()
    },
    subscribe(listener) {
      listeners.add(listener)
      listener(snapshot())
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/**
 * Invalidate the workspace-scoped collections the coordinator owns. Used
 * externally by routes that need to force a refetch after a mutation
 * whose echo they want to ignore (rare); the coordinator itself calls
 * this on reset.
 */
export function invalidateWorkspaceCollections(
  qc: QueryClient,
  keys: typeof notebookQueryKeys = notebookQueryKeys,
): void {
  void qc.invalidateQueries({ queryKey: ['notebook'] })
  void qc.invalidateQueries({ queryKey: keys.projectsList() })
  for (const prefix of [
    'scientific-table',
    'scientific-tables',
    'scientific-rows',
    'scientific-all-rows',
    'scientific-formulas',
    'scientific-dependencies',
    'scientific-calculation-results',
    'formula',
    'calculation',
  ])
    void qc.invalidateQueries({ queryKey: [prefix] })
}
