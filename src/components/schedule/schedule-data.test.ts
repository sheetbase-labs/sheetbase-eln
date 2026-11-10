import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

/** The canonical `create_booking` arguments, as the RPC boundary carries them. */
const bookingArgs = z.looseObject({
  p_workspace_id: z.string(),
  p_resource_id: z.string(),
  p_title: z.string(),
  p_starts_at: z.string(),
  p_ends_at: z.string(),
  p_timezone: z.string(),
  p_project_id: z.string().nullable(),
  p_linked_experiment_record_id: z.string().nullable(),
})

const calls: z.infer<typeof bookingArgs>[] = []

const wire = {
  id: 'b-1',
  resource_id: 'ins-1',
  title: 'EXP-1 Titration',
  starts_at: '2026-10-20T09:00:00.000Z',
  ends_at: '2026-10-20T10:00:00.000Z',
  timezone: 'UTC',
  created_by_user_id: 'u-1',
}

/** Keep the singleton DataClient real; fixture only the HTTP it sends. */
const fixtureFetch: typeof fetch = async (input, init) => {
  const request = new Request(
    new URL(input instanceof Request ? input.url : input, 'http://localhost'),
    init,
  )

  const { pathname } = new URL(request.url)

  if (request.method === 'POST' && pathname === '/api/db/rpc/create_booking') {
    calls.push(bookingArgs.parse(await request.json()))

    return Response.json(wire)
  }

  throw new Error(`Unexpected request: ${request.method} ${pathname}`)
}

vi.stubGlobal('fetch', fixtureFetch)

const { bookInstrument } = await import('./schedule-data')

describe('bookInstrument', () => {
  beforeEach(() => {
    calls.length = 0
  })

  const base = {
    workspaceId: 'ws-1',
    resourceId: 'ins-1',
    title: 'EXP-1 Titration',
    startsAt: wire.starts_at,
    endsAt: wire.ends_at,
    timezone: 'UTC',
  }

  it('records the experiment and its project on a booking made for one', async () => {
    await bookInstrument({
      ...base,
      linkedExperimentRecordId: 'exp-1',
      projectId: 'prj-1',
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      p_linked_experiment_record_id: 'exp-1',
      p_project_id: 'prj-1',
    })
  })

  it('leaves both empty for a booking made on its own', async () => {
    await bookInstrument(base)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      p_linked_experiment_record_id: null,
      p_project_id: null,
    })
  })
})
