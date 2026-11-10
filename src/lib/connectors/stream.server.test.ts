import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { createDataClient, DataClientError } from '../data-client'
import type { ExternalClaims } from '../external-token'
import { ExternalTokenError } from '../external-token'
import { handleStream, parseStreamBody } from './stream.server'
import type { StreamDeps } from './stream.server'

const WS = '11111111-1111-4111-8111-111111111111'
const INSTRUMENT = '44444444-4444-4444-8444-444444444444'

const personal: ExternalClaims = {
  workspace_id: WS,
  credential_id: 'cred',
  scopes: ['files:write', 'datasets:write'],
  sub: 'user-1',
  kind: 'personal',
  role: 'authenticated',
}

const streamArgumentsSchema = z.object({
  p_instrument_id: z.string().optional(),
  p_unit_id: z.string().nullable().optional(),
  p_room_id: z.string().nullable().optional(),
  p_readings: z.array(
    z.object({
      feed: z.string(),
      value: z.number(),
      unit: z.string().optional(),
      at: z.string().optional(),
    }),
  ),
})

function setup(
  options: { claims?: ExternalClaims; rpcError?: DataClientError } = {},
) {
  const calls: Array<{
    name: string
    args: z.infer<typeof streamArgumentsSchema>
  }> = []

  const client = createDataClient(async (input, init) => {
    const url = new URL(
      input instanceof Request ? input.url : input,
      'http://eln.test',
    )

    expect(init?.method).toBe('POST')
    expect(url.pathname).toMatch(
      /^\/api\/db\/rpc\/record_(instrument|storage)_readings$/,
    )

    const args = streamArgumentsSchema.parse(
      JSON.parse(z.string().parse(init?.body)),
    )

    calls.push({ name: url.pathname.replace('/api/db/rpc/', ''), args })

    if (options.rpcError) {
      return Response.json(
        {
          error: {
            code: options.rpcError.code,
            message: options.rpcError.message,
          },
        },
        { status: options.rpcError.status },
      )
    }

    return Response.json({ stored: 1, feeds: 1 })
  })

  const deps: StreamDeps = {
    verifyCredential: async () => options.claims ?? personal,
    createClient: () => client,
  }

  return { deps, calls }
}

function post(
  body: {
    instrumentId?: string
    storageUnitId?: string
    storageRoomId?: string
    readings: Array<{
      feed: string
      value: number
      unit?: string
      at?: string
    }>
  },
  headers: Record<string, string> = {},
) {
  return new Request('http://eln.test/api/connectors/stream', {
    method: 'POST',
    headers: { authorization: 'Bearer tok', ...headers },
    body: JSON.stringify(body),
  })
}

const batch = {
  instrumentId: INSTRUMENT,
  readings: [
    { feed: ' Weight ', value: 12.5, unit: 'g', at: '2026-11-05T09:00:00Z' },
  ],
}

describe('parseStreamBody', () => {
  it('cleans each reading down to what the database takes', () => {
    expect(parseStreamBody(batch).readings).toEqual([
      {
        feed: 'Weight',
        value: 12.5,
        unit: 'g',
        at: '2026-11-05T09:00:00.000Z',
      },
    ])
  })

  it('names the reading that is wrong', () => {
    const bad = (readings: z.core.util.JSONType[]) => () =>
      parseStreamBody({ instrumentId: INSTRUMENT, readings })

    expect(
      bad([
        { feed: 'a', value: 1 },
        { feed: 'b', value: '2' },
      ]),
    ).toThrow(/Reading 2 \(b\)/)
    expect(bad([{ feed: '', value: 1 }])).toThrow(/Reading 1 needs a feed name/)
    expect(bad([{ feed: 'a', value: 1, at: 'tomorrow-ish' }])).toThrow(/time/)
    expect(bad([{ feed: 'a', value: Infinity }])).toThrow(/needs a number/)
    expect(bad([{ feed: 'a', value: null }])).toThrow(/needs a number/)
    expect(bad([null])).toThrow(/Reading 1 needs a feed name/)
    expect(bad([{ feed: 'x'.repeat(81), value: 1 }])).toThrow(/feed name/)
    expect(bad([])).toThrow(/between 1 and 2000/)
    expect(() =>
      parseStreamBody({ instrumentId: 'nope', readings: [] }),
    ).toThrow(/instrumentId/)
    expect(() => parseStreamBody(null)).toThrow(/JSON/)
  })
})

