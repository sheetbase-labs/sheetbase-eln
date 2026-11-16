/**
 * Plate runs in experiments: linking a run to an experiment, the plate run
 * notebook block and its pinned copy.
 * Runs against a freshly migrated sheetbase_test database.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { mapEventType } from '../../src/lib/webhook-events'
import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000fc01'
const WS2 = '00000000-0000-4000-8000-00000000fc02'
const PROJECT = '00000000-0000-4000-8000-00000000fc11'
const OWNER = 'pl-owner'
const VIEWER = 'pl-viewer'
const OUTSIDER = 'pl-outsider'

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

async function record(
  kind: string,
  title: string,
  properties: Record<string, unknown> = {},
) {
  const { rows } = await owner.query(
    `select * from api.create_record($1::uuid,$2,$3,$4,ARRAY[]::text[],$5::jsonb)`,
    [
      PROJECT,
      kind,
      title,
      kind === 'experiment' ? 'draft' : 'available',
      JSON.stringify(properties),
    ],
  )
  return rows[0] as { id: string; metadata_version: number; identifier: string }
}

async function mark(): Promise<string> {
  const { rows } = await migrator.query(
    `select coalesce(max(last_seq),0) as last_seq from api.workspace_change_seq where workspace_id = $1`,
    [WS],
  )
  return String(rows[0].last_seq)
}

async function feed(since: string) {
  const { rows } = await migrator.query(
    `select entity_type, operation, payload from api.change_events
      where workspace_id = $1 and entity_type in ('plate_run') and sequence > $2
      order by sequence`,
    [WS, since],
  )
  return rows.map((row) => ({
    wire: mapEventType(row.entity_type, row.operation, row.payload),
    payload: row.payload as Record<string, unknown>,
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
    `insert into api.workspaces(id,slug,name) values ($1,'pl','Plates'),($2,'pl2','Other lab')`,
    [WS, WS2],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values ($1,$2,'owner'),($1,$3,'viewer'),($4,$5,'owner')`,
    [WS, OWNER, VIEWER, WS2, OUTSIDER],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,lead_user_id) values ($1,$2,'pl','Plates',$3)`,
    [PROJECT, WS, OWNER],
  )
  owner = await actor(OWNER, WS)
  viewer = await actor(VIEWER, WS)
  outsider = await actor(OUTSIDER, WS2)
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

const wells = [
  { wellCode: 'A1', role: 'negative_control' },
  { wellCode: 'A2', role: 'positive_control' },
]

async function newRun(name: string, client: Client = owner) {
  const { rows } = await client.query(
    `select * from api.create_plate_run($1,'96_well',$2::jsonb,$3::jsonb,'{}'::jsonb)`,
    [name, JSON.stringify(wells), JSON.stringify({ A1: 1000, A2: 100 })],
  )
  return rows[0] as { id: string; metadata_version: number }
}

describe('link_plate_run', () => {
  it('attaches, moves and detaches a run and announces each change', async () => {
    const a = await record('experiment', 'Linked A')
    const b = await record('experiment', 'Linked B')
    const run = await newRun('Linked run')
    const before = await mark()

    const linked = await owner.query(
      `select * from api.link_plate_run($1,$2)`,
      [run.id, a.id],
    )
    expect(linked.rows[0].record_id).toBe(a.id)
    expect(linked.rows[0].project_id).toBe(PROJECT)

    const again = await owner.query(`select * from api.link_plate_run($1,$2)`, [
      run.id,
      a.id,
    ])
    expect(again.rows[0].metadata_version).toBe(linked.rows[0].metadata_version)

    await owner.query(`select * from api.link_plate_run($1,$2)`, [run.id, b.id])
    const unlinked = await owner.query(`select * from api.link_plate_run($1)`, [
      run.id,
    ])
    expect(unlinked.rows[0].record_id).toBeNull()

    const events = await feed(before)
    expect(events.map((e) => e.wire)).toEqual([
      'plate_run.linked',
      'plate_run.linked',
      'plate_run.unlinked',
    ])
    expect(events[1].payload.previousRecordId).toBe(a.id)
  })

  it('refuses a viewer, another workspace and an archived run', async () => {
    const exp = await record('experiment', 'Refusals')
    const run = await newRun('Refused run')
    await expect(
      viewer.query(`select * from api.link_plate_run($1,$2)`, [run.id, exp.id]),
    ).rejects.toThrow()
    await expect(
      outsider.query(`select * from api.link_plate_run($1,$2)`, [
        run.id,
        exp.id,
      ]),
    ).rejects.toThrow(/not found/)
    await owner.query(`select * from api.archive_plate_run($1)`, [run.id])
    await expect(
      owner.query(`select * from api.link_plate_run($1,$2)`, [run.id, exp.id]),
    ).rejects.toThrow(/archived/)
  })
})

describe('plate run block', () => {
  it('pins a copy of the run, keeps it fresh and refuses a foreign run', async () => {
    const exp = await record('experiment', 'Block')
    const run = await newRun('Blocked run')
    const inserted = await owner.query(
      `select api.insert_block($1,'plate_run',$2::jsonb) as result`,
      [
        exp.id,
        JSON.stringify({
          runId: run.id,
          view: 'hits',
          pinned: { name: 'forged' },
        }),
      ],
    )
    const block = inserted.rows[0].result.block
    expect(block.payload.pinned.name).toBe('Blocked run')
    expect(block.payload.pinned.reference).toMatch(/^PLR-\d{4}$/)

    await owner.query(`select * from api.link_plate_run($1,$2)`, [
      run.id,
      exp.id,
    ])
    const { rows } = await migrator.query(
      `select payload from api.blocks where id = $1`,
      [block.id],
    )
    expect(rows[0].payload.pinned.metadataVersion).toBeGreaterThan(
      block.payload.pinned.metadataVersion,
    )

    const foreign = await newRun('Foreign run', outsider)
    await expect(
      owner.query(`select api.insert_block($1,'plate_run',$2::jsonb)`, [
        exp.id,
        JSON.stringify({ runId: foreign.id }),
      ]),
    ).rejects.toThrow(/not found in this workspace/)
    await expect(
      owner.query(`select api.insert_block($1,'plate_run',$2::jsonb)`, [
        exp.id,
        JSON.stringify({ runId: 'nope' }),
      ]),
    ).rejects.toThrow(/plate run id/)
  })
})
