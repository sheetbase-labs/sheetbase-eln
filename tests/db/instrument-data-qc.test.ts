/**
 * Instrument data and run quality control (migration 20261107011617): ASM
 * documents kept with an instrument run, and Westgard-judged quality control
 * series fed by plate runs or sent in by hand.
 * Runs against a freshly migrated sheetbase_test database.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { mapEventType } from '../../src/lib/webhook-events'
import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000fc01'
const WS2 = '00000000-0000-4000-8000-00000000fc02'
const PROJECT = '00000000-0000-4000-8000-00000000fc11'
const INSTRUMENT = '00000000-0000-4000-8000-00000000fc21'
const OWNER = 'qc-owner'
const VIEWER = 'qc-viewer'
const OUTSIDER = 'qc-outsider'

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
  const { rows } = await migrator.query(
    `select entity_type, operation, payload from api.change_events
      where workspace_id = $1 and entity_type in ('qc_series','qc_violation','instrument_run_document') and sequence > $2
      order by sequence`,
    [WS, since],
  )
  return rows.map((row) => ({
    wire: mapEventType(row.entity_type, row.operation, row.payload),
    payload: row.payload as Record<string, unknown>,
  }))
}

/** Send in values one after another; the last result is returned. */
async function send(seriesId: string, values: number[], startMinute = 0) {
  let last
  for (const [index, value] of values.entries()) {
    const at = new Date(
      Date.UTC(2026, 10, 1, 0, startMinute + index),
    ).toISOString()
    last = (
      await owner.query(`select * from api.record_qc_point($1,$2,$3)`, [
        seriesId,
        value,
        at,
      ])
    ).rows[0]
  }
  return last as { id: string; violations: string[]; z: number | null }
}

async function newSeries(name: string, mean = 100, sd = 2) {
  const { rows } = await owner.query(
    `select * from api.create_qc_series($1,$2,'manual',null,null,$3,'RFU',$4,$5)`,
    [WS, name, INSTRUMENT, mean, sd],
  )
  return rows[0] as { id: string; state: string }
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
    `insert into api.workspaces(id,slug,name) values ($1,'qc','Quality'),($2,'qc2','Other lab')`,
    [WS, WS2],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values ($1,$2,'owner'),($1,$3,'viewer'),($4,$5,'owner')`,
    [WS, OWNER, VIEWER, WS2, OUTSIDER],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,lead_user_id) values ($1,$2,'qc','Quality',$3)`,
    [PROJECT, WS, OWNER],
  )
  await migrator.query(
    `insert into api.instruments(id,workspace_id,name,owner_id) values ($1,$2,'Plate reader 1',$3)`,
    [INSTRUMENT, WS, OWNER],
  )
  owner = await actor(OWNER, WS)
  viewer = await actor(VIEWER, WS)
  outsider = await actor(OUTSIDER, WS2)
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

