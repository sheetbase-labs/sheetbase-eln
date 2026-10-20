import { describe, expect, it, vi } from 'vitest'

import {
  decideReplay,
  formatControlEvent,
  formatHeartbeat,
  formatSseEvent,
  handleSseRequest,
  parseLastEventId,
} from './sse-events'
import type { ChangeEventWire, SseDeps } from './sse-events'
import { mapChangeEventRow } from './sse-subscribe'

function event(seq: number, workspaceId = 'ws-1'): ChangeEventWire {
  return {
    id: `evt-${seq}`,
    workspaceId,
    sequence: seq,
    entityType: 'record',
    entityUuid: `rec-${seq}`,
    operation: 'create',
    recordId: `rec-${seq}`,
    projectId: 'proj-1',
    actorUserId: 'user-1',
    actorCredentialId: null,
    clientId: null,
    payload: {},
    createdAt: new Date().toISOString(),
  }
}

it('maps database actor_credential_id to actorCredentialId', () => {
  expect(
    mapChangeEventRow({
      id: 'evt-1',
      workspace_id: 'ws-1',
      sequence: '7',
      entity_type: 'scientific_row',
      entity_uuid: 'row-1',
      operation: 'update',
      record_id: null,
      project_id: null,
      actor_user_id: null,
      actor_credential_id: 'credential-1',
      client_id: null,
      payload: {},
      created_at: '2026-01-01T00:00:00Z',
    }),
  ).toMatchObject({ sequence: 7, actorCredentialId: 'credential-1' })
})

function makeDeps(overrides: Partial<SseDeps> = {}): SseDeps {
  return {
    getSession: async () => ({
      user: { id: 'user-1' },
      session: { id: 'session-1' },
    }),
    getWorkspaceForUser: async () => ({ id: 'ws-1' }),
    readEvents: async () => ({
      events: [],
      hasMore: false,
      earliestAvailableSeq: 0,
    }),
    subscribe: async () => () => {},
    isSessionValid: async () => true,
    now: () => 0,
    ...overrides,
  }
}

function req(init: RequestInit = {}): Request {
  return new Request('http://localhost:3000/api/events', init)
}

async function readStream(response: Response): Promise<string> {
  if (!response.body) throw new Error('no body')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let out = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    out += decoder.decode(value, { stream: true })
  }
  return out + decoder.decode()
}

/**
 * Read chunks until `predicate(body)` is true or the stream closes, then
 * cancel the reader and return what was collected. Avoids waiting on
 * heartbeat-kept-alive streams that never close naturally.
 */
async function readUntil(
  response: Response,
  predicate: (body: string) => boolean,
  timeoutMs = 2000,
): Promise<string> {
  if (!response.body) throw new Error('no body')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let out = ''
  const start = Date.now()
  try {
    for (;;) {
      if (predicate(out)) return out
      if (Date.now() - start > timeoutMs) {
        throw new Error(`readUntil timed out; body so far:\n${out}`)
      }
      const { value, done } = await reader.read()
      if (done) return out + decoder.decode()
      out += decoder.decode(value, { stream: true })
    }
  } finally {
    try {
      await reader.cancel()
    } catch {
      /* ignore */
    }
  }
}

describe('parseLastEventId', () => {
  it('returns 0 when the header is absent', () => {
    expect(parseLastEventId(new Headers())).toBe(0)
  })
  it('parses a positive integer', () => {
    expect(parseLastEventId(new Headers({ 'last-event-id': '42' }))).toBe(42)
  })
  it('returns 0 for malformed values', () => {
    expect(parseLastEventId(new Headers({ 'last-event-id': 'abc' }))).toBe(0)
    expect(parseLastEventId(new Headers({ 'last-event-id': '-5' }))).toBe(0)
  })
})

describe('formatSseEvent', () => {
  it('emits an id, event and data line', () => {
    const ev = event(7)
    const out = formatSseEvent(ev)
    expect(out).toContain('id: 7\n')
    expect(out).toContain('event: change\n')
    expect(out).toContain(`data: ${JSON.stringify(ev)}\n`)
    expect(out.endsWith('\n\n')).toBe(true)
  })
})

