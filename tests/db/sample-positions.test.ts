/**
 * Where a sample sits: moving between positions, the typed-place transfer that
 * frees a held position, consumption freeing it, the matcher that files
 * samples whose typed place names one position, and the results an instrument
 * run records for the samples it measured (which the release gate reads).
 * Runs against a freshly migrated sheetbase_test database.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000d601'
const PROJECT = '00000000-0000-4000-8000-00000000d611'
const OWNER = 'pos-owner'
const VIEWER = 'pos-viewer'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []
let owner: Client
let box: string
let instrument: string

async function actor(userId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ sub: userId, workspace_id: WS, role: 'authenticated' }),
  ])
  return client
}

async function sample(
  title: string,
  properties: Record<string, unknown> = {},
): Promise<{ id: string; identifier: string; metadata_version: number }> {
  const { rows } = await owner.query(
    `select id, identifier, metadata_version from api.create_record($1::uuid,'sample',$2,'available',ARRAY[]::text[],$3::jsonb)`,
    [PROJECT, title, JSON.stringify(properties)],
  )
  return rows[0]
}

async function position(label: string): Promise<string> {
  const { rows } = await migrator.query(
    `select id from api.storage_positions where box_id = $1 and label = $2`,
    [box, label],
  )
  return rows[0].id
}

async function holder(label: string): Promise<string | null> {
  const { rows } = await migrator.query(
    `select occupied_record_id from api.storage_positions where box_id = $1 and label = $2`,
    [box, label],
  )
  return rows[0].occupied_record_id
}

async function current(id: string) {
  const { rows } = await migrator.query(
    `select metadata_version, properties ->> 'storageLocation' as location from api.records where id = $1`,
    [id],
  )
  return rows[0] as { metadata_version: number; location: string | null }
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(`
    insert into internal."user"(id,name,email,"emailVerified") values
      ('${OWNER}','Owner','pos-owner@test.invalid',true),
      ('${VIEWER}','Viewer','pos-viewer@test.invalid',true);
    insert into api.workspaces(id,slug,name) values ('${WS}','positions','Positions');
    insert into api.workspace_memberships(workspace_id,user_id,role) values
      ('${WS}','${OWNER}','owner'),
      ('${WS}','${VIEWER}','viewer');
    insert into api.projects(id,workspace_id,key,title,lead_user_id)
      values ('${PROJECT}','${WS}','pos','Positions','${OWNER}')`)
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
  const unit = await one(
    `insert into api.storage_units(workspace_id,room_id,name,code,unit_type) values($1,$2,'Freezer F-9','F-9','freezer') returning id`,
    [WS, room],
  )
  const shelf = await one(
    `insert into api.storage_shelves(workspace_id,unit_id,name,position) values($1,$2,'Shelf 1',1) returning id`,
    [WS, unit],
  )
  const rack = await one(
    `insert into api.storage_racks(workspace_id,shelf_id,name,position) values($1,$2,'Rack A',1) returning id`,
    [WS, shelf],
  )
  owner = await actor(OWNER)
  box = (
    await owner.query(
      `select id from api.create_storage_box($1,$2,'Box 1','B1',3,4)`,
      [WS, rack],
    )
  ).rows[0].id

  instrument = await one(
    `insert into api.instruments(workspace_id,name,instrument_type) values($1,'Reader','other') returning id`,
    [WS],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

describe('moving to a position', () => {
  it('files a sample, then moves it and frees the one it left', async () => {
    const s = await sample('Move me')
    await owner.query(`select api.move_sample_to_position($1,$2,$3,null)`, [
      s.id,
      await position('A1'),
      s.metadata_version,
    ])
    expect(await holder('A1')).toBe(s.id)
    const placed = await current(s.id)
    expect(placed.location).toBe(
      'Lab / Room 1 / Freezer F-9 / Shelf 1 / Rack A / Box 1 / A1',
    )
    await owner.query(`select api.move_sample_to_position($1,$2,$3,null)`, [
      s.id,
      await position('A2'),
      placed.metadata_version,
    ])
    expect(await holder('A1')).toBeNull()
    expect(await holder('A2')).toBe(s.id)
  })

  it('refuses a position that is taken, and one the sample is already in', async () => {
    const a = await sample('First')
    const b = await sample('Second')
    await owner.query(`select api.move_sample_to_position($1,$2,$3,null)`, [
      a.id,
      await position('B1'),
      a.metadata_version,
    ])
    await expectDenied(
      owner.query(`select api.move_sample_to_position($1,$2,$3,null)`, [
        b.id,
        await position('B1'),
        b.metadata_version,
      ]),
      'SB010',
    )
    const now = await current(a.id)
    await expectDenied(
      owner.query(`select api.move_sample_to_position($1,$2,$3,null)`, [
        a.id,
        await position('B1'),
        now.metadata_version,
      ]),
      'SB012',
    )
  })

  it('does not let a viewer move a sample', async () => {
    const s = await sample('Not yours')
    const viewer = await actor(VIEWER)
    await expectDenied(
      viewer.query(`select api.move_sample_to_position($1,$2,$3,null)`, [
        s.id,
        await position('C1'),
        s.metadata_version,
      ]),
      '42501',
    )
  })
})

describe('leaving a position', () => {
  it('frees the position when a sample moves to a typed place', async () => {
    const s = await sample('Typed out')
    await owner.query(`select api.move_sample_to_position($1,$2,$3,null)`, [
      s.id,
      await position('C2'),
      s.metadata_version,
    ])
    const now = await current(s.id)
    await owner.query(`select api.transfer_sample($1,$2,$3,null)`, [
      s.id,
      'Bench 4',
      now.metadata_version,
    ])
    expect(await holder('C2')).toBeNull()
    expect((await current(s.id)).location).toBe('Bench 4')
  })

  it('frees the position when the sample is used up', async () => {
    const s = await sample('Used up')
    await owner.query(`select api.move_sample_to_position($1,$2,$3,null)`, [
      s.id,
      await position('C3'),
      s.metadata_version,
    ])
    await migrator.query(
      `update api.records set status = 'consumed' where id = $1`,
      [s.id],
    )
    expect(await holder('C3')).toBeNull()
  })
})

describe('matching typed places to positions', () => {
  it('files samples whose place names one free position and leaves the rest', async () => {
    const named = await sample('Named', {
      storageLocation: 'Freezer F-9, box 1, C4',
    })
    const vague = await sample('Vague', { storageLocation: 'Freezer F-9' })
    const result = await owner.query(
      `select api.match_sample_locations($1) as r`,
      [WS],
    )
    expect(result.rows[0].r.matched).toBeGreaterThanOrEqual(1)
    expect(await holder('C4')).toBe(named.id)
    expect((await current(vague.id)).location).toBe('Freezer F-9')
  })

  it('is for people who manage storage', async () => {
    const viewer = await actor(VIEWER)
    await expectDenied(
      viewer.query(`select api.match_sample_locations($1)`, [WS]),
      '42501',
    )
  })
})

describe('results recorded for a run', () => {
  async function run(name: string): Promise<string> {
    const { rows } = await owner.query(
      `select id from api.create_instrument_run(p_workspace_id => $1, p_name => $2, p_run_identifier => $2, p_instrument_id => $3)`,
      [WS, name, instrument],
    )
    return rows[0].id
  }

  it('links the samples a run measured and lets the release gate pass from them', async () => {
    const s = await sample('Harvest A', { sampleType: 'Harvest' })
    const other = await sample('Harvest B', { sampleType: 'Harvest' })
    await owner.query(`select api.set_sample_release_rules($1,'Harvest',$2)`, [
      WS,
      JSON.stringify([
        {
          kind: 'measurement_range',
          measurement: 'Turbidity',
          max: 15,
          label: 'Turbidity at most 15',
        },
      ]),
    ])
    const id = await run('run-1')
    const out = await owner.query(
      `select api.record_run_sample_results($1,$2,$3::jsonb) as r`,
      [
        WS,
        id,
        JSON.stringify([
          {
            sample: s.identifier,
            checks: [
              { name: 'Turbidity', type: 'info', value: 12.4, unit: 'NTU' },
            ],
          },
          { sample: 'SMP-NOPE', checks: [] },
        ]),
      ],
    )
    expect(out.rows[0].r).toMatchObject({
      linked: 1,
      checks: 1,
      unknown: ['SMP-NOPE'],
    })
    const mine = await owner.query(
      `select api.sample_release_check_status($1) as r`,
      [s.id],
    )
    expect(mine.rows[0].r.passed).toBe(true)
    // The same run says nothing about the other sample.
    const theirs = await owner.query(
      `select api.sample_release_check_status($1) as r`,
      [other.id],
    )
    expect(theirs.rows[0].r.passed).toBe(false)
  })

  it('fails the gate when a reading is out of range', async () => {
    const s = await sample('Harvest C', { sampleType: 'Harvest' })
    const id = await run('run-2')
    await owner.query(`select api.record_run_sample_results($1,$2,$3::jsonb)`, [
      WS,
      id,
      JSON.stringify([
        {
          sample: s.identifier,
          checks: [{ name: 'Turbidity', type: 'info', value: 22, unit: 'NTU' }],
        },
      ]),
    ])
    const status = await owner.query(
      `select api.sample_release_check_status($1) as r`,
      [s.id],
    )
    expect(status.rows[0].r.passed).toBe(false)
  })

  it('is refused for a viewer', async () => {
    const id = await run('run-3')
    const viewer = await actor(VIEWER)
    await expectDenied(
      viewer.query(`select api.record_run_sample_results($1,$2,'[]'::jsonb)`, [
        WS,
        id,
      ]),
      '42501',
    )
  })
})
