/**
 * The assay setup a plate design remembers: saving it, pointing a run at the
 * design, what it refuses and the event it sends.
 * Runs against a freshly migrated sheetbase_test database.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { mapEventType } from '../../src/lib/webhook-events'
import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000fd01'
const WS2 = '00000000-0000-4000-8000-00000000fd02'
const PROJECT = '00000000-0000-4000-8000-00000000fd11'
const OWNER = 'as-owner'
const VIEWER = 'as-viewer'
const OUTSIDER = 'as-outsider'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []
let owner: Client
let viewer: Client
let outsider: Client

async function actor(userId: string, workspace: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({
      sub: userId,
      workspace_id: workspace,
      role: 'authenticated',
    }),
  ])

  return client
}

async function mark(): Promise<string> {
  const { rows } = await migrator.query(
    `select coalesce(max(last_seq),0) as last_seq from api.workspace_change_seq where workspace_id = $1`,
    [WS],
  )

  return String(rows[0].last_seq)
}

async function feed(since: string) {
  const { rows } = await migrator.query<{
    entity_type: string
    operation: string
    payload: Record<string, string | number | null>
  }>(
    `select entity_type, operation, payload from api.change_events
      where workspace_id = $1 and entity_type in ('plate_design') and sequence > $2
      order by sequence`,
    [WS, since],
  )

  return rows.map((row) => ({
    wire: mapEventType(row.entity_type, row.operation, row.payload),
    payload: row.payload,
  }))
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())

  for (const user of [OWNER, VIEWER, OUTSIDER]) {
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values ($1,$1,$2,true)`,
      [user, `${user}@test.invalid`],
    )
  }

  await migrator.query(
    `insert into api.workspaces(id,slug,name) values ($1,'as','Assays'),($2,'as2','Other lab')`,
    [WS, WS2],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values ($1,$2,'owner'),($1,$3,'viewer'),($4,$5,'owner')`,
    [WS, OWNER, VIEWER, WS2, OUTSIDER],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,lead_user_id) values ($1,$2,'as','Assays',$3)`,
    [PROJECT, WS, OWNER],
  )
  owner = await actor(OWNER, WS)
  viewer = await actor(VIEWER, WS)
  outsider = await actor(OUTSIDER, WS2)
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator.end()
})

const wells = [
  { wellCode: 'A1', role: 'negative_control' },
  { wellCode: 'A2', role: 'positive_control' },
]

async function newRun(name: string, client: Client = owner) {
  const { rows } = await client.query<{ id: string; metadata_version: number }>(
    `select * from api.create_plate_run($1,'96_well',$2::jsonb,$3::jsonb,'{}'::jsonb)`,
    [name, JSON.stringify(wells), JSON.stringify({ A1: 1000, A2: 100 })],
  )

  return rows[0]
}

async function newDesign(name: string, client: Client = owner) {
  const { rows } = await client.query<{ id: string }>(
    `select * from api.create_plate_design($1,$2)`,
    [WS, name],
  )

  return rows[0]
}

const setup = {
  config: { normalisation: 'percent_effect', curveModel: '4pl' },
  negativeColumns: '1',
  positiveColumns: '11-12',
}

describe('save_plate_design_assay_setup', () => {
  it('remembers the setup, points the run at the design and announces it', async () => {
    const design = await newDesign('PicoGreen')
    const run = await newRun('Plate one')
    expect(design.assay_setup).toBeNull()
    const before = await mark()

    const saved = await owner.query(
      `select * from api.save_plate_design_assay_setup($1,$2::jsonb,$3)`,
      [
        design.id,
        JSON.stringify({ ...setup, stray: 'dropped', view: 'hits' }),
        run.id,
      ],
    )

    expect(saved.rows[0].assay_setup).toEqual(setup)

    const { rows } = await migrator.query(
      `select design_id, metadata_version from api.plate_runs where id = $1`,
      [run.id],
    )

    expect(rows[0].design_id).toBe(design.id)
    expect(rows[0].metadata_version).toBeGreaterThan(run.metadata_version)

    const events = await feed(before)

    // The design row changing is announced as it always was; remembering the
    // setup is announced on its own.
    expect(
      events.map((e) => e.wire).sort((a, b) => a.localeCompare(b)),
    ).toEqual(['plate_design.assay_setup_saved', 'plate_design.updated'])

    const announced = events.find(
      (e) => e.wire === 'plate_design.assay_setup_saved',
    )

    expect(announced?.payload.plateRunId).toBe(run.id)
    expect(announced?.payload.normalisation).toBe('percent_effect')
  })

  it('saves without a run and replaces what was there', async () => {
    const design = await newDesign('Replaced')

    await owner.query(
      `select * from api.save_plate_design_assay_setup($1,$2::jsonb)`,
      [design.id, JSON.stringify(setup)],
    )

    const next = { ...setup, negativeColumns: '2' }

    const saved = await owner.query(
      `select * from api.save_plate_design_assay_setup($1,$2::jsonb)`,
      [design.id, JSON.stringify(next)],
    )

    expect(saved.rows[0].assay_setup.negativeColumns).toBe('2')
  })

  it('refuses a setup with no config, a viewer, another workspace and an archived run', async () => {
    const design = await newDesign('Refusals')
    await expect(
      owner.query(
        `select * from api.save_plate_design_assay_setup($1,'{"negativeColumns":"1"}'::jsonb)`,
        [design.id],
      ),
    ).rejects.toThrow(/config/)
    await expect(
      viewer.query(
        `select * from api.save_plate_design_assay_setup($1,$2::jsonb)`,
        [design.id, JSON.stringify(setup)],
      ),
    ).rejects.toThrow()
    await expect(
      outsider.query(
        `select * from api.save_plate_design_assay_setup($1,$2::jsonb)`,
        [design.id, JSON.stringify(setup)],
      ),
    ).rejects.toThrow()

    const run = await newRun('Archived run')
    await owner.query(`select * from api.archive_plate_run($1)`, [run.id])
    await expect(
      owner.query(
        `select * from api.save_plate_design_assay_setup($1,$2::jsonb,$3)`,
        [design.id, JSON.stringify(setup), run.id],
      ),
    ).rejects.toThrow(/archived/)
  })
})