describe('formatControlEvent / formatHeartbeat', () => {
  it('control events have no id so they do not advance the cursor', () => {
    const out = formatControlEvent('reset', { resumeFrom: 10 })
    expect(out).not.toContain('id:')
    expect(out).toContain('event: reset\n')
    expect(out).toContain('"resumeFrom":10')
  })
  it('heartbeat is a comment line', () => {
    expect(formatHeartbeat()).toBe(':heartbeat\n\n')
  })
})

describe('decideReplay', () => {
  it('returns events as-is when the bound is not hit', () => {
    const replay = {
      events: [event(1), event(2)],
      hasMore: false,
      earliestAvailableSeq: 1,
    }
    const decision = decideReplay(0, replay)
    expect(decision.events).toHaveLength(2)
    expect(decision.reset).toBeNull()
  })

  it('sends a history_unavailable reset when the cursor is below the earliest retained event', () => {
    const replay = {
      events: [],
      hasMore: false,
      earliestAvailableSeq: 50,
    }
    const decision = decideReplay(10, replay)
    expect(decision.events).toEqual([])
    expect(decision.reset).toEqual({
      reason: 'history_unavailable',
      resumeFrom: 50,
    })
  })

  it('sends a replay_bound reset when the bound is hit and events remain', () => {
    const events = Array.from({ length: 5 }, (_, i) => event(i + 1))
    const replay = {
      events,
      hasMore: true,
      earliestAvailableSeq: 1,
    }
    const decision = decideReplay(0, replay)
    expect(decision.events).toHaveLength(5)
    expect(decision.reset).toEqual({
      reason: 'replay_bound',
      resumeFrom: 5,
    })
  })

  it('does not treat an empty result with hasMore as a reset', () => {
    const decision = decideReplay(0, {
      events: [],
      hasMore: false,
      earliestAvailableSeq: 0,
    })
    expect(decision.reset).toBeNull()
  })
})

describe('handleSseRequest — auth', () => {
  it('rejects unauthenticated callers with 401 before opening a stream', async () => {
    const response = await handleSseRequest(
      req(),
      makeDeps({ getSession: async () => null }),
    )
    expect(response.status).toBe(401)
    expect(response.headers.get('content-type')).toContain('application/json')
    const body = await response.json()
    expect(body.error.category).toBe('unauthenticated')
  })

  it('rejects callers with no workspace with 403', async () => {
    const response = await handleSseRequest(
      req(),
      makeDeps({ getWorkspaceForUser: async () => null }),
    )
    expect(response.status).toBe(403)
    const body = await response.json()
    expect(body.error.category).toBe('no_workspace')
  })
})

