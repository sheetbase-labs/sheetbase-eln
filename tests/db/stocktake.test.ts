/**
 * Stocktake: counting a freezer, shelf, rack or box with the scanner. A count
 * snapshots what should be there, scanning marks each item confirmed,
 * misplaced or unexpected, finishing turns the unseen into missing, and the
 * fixes go through the same moves and disposals as doing them by hand.
 * Runs against a freshly migrated sheetbase_test database.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000e601'
const PROJECT = '00000000-0000-4000-8000-00000000e611'
const OWNER = 'stk-owner'
const VIEWER = 'stk-viewer'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []
let owner: Client
let unit: string
let rack: string
let boxA: string
let boxB: string
let boxC: string

async function actor(userId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ sub: userId, workspace_id: WS, role: 'authenticated' }),
  ])
  return client
}

async function record(
  kind: 'sample' | 'material',
  title: string,
  properties: Record<string, unknown> = {},
): Promise<{ id: string; identifier: string; metadata_version: number }> {
  const { rows } = await owner.query(
    `select id, identifier, metadata_version from api.create_record($1::uuid,$2,$3,'available',ARRAY[]::text[],$4::jsonb)`,
    [PROJECT, kind, title, JSON.stringify(properties)],
  )
  return rows[0]
}

async function file(
  sample: { id: string; metadata_version: number },
  box: string,
  label: string,
) {
  const { rows } = await migrator.query(
    `select id from api.storage_positions where box_id = $1 and label = $2`,
    [box, label],
  )
  await owner.query(`select api.move_sample_to_position($1,$2,$3,null)`, [
    sample.id,
    rows[0].id,
    sample.metadata_version,
  ])
}

async function start(level: string, scope: string, note: string | null = null) {
  const { rows } = await owner.query(
    `select * from api.start_stocktake($1,$2,$3)`,
    [level, scope, note],
  )
  return rows[0] as { id: string; number: number; scope_path: string }
}

async function items(stocktakeId: string) {
  const { rows } = await migrator.query(
    `select i.*, r.identifier as rid from api.stocktake_items i join api.records r on r.id = i.record_id where stocktake_id = $1 order by r.identifier`,
    [stocktakeId],
  )
  return rows as Array<{
    record_id: string
    state: string
    expected: boolean
    record_kind: string
    found_box_id: string | null
    resolution: string | null
  }>
}

async function scan(stocktakeId: string, recordId: string, box?: string) {
  const { rows } = await owner.query(
    `select * from api.record_stocktake_scan($1,$2,$3)`,
    [stocktakeId, recordId, box ?? null],
  )
  return rows[0] as { state: string; found_path: string | null }
}

async function holder(box: string, label: string): Promise<string | null> {
  const { rows } = await migrator.query(
    `select occupied_record_id from api.storage_positions where box_id = $1 and label = $2`,
    [box, label],
  )
  return rows[0].occupied_record_id
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(`
    insert into internal."user"(id,name,email,"emailVerified") values
      ('${OWNER}','Owner','stk-owner@test.invalid',true),
      ('${VIEWER}','Viewer','stk-viewer@test.invalid',true);
    insert into api.workspaces(id,slug,name) values ('${WS}','stocktake','Stocktake');
    insert into api.workspace_memberships(workspace_id,user_id,role) values
      ('${WS}','${OWNER}','owner'),
      ('${WS}','${VIEWER}','viewer');
    insert into api.projects(id,workspace_id,key,title,lead_user_id)
      values ('${PROJECT}','${WS}','stk','Stocktake','${OWNER}')`)
  const one = async (text: string, values: unknown[]) =>
    (await migrator.query(text, values)).rows[0].id as string
  const site = await one(
    `insert into api.storage_sites(workspace_id,name,code) values($1,'Lab','LAB') returning id`,
    [WS],
  )
  const room = await one(
    `insert into api.storage_rooms(workspace_id,site_id,name,code) values($1,$2,'Room 1','R1') returning id`,
    [WS, site],
  )
  unit = await one(
    `insert into api.storage_units(workspace_id,room_id,name,code,unit_type) values($1,$2,'Freezer F-9','F-9','freezer') returning id`,
    [WS, room],
  )
  const shelf = await one(
    `insert into api.storage_shelves(workspace_id,unit_id,name,position) values($1,$2,'Shelf 1',1) returning id`,
    [WS, unit],
  )
  rack = await one(
    `insert into api.storage_racks(workspace_id,shelf_id,name,position) values($1,$2,'Rack A',1) returning id`,
    [WS, shelf],
  )
  owner = await actor(OWNER)
  const mk = async (name: string, code: string) =>
    (
      await owner.query(
        `select id from api.create_storage_box($1,$2,$3,$4,2,3)`,
        [WS, rack, name, code],
      )
    ).rows[0].id as string
  boxA = await mk('Box 1', 'B1')
  boxB = await mk('Box 2', 'B2')
  const otherRack = await one(
    `insert into api.storage_racks(workspace_id,shelf_id,name,position) values($1,$2,'Rack B',2) returning id`,
    [WS, shelf],
  )
  boxC = (
    await owner.query(
      `select id from api.create_storage_box($1,$2,'Box 3','B3',2,3)`,
      [WS, otherRack],
    )
  ).rows[0].id
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

describe('starting a count', () => {
  it('lists the samples filed in the box and the lots stored there', async () => {
    const s1 = await record('sample', 'In box one')
    const s2 = await record('sample', 'Also in box one')
    const other = await record('sample', 'In box two')
    await file(s1, boxA, 'A1')
    await file(s2, boxA, 'A2')
    await file(other, boxB, 'A1')
    const lot = await record('material', 'Buffer lot', {
      storage: 'Lab / Room 1 / Freezer F-9 / Shelf 1 / Rack A / Box 1',
    })
    const elsewhere = await record('material', 'Water lot', { storage: '4 °C' })

    const st = await start('box', boxA)
    expect(st.scope_path).toBe(
      'Lab / Room 1 / Freezer F-9 / Shelf 1 / Rack A / Box 1',
    )
    const list = await items(st.id)
    const ids = list.map((i) => i.record_id)
    expect(ids).toEqual(expect.arrayContaining([s1.id, s2.id, lot.id]))
    expect(ids).not.toContain(other.id)
    expect(ids).not.toContain(elsewhere.id)
    expect(list.every((i) => i.state === 'expected' && i.expected)).toBe(true)
    await owner.query(`select api.cancel_stocktake($1)`, [st.id])
  })

  it('counts every box under a unit', async () => {
    const st = await start('unit', unit)
    const list = await items(st.id)
    expect(list.length).toBeGreaterThanOrEqual(3)
    await owner.query(`select api.cancel_stocktake($1)`, [st.id])
  })

  it('allows one open count per place, and a viewer cannot start one', async () => {
    const st = await start('rack', rack)
    await expectDenied(
      owner.query(`select api.start_stocktake('rack',$1,null)`, [rack]),
      '23505',
    )
    const viewer = await actor(VIEWER)
    await expectDenied(
      viewer.query(`select api.start_stocktake('box',$1,null)`, [boxB]),
      '42501',
    )
    await owner.query(`select api.cancel_stocktake($1)`, [st.id])
  })

  it('refuses a place with nothing to count', async () => {
    await expectDenied(
      owner.query(
        `select api.start_stocktake('box','00000000-0000-4000-8000-0000000000ff',null)`,
      ),
      'SB011',
    )
  })
})

describe('walking a rack', () => {
  it('finds confirmed, misplaced, unexpected and missing items, then fixes them', async () => {
    const here = await record('sample', 'Where it should be')
    const strayed = await record('sample', 'Put back in the wrong box')
    const lost = await record('sample', 'Nowhere to be found')
    const guest = await record('sample', 'Belongs to no position')
    const lotHere = await record('material', 'Lot on the shelf', {
      storage: 'Lab / Room 1 / Freezer F-9 / Shelf 1 / Rack A / Box 2',
    })
    await file(here, boxA, 'B1')
    await file(strayed, boxA, 'B2')
    await file(lost, boxB, 'B1')

    const st = await start('rack', rack, 'Quarterly check')

    expect((await scan(st.id, here.id, boxA)).state).toBe('confirmed')
    const wrong = await scan(st.id, strayed.id, boxB)
    expect(wrong.state).toBe('misplaced')
    expect(wrong.found_path).toBe(
      'Lab / Room 1 / Freezer F-9 / Shelf 1 / Rack A / Box 2',
    )
    expect((await scan(st.id, guest.id, boxB)).state).toBe('unexpected')
    expect((await scan(st.id, lotHere.id, boxB)).state).toBe('confirmed')

    // A sample needs to know which box it was found in.
    await expectDenied(
      owner.query(`select api.record_stocktake_scan($1,$2,null)`, [
        st.id,
        here.id,
      ]),
      '22023',
    )
    // A box outside the count is refused.
    await expectDenied(
      owner.query(`select api.record_stocktake_scan($1,$2,$3)`, [
        st.id,
        here.id,
        boxC,
      ]),
      '22023',
    )

    // Cannot fix anything before the count is finished.
    const open = await items(st.id)
    const strayedItem = open.find((i) => i.record_id === strayed.id)!
    const strayedRow = (
      await migrator.query(
        `select id from api.stocktake_items where stocktake_id=$1 and record_id=$2`,
        [st.id, strayed.id],
      )
    ).rows[0].id
    await expectDenied(
      owner.query(`select api.resolve_stocktake_item($1,'refile',null)`, [
        strayedRow,
      ]),
      '22023',
    )
    expect(strayedItem.state).toBe('misplaced')

    await owner.query(`select api.complete_stocktake($1)`, [st.id])
    const done = await items(st.id)
    const state = (id: string) => done.find((i) => i.record_id === id)?.state
    expect(state(here.id)).toBe('confirmed')
    expect(state(strayed.id)).toBe('misplaced')
    expect(state(guest.id)).toBe('unexpected')
    expect(state(lost.id)).toBe('missing')
    // Nothing more can be counted once it is finished.
    await expectDenied(
      owner.query(`select api.record_stocktake_scan($1,$2,$3)`, [
        st.id,
        here.id,
        boxA,
      ]),
      '22023',
    )

    const rowOf = async (id: string) =>
      (
        await migrator.query(
          `select id from api.stocktake_items where stocktake_id=$1 and record_id=$2`,
          [st.id, id],
        )
      ).rows[0].id as string

    // Refile the stray sample where it was found: first free position of box 2.
    await owner.query(`select api.resolve_stocktake_item($1,'refile',null)`, [
      await rowOf(strayed.id),
    ])
    expect(await holder(boxA, 'B2')).toBeNull()
    // Box 2 already holds a sample at A1 from the first test; A2 is next free.
    expect(await holder(boxB, 'A2')).toBe(strayed.id)

    // File the unexpected one where it was found.
    await owner.query(`select api.resolve_stocktake_item($1,'refile',null)`, [
      await rowOf(guest.id),
    ])
    expect(await holder(boxB, 'A3')).toBe(guest.id)
    expect(await holder(boxB, 'B1')).toBe(lost.id)

    // A missing sample is disposed of as lost; the position it held is freed.
    await owner.query(
      `select api.resolve_stocktake_item($1,'mark_lost','gone')`,
      [await rowOf(lost.id)],
    )
    const disposed = await migrator.query(
      `select status, properties->>'disposalReason' as reason from api.records where id = $1`,
      [lost.id],
    )
    expect(disposed.rows[0].status).toBe('disposed')
    expect(disposed.rows[0].reason).toContain(
      `ST-${String(st.number).padStart(4, '0')}`,
    )
    expect(await holder(boxB, 'B1')).toBeNull()

    // Each item is fixed once.
    await expectDenied(
      owner.query(`select api.resolve_stocktake_item($1,'accept',null)`, [
        await rowOf(strayed.id),
      ]),
      '22023',
    )
    // A confirmed item has nothing to fix.
    await expectDenied(
      owner.query(`select api.resolve_stocktake_item($1,'accept',null)`, [
        await rowOf(here.id),
      ]),
      '22023',
    )
    const after = await items(st.id)
    expect(after.find((i) => i.record_id === lost.id)?.resolution).toBe(
      'mark_lost',
    )
  })

  it('treats a lot as missing, then clears where it was kept', async () => {
    const lot = await record('material', 'Lot that went', {
      storage: 'Lab / Room 1 / Freezer F-9 / Shelf 1 / Rack B / Box 3',
    })
    const st = await start('box', boxC)
    await owner.query(`select api.complete_stocktake($1)`, [st.id])
    const row = (
      await migrator.query(
        `select id, state from api.stocktake_items where stocktake_id=$1 and record_id=$2`,
        [st.id, lot.id],
      )
    ).rows[0]
    expect(row.state).toBe('missing')
    // Marking a lot lost is a sample action.
    await expectDenied(
      owner.query(`select api.resolve_stocktake_item($1,'mark_lost',null)`, [
        row.id,
      ]),
      '22023',
    )
    await owner.query(
      `select api.resolve_stocktake_item($1,'clear_location',null)`,
      [row.id],
    )
    const after = await migrator.query(
      `select properties ? 'storage' as has from api.records where id = $1`,
      [lot.id],
    )
    expect(after.rows[0].has).toBe(false)
  })

  it('lets a rescan in the right box turn a misplaced item back to confirmed', async () => {
    const s = await record('sample', 'Found it after all')
    await file(s, boxC, 'A1')
    const st = await start('rack', rack)
    // boxC is outside this rack, so the sample is not on this list.
    expect((await items(st.id)).some((i) => i.record_id === s.id)).toBe(false)
    expect((await scan(st.id, s.id, boxA)).state).toBe('unexpected')
    await owner.query(`select api.cancel_stocktake($1)`, [st.id])
  })

  it('lets a viewer read a count but not change it', async () => {
    const st = await start('box', boxB)
    const viewer = await actor(VIEWER)
    const { rows } = await viewer.query(
      `select id from api.stocktakes where id = $1`,
      [st.id],
    )
    expect(rows).toHaveLength(1)
    await expectDenied(
      viewer.query(`select api.complete_stocktake($1)`, [st.id]),
      '42501',
    )
    await owner.query(`select api.cancel_stocktake($1)`, [st.id])
  })
})
