import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'

import { createLiveEventCoordinator } from './live-events'
import type {
  ChangeEventWire,
  EventSourceLike,
  LiveCoordinator,
} from './live-events'
import { notebookQueryKeys } from './notebook-data'

// ---------------------------------------------------------------------------
// Fake EventSource. Captures listeners so tests can dispatch synthetic
// `open`, `error`, `change`, `hello`, `reset` and `bye` events, and
// records the URL the coordinator connected with (to assert ?after= use).
// ---------------------------------------------------------------------------

type EventListener = (ev: { type: string; data: string }) => void

class FakeEventSource implements EventSourceLike {
  readonly readyState = 0
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  readonly listeners = new Map<string, Set<EventListener>>()
  closed = false
  constructor(readonly url: string) {}

  addEventListener(type: string, listener: EventListener): void {
    let set = this.listeners.get(type)
    if (!set) {
      set = new Set()
      this.listeners.set(type, set)
    }
    set.add(listener)
  }

  close(): void {
    this.closed = true
  }

  dispatch(type: string, data: unknown): void {
    const set = this.listeners.get(type)
    if (!set) return
    const payload = typeof data === 'string' ? data : JSON.stringify(data)
    for (const l of set) l({ type, data: payload })
  }

  open(): void {
    this.dispatch('open', '')
    this.onopen?.()
  }

  error(): void {
    this.dispatch('error', '')
    this.onerror?.()
  }
}

function makeDeps(
  opts: {
    getClientId?: () => string | null
    queryClient?: QueryClient
  } = {},
): {
  coordinator: LiveCoordinator
  qc: QueryClient
  sources: FakeEventSource[]
} {
  const qc = opts.queryClient ?? new QueryClient()
  const sources: FakeEventSource[] = []
  const factory = (url: string): FakeEventSource => {
    const es = new FakeEventSource(url)
    sources.push(es)
    return es
  }
  const coordinator = createLiveEventCoordinator({
    queryClient: qc,
    eventSourceFactory: factory,
    getClientId: opts.getClientId ?? (() => 'self-tab'),
  })
  return { coordinator, qc, sources }
}