describe('handleSseRequest — stream', () => {
  it('sends hello, replays durable events in order, then closes on reset', async () => {
    const replayEvents = [event(3), event(4)]
    const response = await handleSseRequest(
      req({ headers: { 'last-event-id': '2' } }),
      makeDeps({
        readEvents: async () => ({
          events: replayEvents,
          hasMore: false,
          earliestAvailableSeq: 1,
        }),
        // No live events; unsubscribe immediately is fine.
        subscribe: async () => () => {},
      }),
      { heartbeatIntervalMs: 100_000, sessionCheckIntervalMs: 100_000 },
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    const body = await readUntil(response, (b) => b.includes('id: 4'))
    expect(body).toContain('event: hello')
    expect(body).toContain('"resumeFrom":2')
    expect(body.indexOf('id: 3')) < expect(body.indexOf('id: 4'))
    expect(body).toContain('id: 3')
    expect(body).toContain('id: 4')
  })

  it('starts a connection with no cursor at the newest event instead of replaying history', async () => {
    const readEvents = vi.fn(
      async (_workspaceId: string, afterSeq: number) => ({
        events: afterSeq === 0 ? [event(1), event(2)] : [],
        hasMore: false,
        earliestAvailableSeq: 1,
      }),
    )
    const response = await handleSseRequest(
      req(),
      makeDeps({ readEvents, latestSequence: async () => 900 }),
      { heartbeatIntervalMs: 100_000, sessionCheckIntervalMs: 100_000 },
    )
    const body = await readUntil(response, (b) => b.includes('event: hello'))
    expect(body).toContain('"resumeFrom":900')
    expect(body).not.toContain('id: 1')
    expect(readEvents).toHaveBeenCalledWith('ws-1', 900, expect.any(Number))
  })

  it('still resumes from an explicit ?after cursor when a newest sequence is known', async () => {
    const readEvents = vi.fn(async () => ({
      events: [event(11)],
      hasMore: false,
      earliestAvailableSeq: 1,
    }))
    const response = await handleSseRequest(
      new Request('http://localhost:3000/api/events?after=10'),
      makeDeps({ readEvents, latestSequence: async () => 900 }),
      { heartbeatIntervalMs: 100_000, sessionCheckIntervalMs: 100_000 },
    )
    const body = await readUntil(response, (b) => b.includes('id: 11'))
    expect(body).toContain('"resumeFrom":10')
  })

  it('sends a reset and closes when the requested history is unavailable', async () => {
    const response = await handleSseRequest(
      req({ headers: { 'last-event-id': '5' } }),
      makeDeps({
        readEvents: async () => ({
          events: [],
          hasMore: false,
          earliestAvailableSeq: 50,
        }),
      }),
    )
    const body = await readUntil(response, (b) => b.includes('event: reset'))
    expect(body).toContain('event: reset')
    expect(body).toContain('"reason":"history_unavailable"')
    expect(body).toContain('"resumeFrom":50')
  })

  it('forwards live events after replay, skipping duplicates already replayed', async () => {
    // Holder for the live callback; starts as a no-op so it is always
    // callable. subscribe() replaces it with the real onEvent.
    const live: { cb: (e: ChangeEventWire) => void } = {
      cb: () => {},
    }
    const response = await handleSseRequest(
      req({ headers: { 'last-event-id': '0' } }),
      makeDeps({
        readEvents: async () => ({
          events: [event(1)],
          hasMore: false,
          earliestAvailableSeq: 1,
        }),
        subscribe: async (_ws, onEvent) => {
          live.cb = onEvent
          return () => {
            live.cb = () => {}
          }
        },
      }),
      { heartbeatIntervalMs: 100_000, sessionCheckIntervalMs: 100_000 },
    )
    // Drain the stream in parallel; deliver live events once replay done.
    const bodyPromise = readUntil(response, (b) => b.includes('id: 2'))
    // Wait a tick for start() to subscribe and finish replay before delivering.
    await new Promise((r) => setTimeout(r, 20))
    live.cb(event(1)) // duplicate of replayed seq 1 → must be dropped
    live.cb(event(2)) // new → forwarded
    const body = await bodyPromise
    expect(body).toContain('id: 1')
    expect(body).toContain('id: 2')
    // No second id: 1 line beyond the single replay delivery.
    const occurrences = (body.match(/id: 1\b/g) ?? []).length
    expect(occurrences).toBe(1)
  })

  it('does not call subscribe for a workspace the caller does not own', async () => {
    const subscribe = vi.fn(async () => () => {})
    await handleSseRequest(
      req(),
      makeDeps({
        getWorkspaceForUser: async () => null,
        subscribe,
      }),
    )
    expect(subscribe).not.toHaveBeenCalled()
  })

  it('closes the stream when the session expires at the heartbeat check', async () => {
    let sessionChecks = 0
    const response = await handleSseRequest(
      req(),
      makeDeps({
        isSessionValid: async () => {
          sessionChecks++
          // Expire on the first check.
          return false
        },
      }),
      {
        heartbeatIntervalMs: 100_000,
        sessionCheckIntervalMs: 10,
      },
    )
    const body = await readStream(response)
    expect(body).toContain('event: bye')
    expect(body).toContain('"reason":"session_expired"')
    expect(sessionChecks).toBeGreaterThan(0)
  })
})
