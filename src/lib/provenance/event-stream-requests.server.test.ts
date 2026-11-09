import { describe, expect, it } from 'vitest'

import { handleEventStream } from './event-stream-requests.server'
import type { EventStreamDeps } from './event-stream-requests.server'
import type { StreamPage, StreamRow } from './event-stream'

const row = (sequence: number): StreamRow => ({
  id: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
  sequence,
  entity_type: 'pipeline_reproduction',
  entity_uuid: '22222222-2222-4222-8222-222222222222',
  operation: 'create',
  record_id: null,
  project_id: null,
  actor_user_id: 'u1',
  actor_credential_id: null,
  client_id: null,
  payload: { action: 'reproduced' },
  created_at: '2026-11-07T10:00:00Z',
})

function deps(over: Partial<EventStreamDeps> = {}): EventStreamDeps {
  const all = [row(1), row(2), row(3)]

  return {
    authenticate: async () => ({ workspaceId: 'ws', claims: {} }),
    page: async (_c, after, limit): Promise<StreamPage> => {
      const events = all
        .filter((r) => Number(r.sequence) > after)
        .slice(0, limit)

      const last = events.length
        ? Number(events[events.length - 1].sequence)
        : after

      return {
        events,
        nextCursor: last,
        hasMore: events.length === limit,
        earliest: 1,
        latest: 3,
        expired: false,
        retentionDays: 30,
      }
    },
    pollMs: 1,
    ...over,
  }
}

const get = (qs: string, headers: Record<string, string> = {}) =>
  new Request(`http://x/api/events/stream${qs}`, { headers })

describe('handleEventStream', () => {
  it('needs a caller and the right scope', async () => {
    expect(
      (
        await handleEventStream(
          get(''),
          deps({ authenticate: async () => null }),
        )
      ).status,
    ).toBe(401)
    expect(
      (
        await handleEventStream(
          get(''),
          deps({ authenticate: async () => 'forbidden' }),
        )
      ).status,
    ).toBe(403)
  })

  it('pages as JSON from a cursor', async () => {
    const res = await handleEventStream(get('?after=1&limit=1'), deps())
    const body = await res.json()
    expect(body.events.map((e: { sequence: string }) => e.sequence)).toEqual([
      '2',
    ])
    expect(body.nextCursor).toBe(2)
    expect(body.hasMore).toBe(true)
  })

  it('refuses bad input and an expired cursor', async () => {
    expect((await handleEventStream(get('?after=abc'), deps())).status).toBe(
      400,
    )
    expect((await handleEventStream(get('?limit=0'), deps())).status).toBe(400)
    expect(
      (await handleEventStream(get('?types=nope.nope'), deps())).status,
    ).toBe(400)

    const gone = await handleEventStream(
      get('?after=1'),
      deps({
        page: async () => ({
          events: [],
          nextCursor: 1,
          hasMore: false,
          earliest: 50,
          latest: 90,
          expired: true,
          retentionDays: 30,
        }),
      }),
    )

    expect(gone.status).toBe(410)
  })

  it('streams frames after Last-Event-ID, then stops at the time limit', async () => {
    let t = 0

    const res = await handleEventStream(
      get('', { accept: 'text/event-stream', 'last-event-id': '1' }),
      deps({ now: () => (t += 400), maxStreamMs: 1000, sleep: async () => {} }),
    )

    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const text = await res.text()
    expect(text).toContain('id: 2\n')
    expect(text).toContain('id: 3\n')
    expect(text).not.toContain('id: 1\n')
  })
})