function changeEvent(
  seq: number,
  overrides: Partial<ChangeEventWire> = {},
): ChangeEventWire {
  return {
    id: `evt-${seq}`,
    workspaceId: 'ws-1',
    sequence: seq,
    entityType: 'block',
    entityUuid: `block-${seq}`,
    operation: 'update',
    recordId: 'rec-1',
    projectId: 'proj-1',
    actorUserId: 'user-1',
    clientId: 'other-tab',
    payload: {},
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('createLiveEventCoordinator', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('connects and transitions to live on hello', () => {
    const { coordinator, sources } = makeDeps()
    coordinator.connect()
    expect(sources).toHaveLength(1)
    expect(coordinator.getStatus().status).toBe('connecting')

    sources[0].dispatch('hello', { workspaceId: 'ws-1', resumeFrom: 0 })
    expect(coordinator.getStatus()).toMatchObject({
      status: 'live',
      workspaceId: 'ws-1',
      lastAppliedSeq: 0,
    })
  })

  it('applies other-tab block events by invalidating the blocks cache', () => {
    const { coordinator, qc, sources } = makeDeps()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    coordinator.connect()
    sources[0].dispatch('hello', { workspaceId: 'ws-1', resumeFrom: 0 })

    spy.mockClear()
    sources[0].dispatch('change', changeEvent(1, { entityType: 'block' }))

    expect(coordinator.getStatus().lastAppliedSeq).toBe(1)
    const keys = spy.mock.calls.map((c) => c[0]!.queryKey)
    expect(keys).toContainEqual(notebookQueryKeys.blocks('rec-1'))
    expect(keys).toContainEqual(notebookQueryKeys.record('rec-1'))
    // No global invalidation for a single event.
    expect(keys).not.toContainEqual(['notebook'])
  })

  it('skips its own echoed events but still advances the cursor', () => {
    const { coordinator, qc, sources } = makeDeps({
      getClientId: () => 'self-tab',
    })
    const spy = vi.spyOn(qc, 'invalidateQueries')
    coordinator.connect()
    sources[0].dispatch('hello', { workspaceId: 'ws-1', resumeFrom: 0 })
    spy.mockClear()

    sources[0].dispatch('change', changeEvent(1, { clientId: 'self-tab' }))

    expect(coordinator.getStatus().lastAppliedSeq).toBe(1)
    expect(spy).not.toHaveBeenCalled()
  })

  it('drops duplicate sequences (replay or repeated live delivery)', () => {
    const { coordinator, qc, sources } = makeDeps()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    coordinator.connect()
    sources[0].dispatch('hello', { workspaceId: 'ws-1', resumeFrom: 0 })
    spy.mockClear()

    sources[0].dispatch('change', changeEvent(5))
    spy.mockClear()
    // Same sequence delivered again (replay overlap or dup live).
    sources[0].dispatch('change', changeEvent(5))
    expect(spy).not.toHaveBeenCalled()
    // Lower sequence (stale replay) is also dropped.
    sources[0].dispatch('change', changeEvent(3))
    expect(spy).not.toHaveBeenCalled()
    expect(coordinator.getStatus().lastAppliedSeq).toBe(5)
  })

  it('maps each entity type to only its affected keys', () => {
    const { coordinator, qc, sources } = makeDeps()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    coordinator.connect()
    sources[0].dispatch('hello', { workspaceId: 'ws-1', resumeFrom: 0 })
    spy.mockClear()

    // project event
    sources[0].dispatch(
      'change',
      changeEvent(1, {
        entityType: 'project',
        entityUuid: 'proj-1',
        recordId: null,
      }),
    )
    let keys = spy.mock.calls.map((c) => c[0]!.queryKey)
    expect(keys).toContainEqual(notebookQueryKeys.project('proj-1'))
    expect(keys).toContainEqual(notebookQueryKeys.projectsList())
    expect(keys).not.toContainEqual(notebookQueryKeys.blocks('rec-1'))
    spy.mockClear()

    // record event
    sources[0].dispatch(
      'change',
      changeEvent(2, {
        entityType: 'record',
        entityUuid: 'rec-1',
        projectId: 'proj-1',
      }),
    )
    keys = spy.mock.calls.map((c) => c[0]!.queryKey)
    expect(keys).toContainEqual(notebookQueryKeys.record('rec-1'))
    expect(keys).toContainEqual(notebookQueryKeys.records('proj-1'))
    expect(keys).not.toContainEqual(notebookQueryKeys.blocks('rec-1'))
    spy.mockClear()

    // record_link event
    sources[0].dispatch('change', changeEvent(3, { entityType: 'record_link' }))
    keys = spy.mock.calls.map((c) => c[0]!.queryKey)
    expect(keys).toContainEqual(notebookQueryKeys.links('rec-1'))
    expect(keys).toHaveLength(1)
  })

  it('on reset, invalidates all workspace collections and reconnects with ?after=', () => {
    const { coordinator, qc, sources } = makeDeps()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    coordinator.connect()
    sources[0].dispatch('hello', { workspaceId: 'ws-1', resumeFrom: 10 })
    spy.mockClear()

    sources[0].dispatch('reset', {
      reason: 'history_unavailable',
      resumeFrom: 50,
    })

    expect(coordinator.getStatus()).toMatchObject({
      status: 'reconnecting',
      lastResetReason: 'history_unavailable',
    })
    const keys = spy.mock.calls.map((c) => c[0]!.queryKey)
    expect(keys).toContainEqual(['notebook'])
    expect(keys).toContainEqual(notebookQueryKeys.projectsList())
    expect(sources[0].closed).toBe(true)

    // scheduleReconnect(0) → reconnect after 500ms.
    vi.advanceTimersByTime(500)
    expect(sources).toHaveLength(2)
    expect(sources[1].url).toBe('/api/events?after=50')
  })

  it('on bye with session_expired, goes offline and does not reconnect', () => {
    const { coordinator, sources } = makeDeps()
    coordinator.connect()
    sources[0].dispatch('hello', { workspaceId: 'ws-1', resumeFrom: 0 })

    sources[0].dispatch('bye', { reason: 'session_expired' })
    expect(coordinator.getStatus().status).toBe('offline')
    expect(sources[0].closed).toBe(true)

    vi.advanceTimersByTime(20_000)
    expect(sources).toHaveLength(1)
  })

  it('on error, transitions to reconnecting without closing (native retry)', () => {
    const { coordinator, sources } = makeDeps()
    coordinator.connect()
    sources[0].dispatch('hello', { workspaceId: 'ws-1', resumeFrom: 0 })

    sources[0].error()
    expect(coordinator.getStatus().status).toBe('reconnecting')
    // Native EventSource keeps the connection; we did not close it.
    expect(sources[0].closed).toBe(false)
  })

  it('disconnect closes the stream and marks offline', () => {
    const { coordinator, sources } = makeDeps()
    coordinator.connect()
    sources[0].dispatch('hello', { workspaceId: 'ws-1', resumeFrom: 0 })

    coordinator.disconnect()
    expect(coordinator.getStatus().status).toBe('offline')
    expect(sources[0].closed).toBe(true)
  })

  it('two coordinators with distinct client ids act as two tabs', () => {
    const qc = new QueryClient()
    const aSources: FakeEventSource[] = []
    const bSources: FakeEventSource[] = []
    const tabA = createLiveEventCoordinator({
      queryClient: qc,
      eventSourceFactory: (url: string) => {
        const es = new FakeEventSource(url)
        aSources.push(es)
        return es
      },
      getClientId: () => 'tab-a',
    })
    const tabB = createLiveEventCoordinator({
      queryClient: qc,
      eventSourceFactory: (url: string) => {
        const es = new FakeEventSource(url)
        bSources.push(es)
        return es
      },
      getClientId: () => 'tab-b',
    })
    const spy = vi.spyOn(qc, 'invalidateQueries')

    tabA.connect()
    tabB.connect()
    aSources[0].dispatch('hello', { workspaceId: 'ws-1', resumeFrom: 0 })
    bSources[0].dispatch('hello', { workspaceId: 'ws-1', resumeFrom: 0 })
    spy.mockClear()

    // Tab A's own echo: A skips, B applies.
    aSources[0].dispatch('change', changeEvent(1, { clientId: 'tab-a' }))
    bSources[0].dispatch('change', changeEvent(1, { clientId: 'tab-a' }))

    expect(tabA.getStatus().lastAppliedSeq).toBe(1)
    expect(tabB.getStatus().lastAppliedSeq).toBe(1)
    // Tab A skipped (no invalidation for its echo); Tab B invalidated.
    expect(spy).toHaveBeenCalled()
  })

  it('reconnects from resumeFrom and clears reset reason on successful hello', () => {
    const { coordinator, sources } = makeDeps()
    coordinator.connect()
    sources[0].dispatch('hello', { workspaceId: 'ws-1', resumeFrom: 0 })
    sources[0].dispatch('reset', {
      reason: 'history_unavailable',
      resumeFrom: 42,
    })
    vi.advanceTimersByTime(500)
    expect(sources[1].url).toBe('/api/events?after=42')

    sources[1].dispatch('hello', { workspaceId: 'ws-1', resumeFrom: 42 })
    expect(coordinator.getStatus()).toMatchObject({
      status: 'live',
      lastResetReason: null,
      lastAppliedSeq: 42,
    })
  })

  it('ignores events from a different workspace', () => {
    const { coordinator, qc, sources } = makeDeps()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    coordinator.connect()
    sources[0].dispatch('hello', { workspaceId: 'ws-1', resumeFrom: 0 })
    spy.mockClear()

    sources[0].dispatch('change', changeEvent(1, { workspaceId: 'ws-other' }))
    expect(spy).not.toHaveBeenCalled()
    expect(coordinator.getStatus().lastAppliedSeq).toBe(0)
  })

  it('subscribe receives the current snapshot immediately and on changes', () => {
    const { coordinator, sources } = makeDeps()
    const seen: string[] = []
    const unsub = coordinator.subscribe((s) => seen.push(s.status))

    expect(seen).toEqual(['offline'])
    coordinator.connect()
    expect(seen).toEqual(['offline', 'connecting'])
    sources[0].dispatch('hello', { workspaceId: 'ws-1', resumeFrom: 0 })
    expect(seen).toEqual(['offline', 'connecting', 'live'])

    unsub()
    sources[0].error()
    // No more updates after unsubscribe.
    expect(seen).toEqual(['offline', 'connecting', 'live'])
  })
})