describe('Westgard rules', () => {
  it('1-3s: a point beyond three SD breaks the rule and raises the event once', async () => {
    const series = await newSeries('1-3s')
    const before = await mark()
    const ok = await send(series.id, [100, 101, 99])
    expect(ok.violations).toEqual([])
    const bad = await send(series.id, [107], 10)
    expect(bad.violations).toEqual(['1-3s'])
    expect(bad.z).toBeCloseTo(3.5)
    const events = await feed(before)
    expect(events.map((e) => e.wire)).toEqual(['qc.violation'])
    expect(events[0]?.payload).toMatchObject({ name: '1-3s', rules: ['1-3s'] })
    const { rows } = await owner.query(
      `select state from api.qc_series where id = $1`,
      [series.id],
    )
    expect(rows[0].state).toBe('out_of_control')
    // The owner of the instrument and the creator are told once, with a link.
    const notes = await migrator.query(
      `select user_id, link from internal.notifications where event_type = 'qc_violation' and body like '1-3s:%'`,
    )
    expect(notes.rows).toEqual([
      { user_id: OWNER, link: `/instruments/${INSTRUMENT}` },
    ])
  })

  it('2-2s: two in a row beyond two SD on one side', async () => {
    const series = await newSeries('2-2s')
    const one = await send(series.id, [105])
    expect(one.violations).toEqual([])
    const two = await send(series.id, [105], 5)
    expect(two.violations).toEqual(['2-2s'])
  })

  it('R-4s: two in a row more than four SD apart', async () => {
    const series = await newSeries('R-4s')
    await send(series.id, [105])
    const two = await send(series.id, [95], 5)
    expect(two.violations).toEqual(['R-4s'])
  })

  it('4-1s: four in a row beyond one SD on one side', async () => {
    const series = await newSeries('4-1s')
    const last = await send(series.id, [103, 103, 103, 103])
    expect(last.violations).toEqual(['4-1s'])
  })

  it('10x: ten in a row on one side of the mean', async () => {
    const series = await newSeries('10x')
    const nine = await send(series.id, Array(9).fill(100.5))
    expect(nine.violations).toEqual([])
    const ten = await send(series.id, [100.5], 20)
    expect(ten.violations).toEqual(['10x'])
  })

  it('comes back in control with the next clean point and says so', async () => {
    const series = await newSeries('back')
    await send(series.id, [107])
    const before = await mark()
    const clean = await send(series.id, [100], 5)
    expect(clean.violations).toEqual([])
    const events = await feed(before)
    expect(events.map((e) => e.wire)).toEqual(['qc.back_in_control'])
    const { rows } = await owner.query(
      `select state from api.qc_series where id = $1`,
      [series.id],
    )
    expect(rows[0].state).toBe('in_control')
  })

  it('judges nothing until the series has limits, then judges every point', async () => {
    const { rows } = await owner.query(
      `select * from api.create_qc_series($1,'no limits','manual')`,
      [WS],
    )
    const series = rows[0] as { id: string }
    const first = await send(series.id, [10, 11, 9, 10, 12, 10, 40])
    expect(first.violations).toEqual([])
    await expect(
      owner.query(`select * from api.set_qc_baseline($1, null, null, 5)`, [
        series.id,
      ]),
    ).resolves.toBeTruthy()
    const state = await owner.query(
      `select mean, sd, baseline_n from api.qc_series where id = $1`,
      [series.id],
    )
    expect(state.rows[0].baseline_n).toBe(5)
    expect(state.rows[0].mean).toBeCloseTo(10.4)
    const points = await owner.query(
      `select violations from api.qc_points where series_id = $1 order by at, id`,
      [series.id],
    )
    expect(points.rows.at(-1)?.violations).toContain('1-3s')
  })

  it('leaves a rule out when it is switched off', async () => {
    const series = await newSeries('rules off')
    await owner.query(`select * from api.update_qc_series($1,null,$2)`, [
      series.id,
      ['2-2s'],
    ])
    const bad = await send(series.id, [110])
    expect(bad.violations).toEqual([])
  })

  it('refuses a baseline with too few points or no spread, and bad numbers', async () => {
    const series = await newSeries('few')
    await send(series.id, [1, 2])
    await expect(
      owner.query(`select * from api.set_qc_baseline($1, null, null, 5)`, [
        series.id,
      ]),
    ).rejects.toThrow(/at least 5 points/)
    await expect(
      owner.query(`select * from api.set_qc_baseline($1, 10, 0)`, [series.id]),
    ).rejects.toThrow(/standard deviation/)
    await expect(
      owner.query(`select * from api.record_qc_point($1, 'NaN'::float8)`, [
        series.id,
      ]),
    ).rejects.toThrow(/finite/)
  })

  it('acknowledges a breach and can leave the point out of the limits', async () => {
    const series = await newSeries('ack')
    const bad = await send(series.id, [108])
    expect(bad.violations).toEqual(['1-3s'])
    const done = await owner.query(
      `select * from api.acknowledge_qc_point($1,'Lamp was changed',true)`,
      [bad.id],
    )
    expect(done.rows[0]).toMatchObject({
      excluded: true,
      note: 'Lamp was changed',
      violations: [],
    })
    const state = await owner.query(
      `select state from api.qc_series where id = $1`,
      [series.id],
    )
    expect(state.rows[0].state).toBe('in_control')
  })
})