describe('readings for a freezer or room', () => {
  const UNIT = '3b7e1d0a-5a3c-4c52-8d8f-0a7a0c1d2e3f'
  const reading = { feed: 'Temperature', value: -80.1 }

  it('goes to the storage readings call', async () => {
    const { deps, calls } = setup()

    const unit = await handleStream(
      post({ storageUnitId: UNIT, readings: [reading] }),
      deps,
    )

    expect(unit.status).toBe(201)

    const room = await handleStream(
      post({ storageRoomId: UNIT, readings: [reading] }),
      deps,
    )

    expect(room.status).toBe(201)
    expect(
      calls.map((c) => [c.name, c.args['p_unit_id'], c.args['p_room_id']]),
    ).toEqual([
      ['record_storage_readings', UNIT, null],
      ['record_storage_readings', null, UNIT],
    ])
  })

  it('wants exactly one place named', () => {
    expect(() =>
      parseStreamBody({
        instrumentId: INSTRUMENT,
        storageUnitId: UNIT,
        readings: [reading],
      }),
    ).toThrow(/Name one place/)
    expect(() => parseStreamBody({ readings: [reading] })).toThrow(
      /Name one place/,
    )
    expect(() =>
      parseStreamBody({ storageRoomId: 'nope', readings: [reading] }),
    ).toThrow(/storageRoomId must be the id of the room/)
  })
})

describe('handleStream', () => {
  it('hands a batch to the database as the token’s owner', async () => {
    const { deps, calls } = setup()
    const response = await handleStream(post(batch), deps)
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ stored: 1, feeds: 1 })
    expect(calls).toEqual([
      {
        name: 'record_instrument_readings',
        args: {
          p_instrument_id: INSTRUMENT,
          p_readings: [
            {
              feed: 'Weight',
              value: 12.5,
              unit: 'g',
              at: '2026-11-05T09:00:00.000Z',
            },
          ],
        },
      },
    ])
  })

  it('wants a post, a token, a personal token and the right scope', async () => {
    const { deps } = setup()
    expect(
      (await handleStream(new Request('http://eln.test/x'), deps)).status,
    ).toBe(405)
    expect(
      (await handleStream(post(batch, { authorization: '' }), deps)).status,
    ).toBe(401)
    const service = setup({ claims: { ...personal, role: 'api_client' } })
    expect((await handleStream(post(batch), service.deps)).status).toBe(403)
    const noScope = setup({ claims: { ...personal, scopes: ['files:write'] } })
    expect((await handleStream(post(batch), noScope.deps)).status).toBe(403)
    const revoked = setup()
    revoked.deps.verifyCredential = async () => {
      throw new ExternalTokenError('invalid_token', 'revoked')
    }

    expect((await handleStream(post(batch), revoked.deps)).status).toBe(401)
  })

  it('refuses what is not JSON or is too big', async () => {
    const { deps } = setup()

    const malformed = new Request('http://eln.test/api/connectors/stream', {
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: '{nope',
    })

    expect((await handleStream(malformed, deps)).status).toBe(400)

    const huge = await handleStream(
      post(batch, { 'content-length': '9999999' }),
      deps,
    )

    expect(huge.status).toBe(413)
  })

  it('tells the agent whether to give up or try again', async () => {
    const denied = setup({
      rpcError: new DataClientError('42501', 'instrument denied', 403),
    })

    const forbidden = await handleStream(post(batch), denied.deps)
    expect(forbidden.status).toBe(403)
    expect((await forbidden.json()).error.code).toBe('forbidden')

    const refused = setup({
      rpcError: new DataClientError(
        '22023',
        'the value for x must be a number',
        400,
      ),
    })

    expect((await handleStream(post(batch), refused.deps)).status).toBe(422)

    const down = setup({ rpcError: new DataClientError('XX000', 'boom', 503) })
    expect((await handleStream(post(batch), down.deps)).status).toBe(502)
  })
})
