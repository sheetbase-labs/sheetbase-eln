/**
 * Samples and storage reach the API, webhooks, pipelines and SQL:
 *  - the storage tree is authored through api.create_storage_location,
 *    update_storage_location and set_storage_location_archived, with row
 *    security still deciding who may;
 *  - sample reservations write to the change feed (sample.reserved and
 *    sample.reservation_cancelled);
 *  - pipelines may be started by the sample and storage events;
 *  - stewards can read sample history, reservations, storage positions and
 *    movements with SQL, in their own workspace only.
 */
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  expectDenied,
  grantProjectAccess,
  migratorUrl,
  prepareTestDatabase,
} from './helpers'

const WS = '00000000-0000-4000-8000-0000000fa601'
const OTHER_WS = '00000000-0000-4000-8000-0000000fa602'
const PROJ = '00000000-0000-4000-8000-0000000fa611'
const OTHER_PROJ = '00000000-0000-4000-8000-0000000fa612'
const OWNER = 'sti-owner'
const VIEWER = 'sti-viewer'
const OTHER_OWNER = 'sti-other-owner'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function actor(userId: string, workspaceId = WS) {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query("SELECT set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({
      sub: userId,
      workspace_id: workspaceId,
      role: 'authenticated',
    }),
  ])
  return client
}

async function createRecord(
  client: Client,
  project: string,
  kind: string,
  title: string,
  properties: Record<string, unknown> = {},
) {
  const { rows } = await client.query(
    `SELECT * FROM api.create_record($1::uuid,$2,$3,$4,ARRAY[]::text[],$5::jsonb)`,
    [
      project,
      kind,
      title,
      kind === 'experiment' ? 'draft' : 'available',
      JSON.stringify(properties),
    ],
  )
  return rows[0] as { id: string; metadata_version: number }
}

async function location(
  client: Client,
  level: string,
  parent: string | null,
  name: string,
  code: string | null = null,
  unitType: string | null = null,
) {
  const { rows } = await client.query(
    `SELECT api.create_storage_location($1,$2,$3,$4,$5,$6) AS r`,
    [WS, level, parent, name, code, unitType],
  )
  return rows[0].r as { id: string; level: string; name: string }
}

async function changeEvents(entityType: string) {
  const { rows } = await migrator.query(
    `SELECT operation, payload FROM api.change_events
      WHERE workspace_id = $1 AND entity_type = $2 ORDER BY sequence`,
    [WS, entityType],
  )
  return rows as { operation: string; payload: Record<string, unknown> }[]
}