describe('plate runs feed their assay design', () => {
  it('tracks Z′ and the control means of an assay and backfills analysed runs', async () => {
    const design = (
      await owner.query(
        `select * from api.create_plate_design($1,'Kinase assay',null,'96_well',8,12)`,
        [WS],
      )
    ).rows[0] as { id: string }
    const wells = [
      { wellCode: 'A1', role: 'negative_control' },
      { wellCode: 'A2', role: 'negative_control' },
      { wellCode: 'B1', role: 'positive_control' },
      { wellCode: 'B2', role: 'positive_control' },
    ]
    const analysis = (zPrime: number) => ({
      qc: {
        zPrime,
        signalToBackground: 8,
        positive: { n: 2, mean: 1000, sd: 10, cv: 1 },
        negative: { n: 2, mean: 100, sd: 5, cv: 5 },
        blank: { n: 0, mean: null, sd: null, cv: null },
      },
      summary: { hitSamples: 0, testedSamples: 0 },
    })
    const run = async (name: string, zPrime: number) => {
      const created = (
        await owner.query(
          `select * from api.create_plate_run($1,'96_well',$2::jsonb,$3::jsonb,'{}'::jsonb,$4,null,$5)`,
          [
            name,
            JSON.stringify(wells),
            JSON.stringify({ A1: 100, A2: 101, B1: 1000, B2: 999 }),
            PROJECT,
            design.id,
          ],
        )
      ).rows[0] as { id: string }
      await owner.query(
        `select * from api.save_plate_run_analysis($1,$2::jsonb,'pass')`,
        [created.id, JSON.stringify(analysis(zPrime))],
      )
      return created.id
    }
    await run('Before tracking', 0.8)
    const tracked = (
      await owner.query(`select * from api.track_plate_assay_qc($1,$2)`, [
        design.id,
        INSTRUMENT,
      ])
    ).rows as Array<{ id: string; metric: string }>
    expect(tracked.map((s) => s.metric).sort()).toEqual([
      'negative_mean',
      'positive_mean',
      'signal_to_background',
      'z_prime',
    ])
    // Tracking twice does not add the same series again.
    const again = await owner.query(
      `select * from api.track_plate_assay_qc($1,$2)`,
      [design.id, INSTRUMENT],
    )
    expect(again.rows).toHaveLength(0)
    const z = tracked.find((s) => s.metric === 'z_prime')!
    const first = await owner.query(
      `select value, label from api.qc_points where series_id = $1`,
      [z.id],
    )
    expect(first.rows).toEqual([{ value: 0.8, label: 'PLR-0001' }])
    // A run analysed after tracking adds a point; re-analysing updates it.
    const second = await run('After tracking', 0.7)
    await owner.query(
      `select * from api.save_plate_run_analysis($1,$2::jsonb,'pass')`,
      [second, JSON.stringify(analysis(0.65))],
    )
    const points = await owner.query(
      `select value from api.qc_points where series_id = $1 order by at, id`,
      [z.id],
    )
    expect(points.rows.map((r) => r.value)).toEqual([0.8, 0.65])
  })
})

describe('ASM documents', () => {
  it('keeps the document with its run, announces it and shows it only to members', async () => {
    const run = (
      await migrator.query(
        `insert into api.instrument_runs(workspace_id,instrument_id,project_id,name,run_identifier)
         values ($1,$2,null,'Read 1','asm-1') returning id`,
        [WS, INSTRUMENT],
      )
    ).rows[0] as { id: string }
    const before = await mark()
    const doc = { '$asm.manifest': 'x', 'plate reader aggregate document': {} }
    const { rows } = await owner.query(
      `select * from api.record_instrument_run_document($1,$2::jsonb,'allotropy','0.1.151','img@sha256:abc','MOLDEV_SOFTMAX_PRO','plate reader','manifest',96,'{"model number":"M5"}'::jsonb)`,
      [run.id, JSON.stringify(doc)],
    )
    expect(rows[0]).toMatchObject({
      converter: 'allotropy',
      measurements: 96,
      format: 'asm',
    })
    expect((await feed(before)).map((e) => e.wire)).toEqual([
      'instrument.run.converted',
    ])
    // Converting again replaces the document; there is one per run.
    await owner.query(
      `select * from api.record_instrument_run_document($1,$2::jsonb,'allotropy','0.1.152')`,
      [run.id, JSON.stringify(doc)],
    )
    const count = await owner.query(
      `select converter_version from api.instrument_run_documents where run_id = $1`,
      [run.id],
    )
    expect(count.rows).toEqual([{ converter_version: '0.1.152' }])
    expect(
      (await viewer.query(`select id from api.instrument_run_documents`))
        .rowCount,
    ).toBe(1)
    expect(
      (await outsider.query(`select id from api.instrument_run_documents`))
        .rowCount,
    ).toBe(0)
    await expect(
      viewer.query(
        `select * from api.record_instrument_run_document($1,$2::jsonb,'allotropy')`,
        [run.id, JSON.stringify(doc)],
      ),
    ).rejects.toThrow(/not permitted|permission|access denied/)
  })
})

describe('who can see and change quality control', () => {
  it('lets members read, writers change, and keeps other workspaces out', async () => {
    const series = await newSeries('visibility')
    expect(
      (
        await viewer.query(`select id from api.qc_series where id = $1`, [
          series.id,
        ])
      ).rowCount,
    ).toBe(1)
    expect(
      (
        await outsider.query(`select id from api.qc_series where id = $1`, [
          series.id,
        ])
      ).rowCount,
    ).toBe(0)
    await expect(
      viewer.query(`select * from api.record_qc_point($1, 1)`, [series.id]),
    ).rejects.toThrow(/not permitted|permission|access denied/)
    await expect(
      outsider.query(`select * from api.set_qc_baseline($1, 1, 1)`, [
        series.id,
      ]),
    ).rejects.toThrow()
  })
})
