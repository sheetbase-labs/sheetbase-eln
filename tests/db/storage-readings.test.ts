/**
 * Freezer and room readings (migration 0097).
 *
 * Proves: anyone who can write in the workspace can send or log readings for a
 * storage unit or a room (a viewer and a stranger cannot); a new Temperature feed
 * starts with the place's own range as its limits; going out of range tells the
 * people who manage storage once, and tells them again when it is back; limits
 * are for the people who manage storage; instruments keep working as before.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase, setActorJwt } from './helpers'

const WS = '00000000-0000-4000-8000-0000000090a0'
const OTHER_WS = '00000000-0000-4000-8000-0000000090a1'
const OWNER = 'store-owner'
const STEWARD = 'store-steward'
const SCIENTIST = 'store-scientist'
const VIEWER = 'store-viewer'
const STRANGER = 'store-stranger'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []
let unitId: string
let roomId: string

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  for (const user of [OWNER, STEWARD, SCIENTIST, VIEWER, STRANGER]) {
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values($1,$1,$2,true)`,
      [user, `${user}@test.invalid`],
    )
  }
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values($1,'stores','Stores'),($2,'stores-other','Other')`,
    [WS, OTHER_WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values
     ($1,$2,'owner'),($1,$3,'steward'),($1,$4,'scientist'),($1,$5,'viewer'),($6,$7,'owner')`,
    [WS, OWNER, STEWARD, SCIENTIST, VIEWER, OTHER_WS, STRANGER],
  )
  const site = (
    await migrator.query<{ id: string }>(
      `insert into api.storage_sites(workspace_id,name,code) values($1,'Main','MAIN') returning id`,
      [WS],
    )
  ).rows[0]!.id
  roomId = (
    await migrator.query<{ id: string }>(
      `insert into api.storage_rooms(workspace_id,site_id,name,code,temperature_min_c,temperature_max_c)
       values($1,$2,'Cold room','CR',2,8) returning id`,
      [WS, site],
    )
  ).rows[0]!.id
  unitId = (
    await migrator.query<{ id: string }>(
      `insert into api.storage_units(workspace_id,room_id,name,code,unit_type,temperature_min_c,temperature_max_c)
       values($1,$2,'Freezer F-01','F01','freezer',-90,-70) returning id`,
      [WS, roomId],
    )
  ).rows[0]!.id
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

function sendUnit(client: Client, readings: unknown, id = unitId) {
  return client.query<{
    record_storage_readings: { stored: number; feeds: number }
  }>('select * from api.record_storage_readings($1,null,$2::jsonb)', [
    id,
    JSON.stringify(readings),
  ])
}

function sendRoom(client: Client, readings: unknown) {
  return client.query(
    'select * from api.record_storage_readings(null,$1,$2::jsonb)',
    [roomId, JSON.stringify(readings)],
  )
}

async function unitFeed(name: string) {
  const { rows } = await migrator.query(
    `select * from api.instrument_feeds where storage_unit_id = $1 and name = $2`,
    [unitId, name],
  )
  return rows[0] as
    | {
        id: string
        unit: string | null
        low_limit: number | null
        high_limit: number | null
        last_value: number | null
        limit_state: string
        out_of_range_since: string | null
      }
    | undefined
}

async function alarms() {
  const { rows } = await migrator.query<{ user_id: string; title: string }>(
    `select user_id,title from internal.notifications
      where event_type = 'storage_alarm' and workspace_id = $1 order by created_at, id`,
    [WS],
  )
  return rows
}

describe('sending readings for a freezer or room', () => {
  it('is for people who can write in the workspace', async () => {
    const readings = [{ feed: 'Temperature', value: -80.2, at: minutesAgo(60) }]
    await expectDenied(sendUnit(await actor(VIEWER), readings), '42501')
    await expectDenied(
      sendUnit(await actor(STRANGER, OTHER_WS), readings),
      '42501',
    )
    const { rows } = await sendUnit(await actor(SCIENTIST), readings)
    expect(rows[0]!.record_storage_readings).toEqual({ stored: 1, feeds: 1 })
  })

  it('needs exactly one of a unit or a room', async () => {
    const scientist = await actor(SCIENTIST)
    await expect(
      scientist.query(
        'select * from api.record_storage_readings($1,$2,$3::jsonb)',
        [unitId, roomId, '[{"feed":"Temperature","value":1}]'],
      ),
    ).rejects.toMatchObject({ code: '22023' })
  })

  it('starts a Temperature feed with the place’s own range as its limits', async () => {
    const feed = await unitFeed('Temperature')
    expect(feed).toMatchObject({
      unit: '°C',
      low_limit: -90,
      high_limit: -70,
      limit_state: 'ok',
    })
    await sendRoom(await actor(SCIENTIST), [{ feed: 'Temperature', value: 5 }])
    const { rows } = await migrator.query(
      `select low_limit, high_limit from api.instrument_feeds where storage_room_id = $1`,
      [roomId],
    )
    expect(rows[0]).toMatchObject({ low_limit: 2, high_limit: 8 })
  })

  it('refuses a bad reading whole', async () => {
    const scientist = await actor(SCIENTIST)
    await expect(
      sendUnit(scientist, [
        { feed: 'Door', value: 1 },
        { feed: 'Door', value: 'open' },
      ]),
    ).rejects.toMatchObject({ code: '22023' })
    expect(await unitFeed('Door')).toBeUndefined()
  })
})

describe('going out of range', () => {
  it('tells the people who manage storage once, and again when back in range', async () => {
    const scientist = await actor(SCIENTIST)
    await sendUnit(scientist, [{ feed: 'Temperature', value: -60 }])
    let notices = await alarms()
    expect(notices.map((n) => n.user_id).sort()).toEqual([OWNER, STEWARD])
    expect(notices[0]!.title).toBe(
      'Temperature in Freezer F-01 is above its limit',
    )
    expect((await unitFeed('Temperature'))!.out_of_range_since).not.toBeNull()

    // Still out of range: nobody is told again.
    await sendUnit(scientist, [{ feed: 'Temperature', value: -55 }])
    expect(await alarms()).toHaveLength(2)

    await sendUnit(scientist, [{ feed: 'Temperature', value: -80 }])
    notices = await alarms()
    expect(notices).toHaveLength(4)
    expect(notices.at(-1)!.title).toBe(
      'Temperature in Freezer F-01 is back in range',
    )
    expect((await unitFeed('Temperature'))!.out_of_range_since).toBeNull()

    // The same moments are events for webhooks and the stream.
    const { rows: events } = await migrator.query<{
      operation: string
      payload: { state: string; feed: string; storageUnitId: string }
    }>(
      `select operation, payload from api.change_events
        where workspace_id = $1 and entity_type = 'storage_alarm' order by sequence`,
      [WS],
    )
    expect(events.map((e) => e.operation)).toEqual(['create', 'resolve'])
    expect(events[0]!.payload).toMatchObject({
      state: 'high',
      feed: 'Temperature',
      storageUnitId: unitId,
    })
    expect(events[1]!.payload.state).toBe('ok')
  })
})

describe('reading them back', () => {
  it('lists each measurement with its limits, and only the out-of-range ones on request', async () => {
    const scientist = await actor(SCIENTIST)
    await sendUnit(scientist, [{ feed: 'Humidity', value: 40, unit: '%' }])
    await sendUnit(scientist, [{ feed: 'Temperature', value: -50 }])
    const all = await scientist.query<{
      query_storage_readings: Array<{ feed: string; state: string }>
    }>('select api.query_storage_readings($1,null,false,100)', [unitId])
    expect(all.rows[0]!.query_storage_readings.map((r) => r.feed)).toEqual([
      'Humidity',
      'Temperature',
    ])
    const out = await scientist.query<{
      query_storage_readings: Array<{ feed: string; state: string }>
    }>('select api.query_storage_readings(null,null,true,100)')
    expect(out.rows[0]!.query_storage_readings).toMatchObject([
      { feed: 'Temperature', state: 'high' },
    ])
    // Someone from another workspace sees none of it.
    const stranger = await actor(STRANGER, OTHER_WS)
    const none = await stranger.query<{ query_storage_readings: unknown[] }>(
      'select api.query_storage_readings(null,null,false,100)',
    )
    expect(none.rows[0]!.query_storage_readings).toEqual([])
  })
})

describe('limits', () => {
  it('are for the people who manage storage', async () => {
    const feed = (await unitFeed('Temperature'))!
    await expectDenied(
      (await actor(SCIENTIST)).query(
        'select * from api.set_instrument_feed_limits($1,$2,$3)',
        [feed.id, -85, -75],
      ),
      '42501',
    )
    const { rows } = await (
      await actor(STEWARD)
    ).query('select * from api.set_instrument_feed_limits($1,$2,$3)', [
      feed.id,
      -85,
      -75,
    ])
    expect(rows[0]).toMatchObject({ low_limit: -85, high_limit: -75 })
  })

  it('can be removed with their readings by the same people', async () => {
    const feed = (await unitFeed('Temperature'))!
    await expectDenied(
      (await actor(VIEWER)).query('select api.remove_instrument_feed($1)', [
        feed.id,
      ]),
      '42501',
    )
    await (
      await actor(OWNER)
    ).query('select api.remove_instrument_feed($1)', [feed.id])
    const { rows } = await migrator.query(
      `select count(*)::int as n from api.instrument_readings where feed_id = $1`,
      [feed.id],
    )
    expect(rows[0].n).toBe(0)
  })
})
