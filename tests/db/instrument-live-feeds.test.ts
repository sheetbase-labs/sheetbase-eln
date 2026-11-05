/**
 * Live readings from an instrument (migration 0068).
 *
 * Proves: anyone who can write in the workspace can send readings (a viewer and
 * a stranger cannot); feeds are made on first sight and keep their latest value,
 * count and unit; bad readings are refused whole; readings are cut into slices
 * for a chart; limits are for the people who run instruments, and the owner is
 * told once when a measurement goes out of range and once when it is back; a
 * retired instrument takes nothing; removing a feed removes its readings.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase, setActorJwt } from './helpers'

const WS = '00000000-0000-4000-8000-0000000068a0'
const OTHER_WS = '00000000-0000-4000-8000-0000000068a1'
const ADMIN = 'feed-admin'
const SCIENTIST = 'feed-scientist'
const VIEWER = 'feed-viewer'
const STRANGER = 'feed-stranger'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []
let instrumentId: string
let retiredId: string

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  for (const user of [ADMIN, SCIENTIST, VIEWER, STRANGER]) {
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values($1,$1,$2,true)`,
      [user, `${user}@test.invalid`],
    )
  }
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values($1,'feeds','Feeds'),($2,'feeds-other','Other')`,
    [WS, OTHER_WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values
     ($1,$2,'owner'),($1,$3,'scientist'),($1,$4,'viewer'),($5,$6,'owner')`,
    [WS, ADMIN, SCIENTIST, VIEWER, OTHER_WS, STRANGER],
  )
  const admin = await actor(ADMIN)
  const create = async (name: string) =>
    (
      await admin.query<{ id: string }>(
        `select * from api.create_instrument($1,$2,'other',null,null,null,'Cold room',$3,'{}'::jsonb,0,'none')`,
        [WS, name, ADMIN],
      )
    ).rows[0]!.id
  instrumentId = await create('Freezer F-01')
  retiredId = await create('Old incubator')
  await migrator.query(
    `update api.instruments set retired_at = now() where id = $1`,
    [retiredId],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

async function actor(userId: string, workspace = WS): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('set role authenticated')
  await setActorJwt(client, userId, workspace)
  return client
}

const minutesAgo = (n: number) =>
  new Date(Date.now() - n * 60_000).toISOString()

async function send(client: Client, readings: unknown, id = instrumentId) {
  return client.query<{
    record_instrument_readings: { stored: number; feeds: number }
  }>('select * from api.record_instrument_readings($1,$2::jsonb)', [
    id,
    JSON.stringify(readings),
  ])
}

async function feed(name: string) {
  const { rows } = await migrator.query(
    `select * from api.instrument_feeds where instrument_id = $1 and name = $2`,
    [instrumentId, name],
  )
  return rows[0] as
    | {
        id: string
        unit: string | null
        last_value: number | null
        reading_count: string
        limit_state: string
      }
    | undefined
}

async function notices() {
  const { rows } = await migrator.query<{
    user_id: string
    title: string
    body: string
  }>(
    `select user_id,title,body from internal.notifications
      where event_type = 'instrument_service' and workspace_id = $1 order by created_at, id`,
    [WS],
  )
  return rows
}

describe('sending readings', () => {
  it('is for people who can write in the workspace', async () => {
    const readings = [{ feed: 'Temperature', value: -80.2, at: minutesAgo(60) }]
    await expectDenied(send(await actor(VIEWER), readings), '42501')
    await expectDenied(send(await actor(STRANGER, OTHER_WS), readings), '42501')
    const { rows } = await send(await actor(SCIENTIST), readings)
    expect(rows[0]!.record_instrument_readings).toEqual({ stored: 1, feeds: 1 })
  })

  it('makes a feed on first sight and keeps its latest value, unit and count', async () => {
    const scientist = await actor(SCIENTIST)
    await send(scientist, [
      { feed: 'Weight', value: 10.5, unit: 'g', at: minutesAgo(5) },
      { feed: 'Weight', value: 11.5, at: minutesAgo(3) },
      { feed: 'Weight', value: 9.5, at: minutesAgo(9) },
    ])
    const weight = await feed('Weight')
    expect(weight).toMatchObject({ unit: 'g', last_value: 11.5 })
    expect(Number(weight!.reading_count)).toBe(3)
    const { rows } = await migrator.query(
      `select connection_status, last_connected_at from api.instruments where id = $1`,
      [instrumentId],
    )
    expect(rows[0].connection_status).toBe('connected')
    expect(rows[0].last_connected_at).not.toBeNull()
  })

  it('refuses a bad batch whole', async () => {
    const scientist = await actor(SCIENTIST)
    for (const bad of [
      [],
      [{ feed: '', value: 1 }],
      [{ feed: 'pH', value: '7.1' }],
      [
        {
          feed: 'pH',
          value: 7,
          at: new Date(Date.now() + 3 * 86_400_000).toISOString(),
        },
      ],
      [
        {
          feed: 'pH',
          value: 7,
          at: new Date(Date.now() - 200 * 86_400_000).toISOString(),
        },
      ],
      [
        { feed: 'pH', value: 7 },
        { feed: 'x'.repeat(81), value: 1 },
      ],
      { feed: 'pH', value: 7 },
    ]) {
      await expectDenied(send(scientist, bad), '22023')
    }
    expect(await feed('pH')).toBeUndefined()
  })

  it('takes nothing for a retired instrument', async () => {
    await expectDenied(
      send(
        await actor(SCIENTIST),
        [{ feed: 'Temperature', value: 1 }],
        retiredId,
      ),
      '22023',
    )
  })

  it('caps the feeds on one instrument', async () => {
    const scientist = await actor(SCIENTIST)
    const many = Array.from({ length: 60 }, (_, i) => ({
      feed: `Probe ${i}`,
      value: i,
    }))
    await expectDenied(send(scientist, many), '22023')
  })
})

describe('reading a series', () => {
  it('cuts a window into slices with the lowest, average and highest', async () => {
    const reader = await actor(VIEWER)
    const weight = (await feed('Weight'))!
    const { rows } = await reader.query<{
      min_value: number
      avg_value: number
      max_value: number
      readings: string
    }>(
      `select * from api.list_instrument_feed_series($1, now() - interval '15 minutes', now(), 1)`,
      [weight.id],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      min_value: 9.5,
      avg_value: 10.5,
      max_value: 11.5,
    })
    expect(Number(rows[0]!.readings)).toBe(3)
    const narrow = await reader.query(
      `select * from api.list_instrument_feed_series($1, now() - interval '4 minutes', now(), 240)`,
      [weight.id],
    )
    expect(narrow.rows).toHaveLength(1)
  })

  it('cannot be read from another workspace', async () => {
    const weight = (await feed('Weight'))!
    const stranger = await actor(STRANGER, OTHER_WS)
    const { rows } = await stranger.query(
      `select * from api.list_instrument_feed_series($1, now() - interval '1 day', now(), 10)`,
      [weight.id],
    )
    expect(rows).toHaveLength(0)
    const feeds = await stranger.query('select * from api.instrument_feeds')
    expect(feeds.rows).toHaveLength(0)
  })
})

describe('limits', () => {
  it('are set by the people who run instruments', async () => {
    const weight = (await feed('Weight'))!
    await expectDenied(
      (await actor(VIEWER)).query(
        'select * from api.set_instrument_feed_limits($1,1,2)',
        [weight.id],
      ),
      '42501',
    )
    await expectDenied(
      (await actor(ADMIN)).query(
        'select * from api.set_instrument_feed_limits($1,5,2)',
        [weight.id],
      ),
      '22023',
    )
  })

  it('tell the owner once when a measurement goes out of range and once when it is back', async () => {
    const admin = await actor(ADMIN)
    const scientist = await actor(SCIENTIST)
    const temp = (await feed('Temperature'))!
    await admin.query(
      'select * from api.set_instrument_feed_limits($1,$2,$3,$4)',
      [temp.id, -85, -70, '°C'],
    )
    const before = (await notices()).length

    await send(scientist, [
      { feed: 'Temperature', value: -60, at: minutesAgo(2) },
    ])
    await send(scientist, [
      { feed: 'Temperature', value: -55, at: minutesAgo(1) },
    ])
    let now = await notices()
    expect(now).toHaveLength(before + 1)
    expect(now.at(-1)).toMatchObject({ user_id: ADMIN })
    expect(now.at(-1)!.title).toMatch(
      /Temperature on Freezer F-01 is above its limit/,
    )
    expect(now.at(-1)!.body).toMatch(/-60 °C, over -70 °C/)
    expect((await feed('Temperature'))!.limit_state).toBe('high')

    await send(scientist, [
      { feed: 'Temperature', value: -79, at: minutesAgo(0.5) },
    ])
    now = await notices()
    expect(now).toHaveLength(before + 2)
    expect(now.at(-1)!.title).toMatch(/back in range/)
    expect((await feed('Temperature'))!.limit_state).toBe('ok')

    // An old reading arriving late does not move the latest value or the state.
    await send(scientist, [
      { feed: 'Temperature', value: -10, at: minutesAgo(30) },
    ])
    expect((await notices()).length).toBe(before + 2)
    expect((await feed('Temperature'))!.last_value).toBe(-79)
  })

  it('are checked against the latest reading when they change', async () => {
    const admin = await actor(ADMIN)
    const temp = (await feed('Temperature'))!
    const before = (await notices()).length
    await admin.query(
      'select * from api.set_instrument_feed_limits($1,null,$2)',
      [temp.id, -90],
    )
    expect((await feed('Temperature'))!.limit_state).toBe('high')
    expect(await notices()).toHaveLength(before + 1)
    await admin.query(
      'select * from api.set_instrument_feed_limits($1,null,null)',
      [temp.id],
    )
    expect((await feed('Temperature'))!.limit_state).toBe('ok')
  })
})

describe('removing a feed', () => {
  it('removes its readings and is for the people who run instruments', async () => {
    const weight = (await feed('Weight'))!
    await expectDenied(
      (await actor(VIEWER)).query('select api.remove_instrument_feed($1)', [
        weight.id,
      ]),
      '42501',
    )
    await (
      await actor(ADMIN)
    ).query('select api.remove_instrument_feed($1)', [weight.id])
    expect(await feed('Weight')).toBeUndefined()
    const { rows } = await migrator.query(
      'select count(*)::int as n from api.instrument_readings where feed_id = $1',
      [weight.id],
    )
    expect(rows[0].n).toBe(0)
  })
})
