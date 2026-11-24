/**
 * Plates in protocol steps and results on samples: api.add_step_plate_run,
 * the step guard, api.record_steps counting plates and
 * api.publish_plate_run_measurements.
 * Runs against a freshly migrated sheetbase_test database.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000fd01'
const PROJECT = '00000000-0000-4000-8000-00000000fd11'
const OWNER = 'sp-owner'
const VIEWER = 'sp-viewer'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []
let owner: Client
let viewer: Client

async function actor(userId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ sub: userId, workspace_id: WS, role: 'authenticated' }),
  ])
  return client
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  for (const user of [OWNER, VIEWER]) {
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values ($1,$1,$2,true)`,
      [user, `${user}@test.invalid`],
    )
  }
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values ($1,'sp','Step plates')`,
    [WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values ($1,$2,'owner'),($1,$3,'viewer')`,
    [WS, OWNER, VIEWER],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,lead_user_id) values ($1,$2,'sp','Step plates',$3)`,
    [PROJECT, WS, OWNER],
  )
  owner = await actor(OWNER)
  viewer = await actor(VIEWER)
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

async function experiment(title: string, count = 2) {
  // The steps are copied into the experiment when its protocol is pinned.
  const protocol = crypto.randomUUID()
  await migrator.query(
    `insert into api.records(id,workspace_id,kind,identifier,title,status,created_by_user_id)
     values($1,$2,'protocol_template',$3,$4,'active',$5)`,
    [protocol, WS, `PRT-${protocol}`, `${title} protocol`, OWNER],
  )
  for (let n = 1; n <= count; n++) {
    await migrator.query(
      `insert into api.blocks(record_id,type,payload,"order",created_by_user_id)
       values($1,'procedure_step',$2::jsonb,$3,$4)`,
      [
        protocol,
        JSON.stringify({ text: `Step ${n} plates`, stepNumber: n }),
        n,
        OWNER,
      ],
    )
  }
  const { rows } = await owner.query(
    `select id from api.create_record($1::uuid,'experiment',$2)`,
    [PROJECT, title],
  )
  const recordId = rows[0].id as string
  const pin = (
    await owner.query(
      `select api.insert_block($1,'protocol_reference','{}'::jsonb) as result`,
      [recordId],
    )
  ).rows[0].result.block as { id: string; version: number }
  const structure = (
    await migrator.query(
      `select structure_version from api.records where id=$1`,
      [recordId],
    )
  ).rows[0].structure_version as number
  const copied = (
    await owner.query(
      `select api.pin_protocol_reference($1,$2,$3,$4) as result`,
      [pin.id, protocol, pin.version, structure],
    )
  ).rows[0].result.copied_steps as Array<{ id: string }>
  return { recordId, ids: copied.map((step) => step.id) }
}

async function sample(title: string) {
  const { rows } = await owner.query(
    `select id from api.create_record($1::uuid,'sample',$2,'available')`,
    [PROJECT, title],
  )
  return rows[0].id as string
}

async function newRun(name: string, samples: string[] = []) {
  const wells = [
    ...[1, 2, 3, 4, 5, 6].map((c, i) => ({
      wellCode: `A${c}`,
      role: 'standard',
      concentration: [1000, 500, 250, 125, 62.5, 31.25][i],
    })),
    ...samples.map((id, i) => ({
      wellCode: `B${i + 1}`,
      role: 'sample',
      sampleId: id,
    })),
  ]
  const readout: Record<string, number> = {}
  wells.forEach((w, i) => (readout[w.wellCode] = 100 + i))
  const { rows } = await owner.query(
    `select * from api.create_plate_run($1,'96_well',$2::jsonb,$3::jsonb,'{}'::jsonb)`,
    [name, JSON.stringify(wells), JSON.stringify(readout)],
  )
  return rows[0] as { id: string }
}

async function steps(recordId: string) {
  const { rows } = await owner.query(
    `select * from api.record_steps($1) order by step_number`,
    [recordId],
  )
  return rows as { step_number: number; result_count: number }[]
}

describe('add_step_plate_run', () => {
  it('places the plate straight after its step and counts it', async () => {
    const exp = await experiment('Place')
    const run = await newRun('Placed')
    const { rows } = await owner.query(
      `select api.add_step_plate_run($1,$2) as r`,
      [exp.ids[0], run.id],
    )
    expect(rows[0].r.already_there).toBe(false)
    expect(rows[0].r.record_id).toBe(exp.recordId)

    const blocks = await migrator.query(
      `select id, type from api.blocks where record_id=$1 and type in ('procedure_step','plate_run') order by "order"`,
      [exp.recordId],
    )
    expect(blocks.rows.map((b) => b.type)).toEqual([
      'procedure_step',
      'plate_run',
      'procedure_step',
    ])
    expect((await steps(exp.recordId))[0].result_count).toBe(1)
  })

  it('moves a block already at the end into the step, and is idempotent', async () => {
    const exp = await experiment('Move')
    const run = await newRun('Moved')
    await owner.query(`select * from api.link_plate_run($1,$2)`, [
      run.id,
      exp.recordId,
    ])
    await owner.query(`select api.insert_block($1,'plate_run',$2::jsonb)`, [
      exp.recordId,
      JSON.stringify({ runId: run.id, view: 'hits' }),
    ])
    const first = await owner.query(
      `select api.add_step_plate_run($1,$2) as r`,
      [exp.ids[0], run.id],
    )
    expect(first.rows[0].r.already_there).toBe(false)
    const second = await owner.query(
      `select api.add_step_plate_run($1,$2) as r`,
      [exp.ids[0], run.id],
    )
    expect(second.rows[0].r.already_there).toBe(true)
    const n = await migrator.query(
      `select count(*)::int as n from api.blocks where record_id=$1 and type='plate_run'`,
      [exp.recordId],
    )
    expect(n.rows[0].n).toBe(1)
  })

  it('refuses a block that is not a step, and a viewer', async () => {
    const exp = await experiment('Refuse')
    const run = await newRun('Refused')
    const note = await migrator.query(
      `select id from api.blocks where record_id=$1 and type='protocol_reference'`,
      [exp.recordId],
    )
    await expect(
      owner.query(`select api.add_step_plate_run($1,$2)`, [
        note.rows[0].id,
        run.id,
      ]),
    ).rejects.toThrow(/not a protocol step/)
    await expect(
      viewer.query(`select api.add_step_plate_run($1,$2)`, [
        exp.ids[0],
        run.id,
      ]),
    ).rejects.toThrow()
  })

  it('refuses a stepBlockId from another notebook', async () => {
    const a = await experiment('Guard A')
    const b = await experiment('Guard B')
    const run = await newRun('Guarded')
    await expect(
      owner.query(`select api.insert_block($1,'plate_run',$2::jsonb)`, [
        a.recordId,
        JSON.stringify({ runId: run.id, stepBlockId: b.ids[0] }),
      ]),
    ).rejects.toThrow(/not in this notebook/)
  })
})

describe('publish_plate_run_measurements', () => {
  async function quantified(samples: string[]) {
    const run = await newRun('Quantified', samples)
    const results = {
      quantify: {
        curve: { unit: 'ng/mL' },
        samples: [
          {
            sampleId: samples[0],
            result: 123.5,
            status: 'ok',
            dilution: 10,
            n: 2,
          },
          { sampleId: samples[1], result: null, status: 'above_range', n: 1 },
          { sampleId: null, result: 5, status: 'ok', n: 1 },
        ],
      },
    }
    await migrator.query(
      `update api.plate_runs set results=$2::jsonb where id=$1`,
      [run.id, JSON.stringify(results)],
    )
    return run
  }

  it('writes ok samples, replaces its own rows and leaves others alone', async () => {
    const s1 = await sample('Titre A')
    const s2 = await sample('Titre B')
    const run = await quantified([s1, s2])
    await owner.query(
      `select api.record_sample_measurement($1,'Manual',1,'x')`,
      [s1],
    )
    const first = await owner.query(
      `select api.publish_plate_run_measurements($1,'Capsid titre') as r`,
      [run.id],
    )
    expect(first.rows[0].r).toEqual({ published: 1, skipped: 2 })
    await owner.query(`select api.publish_plate_run_measurements($1)`, [run.id])
    const { rows } = await migrator.query(
      `select name, value::float as value, unit, plate_run_id from api.sample_measurements
        where sample_record_id=$1 order by name`,
      [s1],
    )
    expect(rows).toHaveLength(2)
    expect(rows.find((r) => r.plate_run_id)?.value).toBe(123.5)
    expect(rows.find((r) => r.plate_run_id)?.unit).toBe('ng/mL')
    expect(rows.find((r) => !r.plate_run_id)?.name).toBe('Manual')
  })

  it('emits a change event, refuses a viewer and an unquantified run', async () => {
    const s1 = await sample('Titre C')
    const s2 = await sample('Titre D')
    const run = await quantified([s1, s2])
    const before = await migrator.query(
      `select coalesce(max(last_seq),0) as s from api.workspace_change_seq where workspace_id=$1`,
      [WS],
    )
    await owner.query(`select api.publish_plate_run_measurements($1)`, [run.id])
    const ev = await migrator.query(
      `select payload from api.change_events where workspace_id=$1 and entity_type='plate_run' and sequence > $2`,
      [WS, before.rows[0].s],
    )
    expect(ev.rows.map((e) => e.payload.change)).toContain(
      'measurements_published',
    )
    await expect(
      viewer.query(`select api.publish_plate_run_measurements($1)`, [run.id]),
    ).rejects.toThrow()
    const plain = await newRun('Plain')
    await expect(
      owner.query(`select api.publish_plate_run_measurements($1)`, [plain.id]),
    ).rejects.toThrow(/standard curve/)
  })
})
