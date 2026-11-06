/**
 * Plate assays (migration 0105): bigger plate formats, plate runs that keep
 * their layout, readout and analysis together, and liquid handler worklists
 * that withdraw from the source samples when they are completed.
 * Runs against a freshly migrated sheetbase_test database.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { mapEventType } from '../../src/lib/webhook-events'
import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000fb01'
const WS2 = '00000000-0000-4000-8000-00000000fb02'
const PROJECT = '00000000-0000-4000-8000-00000000fb11'
const OWNER = 'pa-owner'
const VIEWER = 'pa-viewer'
const OUTSIDER = 'pa-outsider'

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
      where workspace_id = $1 and entity_type in ('plate_run','plate_worklist') and sequence > $2
      order by sequence`,
    [WS, since],
  )
  return rows.map((row) => ({
    wire: mapEventType(row.entity_type, row.operation, row.payload),
    payload: row.payload as Record<string, unknown>,
  }))
}

const wells384 = [
  { wellCode: 'A1', role: 'negative_control' },
  { wellCode: 'A24', role: 'positive_control' },
  { wellCode: 'P24', role: 'sample', sampleLabel: 'X-1', concentration: 10, concentrationUnit: 'nM' },
]

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  for (const user of [OWNER, VIEWER, OUTSIDER]) {
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values ($1,$1,$2,true)`,
      [user, `${user}@test.invalid`],
    )
  }
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values ($1,'pa','Plates'),($2,'pa2','Other lab')`,
    [WS, WS2],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values ($1,$2,'owner'),($1,$3,'viewer'),($4,$5,'owner')`,
    [WS, OWNER, VIEWER, WS2, OUTSIDER],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,lead_user_id) values ($1,$2,'pa','Plates',$3)`,
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

describe('bigger plates', () => {
  it('accepts every standard format on a design and refuses others', async () => {
    for (const format of ['6_well', '96_well', '384_well', '1536_well']) {
      const { rows } = await owner.query(
        `select * from api.create_plate_design($1,$2,null,$3,2,3)`,
        [WS, `Design ${format}`, format],
      )
      expect(rows[0].format).toBe(format)
    }
    await expect(
      owner.query(`select * from api.create_plate_design($1,'bad',null,'7_well',2,3)`, [WS]),
    ).rejects.toThrow(/unsupported plate format/)
  })

  it('accepts a 384-well plate map block and checks its well codes', async () => {
    const experiment = await record('experiment', 'Plate map')
    const spec = (wells: unknown[]) => ({
      title: 'Plate',
      spec: {
        specVersion: 1,
        format: '384_well',
        rows: 16,
        cols: 24,
        wells,
        validation: {},
      },
    })
    const ok = await owner.query(
      `select api.insert_block($1,'plate_map',$2::jsonb) as result`,
      [
        experiment.id,
        JSON.stringify(
          spec([
            { wellCode: 'A1', row: 0, col: 0, role: 'blank' },
            { wellCode: 'P24', row: 15, col: 23, role: 'sample' },
          ]),
        ),
      ],
    )
    expect(ok.rows[0].result.block.type).toBe('plate_map')
    await expect(
      owner.query(`select api.insert_block($1,'plate_map',$2::jsonb)`, [
        experiment.id,
        JSON.stringify(spec([{ wellCode: 'B1', row: 0, col: 0, role: 'blank' }])),
      ]),
    ).rejects.toThrow(/does not match/)
    await expect(
      owner.query(`select api.insert_block($1,'plate_map',$2::jsonb)`, [
        experiment.id,
        JSON.stringify({
          ...spec([]),
          spec: { ...spec([]).spec, rows: 8, cols: 12 },
        }),
      ]),
    ).rejects.toThrow(/invalid plate dimensions/)
  })
})

describe('plate runs', () => {
  it('stores a layout and readout, numbers runs and announces them', async () => {
    const before = await mark()
    const { rows } = await owner.query(
      `select * from api.create_plate_run($1,'384_well',$2::jsonb,$3::jsonb,'{}'::jsonb,$4)`,
      [
        'Kinase screen 1',
        JSON.stringify(wells384),
        JSON.stringify({ A1: 1000, A24: 100, P24: 500 }),
        PROJECT,
      ],
    )
    expect(rows[0].number).toBe(1)
    expect(rows[0].rows).toBe(16)
    expect(rows[0].cols).toBe(24)
    expect(rows[0].status).toBe('draft')
    const second = await owner.query(
      `select * from api.create_plate_run('Second','96_well')`,
    )
    expect(second.rows[0].number).toBe(2)
    expect((await feed(before)).map((e) => e.wire)).toEqual([
      'plate_run.created',
      'plate_run.created',
    ])
  })

  it('refuses wells off the plate, repeats, unknown roles and bad readouts', async () => {
    const create = (wells: unknown[], readout: unknown = {}) =>
      owner.query(
        `select * from api.create_plate_run('Bad','96_well',$1::jsonb,$2::jsonb)`,
        [JSON.stringify(wells), JSON.stringify(readout)],
      )
    await expect(create([{ wellCode: 'I1', role: 'sample' }])).rejects.toThrow(/not on this plate/)
    await expect(create([{ wellCode: 'A13', role: 'sample' }])).rejects.toThrow(/not on this plate/)
    await expect(
      create([
        { wellCode: 'A1', role: 'sample' },
        { wellCode: 'A1', role: 'blank' },
      ]),
    ).rejects.toThrow(/twice/)
    await expect(create([{ wellCode: 'A1', role: 'drug' }])).rejects.toThrow(/unknown role/)
    await expect(create([], { A1: 'high' })).rejects.toThrow(/number or empty/)
    await expect(create([], { Z1: 1 })).rejects.toThrow(/not on this plate/)
    await expect(
      owner.query(`select * from api.create_plate_run('x','7_well')`),
    ).rejects.toThrow(/unsupported plate format/)
  })

  it('saves an analysis, announces it, and clears it when the data changes', async () => {
    const created = await owner.query(
      `select * from api.create_plate_run('Analyse me','384_well',$1::jsonb,$2::jsonb)`,
      [JSON.stringify(wells384), JSON.stringify({ A1: 1000, A24: 100, P24: 500 })],
    )
    const id = created.rows[0].id as string
    const before = await mark()
    const saved = await owner.query(
      `select * from api.save_plate_run_analysis($1,$2::jsonb,'pass')`,
      [
        id,
        JSON.stringify({
          qc: { zPrime: 0.8 },
          summary: { hitSamples: 3, testedSamples: 20 },
        }),
      ],
    )
    expect(saved.rows[0].status).toBe('analysed')
    expect(saved.rows[0].qc_status).toBe('pass')
    expect(saved.rows[0].analysed_by).toBe(OWNER)
    const events = await feed(before)
    expect(events.map((e) => e.wire)).toEqual(['plate_run.analysed'])
    expect(events[0].payload).toMatchObject({
      qcStatus: 'pass',
      zPrime: 0.8,
      hitSamples: 3,
      testedSamples: 20,
    })

    // A rename keeps the analysis; a new readout clears it.
    const renamed = await owner.query(
      `select * from api.update_plate_run($1,'Renamed')`,
      [id],
    )
    expect(renamed.rows[0].status).toBe('analysed')
    const changed = await owner.query(
      `select * from api.update_plate_run($1,null,null,$2::jsonb)`,
      [id, JSON.stringify({ A1: 900 })],
    )
    expect(changed.rows[0].status).toBe('draft')
    expect(changed.rows[0].results).toBeNull()
    expect(changed.rows[0].qc_status).toBeNull()
  })

  it('refuses to analyse an empty plate and a stale version', async () => {
    const created = await owner.query(`select * from api.create_plate_run('Empty','96_well')`)
    const id = created.rows[0].id as string
    await expect(
      owner.query(`select * from api.save_plate_run_analysis($1,'{}'::jsonb,'pass')`, [id]),
    ).rejects.toThrow(/layout and a readout/)
    await expect(
      owner.query(`select * from api.update_plate_run($1,'x',null,null,null,99)`, [id]),
    ).rejects.toThrow(/version mismatch/)
    await expect(
      owner.query(`select * from api.save_plate_run_analysis($1,'{}'::jsonb,'great')`, [id]),
    ).rejects.toThrow(/QC status/)
  })

  it('archives and then refuses edits', async () => {
    const created = await owner.query(`select * from api.create_plate_run('Old','96_well')`)
    const id = created.rows[0].id as string
    const before = await mark()
    const archived = await owner.query(`select * from api.archive_plate_run($1)`, [id])
    expect(archived.rows[0].status).toBe('archived')
    expect((await feed(before)).map((e) => e.wire)).toEqual(['plate_run.archived'])
    await expect(
      owner.query(`select * from api.update_plate_run($1,'again')`, [id]),
    ).rejects.toThrow(/archived/)
  })

  it('keeps runs inside their lab and viewers read-only', async () => {
    const { rows } = await owner.query(`select id from api.plate_runs where project_id is null limit 1`)
    const id = rows[0].id as string
    expect((await viewer.query(`select id from api.plate_runs where id = $1`, [id])).rows).toHaveLength(1)
    await expect(
      viewer.query(`select * from api.create_plate_run('Nope','96_well')`),
    ).rejects.toThrow(/not permitted/)
    await expect(viewer.query(`select * from api.archive_plate_run($1)`, [id])).rejects.toThrow(/not permitted/)
    expect((await outsider.query(`select id from api.plate_runs where id = $1`, [id])).rows).toHaveLength(0)
    await expect(outsider.query(`select * from api.archive_plate_run($1)`, [id])).rejects.toThrow(/not found/)
  })

  it('refuses a sample from another lab', async () => {
    await expect(
      owner.query(
        `select * from api.create_plate_run('Link','96_well',$1::jsonb)`,
        [JSON.stringify([{ wellCode: 'A1', role: 'sample', sampleId: crypto.randomUUID() }])],
      ),
    ).rejects.toThrow(/was not found/)
  })
})

describe('worklists', () => {
  const transfers = (sampleId: string) => [
    { sourceWell: 'A1', destWell: 'A1', volumeUl: 10, label: 'S-1', sampleId },
    { sourceWell: 'A1', destWell: 'A2', volumeUl: 5, label: 'S-1', sampleId },
    { sourceWell: 'B1', destWell: 'B1', volumeUl: 5, label: 'DMSO', sampleId: null },
  ]
  const create = (t: unknown[], record?: string, run?: string) =>
    owner.query(
      `select * from api.create_plate_worklist('Stamp 1','echo','cherry_pick','SRC','384_well','DST','384_well',$1::jsonb,$2,$3)`,
      [JSON.stringify(t), run ?? null, record ?? null],
    )

  it('stores transfers and checks wells against each plate', async () => {
    const sample = await record('sample', 'Compound', { quantity: 100, quantityUnit: 'µL' })
    const before = await mark()
    const { rows } = await create(transfers(sample.id))
    expect(rows[0].number).toBe(1)
    expect(rows[0].status).toBe('planned')
    expect((await feed(before)).map((e) => e.wire)).toEqual(['plate_worklist.created'])
    await expect(
      owner.query(
        `select * from api.create_plate_worklist('x','csv','stamp','S','96_well','D','96_well',$1::jsonb)`,
        [JSON.stringify([{ sourceWell: 'A13', destWell: 'A1', volumeUl: 1 }])],
      ),
    ).rejects.toThrow(/not on its plate/)
    await expect(create([])).rejects.toThrow(/at least one transfer/)
    await expect(
      create([{ sourceWell: 'A1', destWell: 'A1', volumeUl: 0 }]),
    ).rejects.toThrow(/volume above zero/)
  })

  it('completes from a log, withdraws from the samples and links the experiment', async () => {
    const experiment = await record('experiment', 'Screen')
    const sample = await record('sample', 'Compound B', { quantity: 100, quantityUnit: 'µL' })
    const poor = await record('sample', 'Compound C', { quantity: 1, quantityUnit: 'µL' })
    const dry = await record('sample', 'Powder', { quantity: 10, quantityUnit: 'mg' })
    const t = [
      { sourceWell: 'A1', destWell: 'A1', volumeUl: 10, label: 'B', sampleId: sample.id },
      { sourceWell: 'A1', destWell: 'A2', volumeUl: 5, label: 'B', sampleId: sample.id },
      { sourceWell: 'B1', destWell: 'B1', volumeUl: 5, label: 'C', sampleId: poor.id },
      { sourceWell: 'C1', destWell: 'C1', volumeUl: 5, label: 'P', sampleId: dry.id },
    ]
    const wl = (await create(t, experiment.id)).rows[0]
    const before = await mark()
    const reconciled = [
      { ...t[0], status: 'done', movedUl: 10 },
      { ...t[1], status: 'short', movedUl: 4 },
      { ...t[2], status: 'done', movedUl: 5 },
      { ...t[3], status: 'done', movedUl: 5 },
    ]
    const done = await owner.query(
      `select * from api.complete_plate_worklist($1,$2::jsonb)`,
      [wl.id, JSON.stringify(reconciled)],
    )
    expect(done.rows[0].status).toBe('complete')
    const w = done.rows[0].withdrawals
    expect(w.withdrawn).toHaveLength(1)
    expect(Number(w.withdrawn[0].quantity)).toBe(14)
    expect(w.skipped.map((s: { reason: string }) => s.reason).sort()).toEqual(['not_a_volume', 'refused'])
    const left = await migrator.query(
      `select (properties->>'quantity')::numeric as q from api.records where id = $1`,
      [sample.id],
    )
    expect(Number(left.rows[0].q)).toBe(86)
    const links = await migrator.query(
      `select 1 from api.record_links where source_record_id = $1 and target_record_id = $2`,
      [experiment.id, sample.id],
    )
    expect(links.rows).toHaveLength(1)
    const events = await feed(before)
    expect(events.map((e) => e.wire)).toEqual(['plate_worklist.completed'])
    expect(events[0].payload).toMatchObject({ samplesWithdrawn: 1, transfers: 4 })
    await expect(
      owner.query(`select * from api.complete_plate_worklist($1,'[]'::jsonb)`, [wl.id]),
    ).rejects.toThrow(/already complete/)
  })

  it('records the log without withdrawing when asked, and cancels a planned list', async () => {
    const sample = await record('sample', 'Compound D', { quantity: 50, quantityUnit: 'µL' })
    const wl = (await create(transfers(sample.id))).rows[0]
    const done = await owner.query(
      `select * from api.complete_plate_worklist($1,'[]'::jsonb,null,false)`,
      [wl.id],
    )
    expect(done.rows[0].withdrawals.recorded).toBe(false)
    const other = (await create(transfers(sample.id))).rows[0]
    expect((await owner.query(`select * from api.cancel_plate_worklist($1)`, [other.id])).rows[0].status).toBe('cancelled')
    await expect(owner.query(`select * from api.cancel_plate_worklist($1)`, [other.id])).rejects.toThrow(/planned/)
  })

  it('needs an experiment to withdraw for', async () => {
    const sample = await record('sample', 'Compound E', { quantity: 50, quantityUnit: 'µL' })
    const wl = (await create(transfers(sample.id))).rows[0]
    await expect(
      owner.query(`select * from api.complete_plate_worklist($1,'[]'::jsonb)`, [wl.id]),
    ).rejects.toThrow(/name the experiment/)
  })
})