let tree: Record<string, string> = {}
let sampleId = ''
let experimentId = ''
let positionId = ''

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES
       ($1,'Owner','sti-owner@test.invalid',true),
       ($2,'Viewer','sti-viewer@test.invalid',true),
       ($3,'Other','sti-other@test.invalid',true)`,
    [OWNER, VIEWER, OTHER_OWNER],
  )
  await migrator.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES ($1,'sti','Storage'),($2,'sti-other','Other')`,
    [WS, OTHER_WS],
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES
       ($1,$2,'owner'),($1,$3,'viewer'),($4,$5,'owner')`,
    [WS, OWNER, VIEWER, OTHER_WS, OTHER_OWNER],
  )
  await migrator.query(
    `INSERT INTO api.projects(id,workspace_id,key,title) VALUES
       ($1,$3,'sti','Storage project'),($2,$4,'other','Other project')`,
    [PROJ, OTHER_PROJ, WS, OTHER_WS],
  )
  for (const [userId, project, ws, manage] of [
    [OWNER, PROJ, WS, true],
    [VIEWER, PROJ, WS, false],
    [OTHER_OWNER, OTHER_PROJ, OTHER_WS, true],
  ] as const) {
    await grantProjectAccess(migrator, {
      workspaceId: ws,
      projectId: project,
      userId,
      canManage: manage,
    })
  }
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end().catch(() => {})))
  await migrator?.end()
})

describe('storage locations through functions', () => {
  it('builds the tree from site to box and gives each level a place', async () => {
    const owner = await actor(OWNER)
    const site = await location(owner, 'site', null, 'Main site', 'MAIN')
    const room = await location(owner, 'room', site.id, 'Room 1', 'R1')
    const unit = await location(
      owner,
      'unit',
      room.id,
      'Freezer 2',
      'F2',
      'freezer',
    )
    const shelf = await location(owner, 'shelf', unit.id, 'Shelf 3')
    const shelf2 = await location(owner, 'shelf', unit.id, 'Shelf 4')
    const rack = await location(owner, 'rack', shelf.id, 'Rack A')
    tree = {
      site: site.id,
      room: room.id,
      unit: unit.id,
      shelf: shelf.id,
      rack: rack.id,
    }
    const { rows } = await owner.query(
      `SELECT position FROM api.storage_shelves WHERE id IN ($1,$2) ORDER BY position`,
      [shelf.id, shelf2.id],
    )
    expect(rows.map((r) => r.position)).toEqual([1, 2])
    const box = (
      await owner.query(
        `SELECT * FROM api.create_storage_box($1,$2,'Box 7','B7',3,3)`,
        [WS, rack.id],
      )
    ).rows[0]
    tree.box = box.id
    const positions = await owner.query(
      `SELECT id, label FROM api.storage_positions WHERE box_id = $1 ORDER BY row_index, col_index`,
      [box.id],
    )
    expect(positions.rows).toHaveLength(9)
    positionId = positions.rows[4].id
  })

  it('needs a code for a site, room and unit, and a parent for the rest', async () => {
    const owner = await actor(OWNER)
    await expect(location(owner, 'site', null, 'No code')).rejects.toThrow(
      /needs a short code/,
    )
    await expect(
      location(owner, 'shelf', null, 'Floating', null),
    ).rejects.toThrow(/goes inside another location/)
    await expect(location(owner, 'box', tree.rack, 'Box')).rejects.toThrow(
      /create_storage_box/,
    )
  })

  it('renames, retypes and archives a location, and brings it back', async () => {
    const owner = await actor(OWNER)
    await owner.query(
      `SELECT api.update_storage_location('unit',$1,'Freezer two','F2b','cryo',-80,-70)`,
      [tree.unit],
    )
    const { rows } = await owner.query(
      `SELECT name, code, unit_type, temperature_min_c FROM api.storage_units WHERE id=$1`,
      [tree.unit],
    )
    expect(rows[0]).toMatchObject({
      name: 'Freezer two',
      code: 'F2b',
      unit_type: 'cryo',
    })
    expect(Number(rows[0].temperature_min_c)).toBe(-80)
    await owner.query(
      `SELECT api.set_storage_location_archived('rack',$1,true)`,
      [tree.rack],
    )
    const archived = await owner.query(
      `SELECT archived_at FROM api.storage_racks WHERE id=$1`,
      [tree.rack],
    )
    expect(archived.rows[0].archived_at).not.toBeNull()
    await owner.query(
      `SELECT api.set_storage_location_archived('rack',$1,false)`,
      [tree.rack],
    )
  })

  it('refuses a viewer, an unknown level and another workspace', async () => {
    const viewer = await actor(VIEWER)
    await expectDenied(
      viewer.query(
        `SELECT api.create_storage_location($1,'site',null,'Nope','N',null)`,
        [WS],
      ),
      '42501',
    )
    await expectDenied(
      viewer.query(`SELECT api.update_storage_location('unit',$1,'Hack')`, [
        tree.unit,
      ]),
      '42501',
    )
    const owner = await actor(OWNER)
    await expect(
      owner.query(`SELECT api.set_storage_location_archived('bench',$1,true)`, [
        tree.unit,
      ]),
    ).rejects.toThrow(/site, room, unit, shelf, rack or box/)
    const other = await actor(OTHER_OWNER, OTHER_WS)
    await expectDenied(
      other.query(`SELECT api.update_storage_location('unit',$1,'Hack')`, [
        tree.unit,
      ]),
      '42501',
    )
  })

  it('writes a change event for every new location', async () => {
    expect((await changeEvents('storage_site')).at(0)?.operation).toBe('create')
    for (const entity of [
      'storage_room',
      'storage_unit',
      'storage_shelf',
      'storage_rack',
      'storage_box',
    ]) {
      expect(
        (await changeEvents(entity)).some((e) => e.operation === 'create'),
        entity,
      ).toBe(true)
    }
  })
})

describe('sample reservations in the change feed', () => {
  it('writes an event when a reservation is made and when it is cancelled', async () => {
    const owner = await actor(OWNER)
    const sample = await createRecord(owner, PROJ, 'sample', 'Plasma lot 1', {
      quantity: 10,
      quantityUnit: 'mL',
    })
    sampleId = sample.id
    const experiment = await createRecord(owner, PROJ, 'experiment', 'Assay 1')
    experimentId = experiment.id
    const reservation = (
      await owner.query(
        `SELECT * FROM api.create_sample_reservation($1,$2,2,'mL',true,null)`,
        [sampleId, experimentId],
      )
    ).rows[0]
    await owner.query(
      `SELECT api.cancel_sample_reservation($1,'changed plan')`,
      [reservation.id],
    )
    const events = await changeEvents('sample_reservation')
    expect(events.map((e) => [e.operation, e.payload.state])).toEqual([
      ['create', 'active'],
      ['update', 'cancelled'],
    ])
    expect(events[0].payload).toMatchObject({
      sampleRecordId: sampleId,
      experimentRecordId: experimentId,
    })
  })
})

describe('pipeline triggers', () => {
  it('accepts the sample and storage events', async () => {
    for (const name of [
      'sample.received',
      'sample.moved',
      'sample.consumed',
      'sample.disposed',
      'sample.edited',
      'sample.reserved',
      'sample.reservation_cancelled',
      'storage.placed',
      'storage.box.created',
      // still accepted after the patch
      'storage.alarm.raised',
      'watcher.finding.created',
      'record.created',
    ]) {
      const { rows } = await migrator.query(
        `SELECT api.normalize_pipeline_event_type($1) AS name`,
        [name],
      )
      expect(rows[0].name).toBe(name)
    }
  })

  it('still refuses an event that is not a trigger', async () => {
    await expect(
      migrator.query(
        `SELECT api.normalize_pipeline_event_type('sample.workflow.left')`,
      ),
    ).rejects.toThrow(/unsupported event trigger/)
  })

  it('names the new events as webhook events', async () => {
    const { rows } = await migrator.query(
      `SELECT name FROM internal.webhook_event_names WHERE name = ANY($1)`,
      [['sample.reserved', 'sample.archived', 'storage.rack.created']],
    )
    expect(rows).toHaveLength(3)
  })
})

describe('steward SQL', () => {
  const connections: Client[] = []

  afterAll(async () => {
    await Promise.all(connections.map((c) => c.end().catch(() => {})))
  })

  it('reads sample history, reservations, positions and movements in the login’s workspace', async () => {
    const owner = await actor(OWNER)
    // Put the sample in a position so history, movements and positions have rows.
    const sample = (
      await owner.query(
        `SELECT metadata_version FROM api.records WHERE id=$1`,
        [sampleId],
      )
    ).rows[0]
    await owner.query(`SELECT api.move_sample_to_position($1,$2,$3,'filed')`, [
      sampleId,
      positionId,
      sample.metadata_version,
    ])
    await owner.query(
      `SELECT * FROM api.create_sample_reservation($1,$2,1,'mL',true,'kept')`,
      [sampleId, experimentId],
    )
    // Something in another workspace that must never show up.
    const other = await actor(OTHER_OWNER, OTHER_WS)
    await createRecord(other, OTHER_PROJ, 'sample', 'Elsewhere', {
      quantity: 1,
      quantityUnit: 'mL',
    })

    const ready = (
      await migrator.query(`SELECT internal.reporting_ready() AS ok`)
    ).rows[0].ok
    if (!ready) return

    await owner.query('SELECT api.update_workspace_data_access_roles($1,$2)', [
      WS,
      ['owner', 'steward'],
    ])
    const login = (
      await owner.query(
        'SELECT username, password FROM api.create_sql_login($1,$2,null)',
        [WS, 'sample history'],
      )
    ).rows[0]
    const url = new URL(migratorUrl())
    url.username = login.username
    url.password = login.password
    const sql = new Client({ connectionString: url.toString() })
    connections.push(sql)
    await sql.connect()

    const history = await sql.query(
      `SELECT operation, sample_identifier FROM data.sample_history ORDER BY occurred_at`,
    )
    expect(history.rows.length).toBeGreaterThan(0)
    expect(history.rows.every((r) => r.sample_identifier !== null)).toBe(true)
    const titles = await sql.query(
      `SELECT sample_title FROM data.sample_history GROUP BY 1`,
    )
    expect(titles.rows.map((r) => r.sample_title)).not.toContain('Elsewhere')

    const reservations = await sql.query(
      `SELECT state, quantity FROM data.sample_reservations ORDER BY created_at`,
    )
    expect(reservations.rows.map((r) => r.state)).toEqual([
      'cancelled',
      'active',
    ])

    const positions = await sql.query(
      `SELECT path, status, sample_identifier FROM data.storage_positions
        WHERE sample_id IS NOT NULL`,
    )
    expect(positions.rows).toHaveLength(1)
    expect(positions.rows[0].path).toContain('Main site / Room 1')
    expect(positions.rows[0].status).toBe('occupied')
    const all = await sql.query(
      `SELECT count(*)::int AS n FROM data.storage_positions`,
    )
    expect(all.rows[0].n).toBe(9)

    const movements = await sql.query(
      `SELECT operation, to_path FROM data.storage_movements`,
    )
    expect(movements.rows.map((r) => r.operation)).toEqual(['place'])

    // Read only.
    await expect(sql.query(`DELETE FROM data.sample_history`)).rejects.toThrow()
  })
})
