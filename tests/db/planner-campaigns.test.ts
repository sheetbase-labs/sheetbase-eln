/**
 * The experiment planner and optimisation campaigns (migration planner_and_campaigns),
 * against a freshly migrated database: a plan creates everything in one step or
 * nothing; a campaign is proposed a round at a time, approved by a person, filled
 * with results and carries on until it has spent its rounds.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { sweepCampaignRounds } from '../../src/lib/campaigns/round-requests.server'
import { mapEventType } from '../../src/lib/webhook-events'
import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000fd01'
const WS2 = '00000000-0000-4000-8000-00000000fd02'
const PROJECT = '00000000-0000-4000-8000-00000000fd11'
const READER = '00000000-0000-4000-8000-00000000fd21'
const OWNER = 'pc-owner'
const VIEWER = 'pc-viewer'
const OUTSIDER = 'pc-outsider'

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
    JSON.stringify({ sub: userId, workspace_id: workspace, role: 'authenticated' }),
  ])
  return client
}

async function record(kind: string, title: string, properties: Record<string, unknown> = {}) {
  const { rows } = await owner.query(
    `select * from api.create_record($1::uuid,$2,$3,$4,ARRAY[]::text[],$5::jsonb)`,
    [PROJECT, kind, title, kind === 'experiment' ? 'draft' : 'available', JSON.stringify(properties)],
  )
  return rows[0] as { id: string; identifier: string }
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
      where workspace_id = $1 and entity_type in ('experiment_plan','campaign','campaign_round') and sequence > $2
      order by sequence`,
    [WS, since],
  )
  return rows.map((row) => mapEventType(row.entity_type, row.operation, row.payload))
}

const sweep = () =>
  sweepCampaignRounds({
    connect: async () => ({ query: (text, values) => migrator.query(text, values as never) as never, end: async () => {} }),
  })

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  for (const user of [OWNER, VIEWER, OUTSIDER]) {
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values ($1,$1,$2,true)`,
      [user, `${user}@test.invalid`],
    )
  }
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values ($1,'pc','Planner'),($2,'pc2','Other lab')`,
    [WS, WS2],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values ($1,$2,'owner'),($1,$3,'viewer'),($4,$5,'owner')`,
    [WS, OWNER, VIEWER, WS2, OUTSIDER],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,lead_user_id) values ($1,$2,'pc','Planner',$3)`,
    [PROJECT, WS, OWNER],
  )
  await migrator.query(
    `insert into api.instruments(id,workspace_id,name,instrument_type,created_by_user_id)
     values ($1,$2,'Plate reader','other',$3)`,
    [READER, WS, OWNER],
  )
  owner = await actor(OWNER, WS)
  viewer = await actor(VIEWER, WS)
  outsider = await actor(OUTSIDER, WS2)
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

const wells = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    wellCode: `A${i + 1}`,
    role: 'sample',
    sampleLabel: `S${i + 1}`,
    volumeUl: 20,
  }))

describe('plans', () => {
  const plan = (sampleId?: string) => ({
    summary: 'Dose response of compound X.',
    experiment: { title: 'Dose response of X' },
    parts: [
      { title: 'Prepare dilutions', dayOffset: 0, handsOnMinutes: 45, waitAfterMinutes: 0, needs: [] },
      {
        title: 'Read the plate',
        gate: 'block',
        dayOffset: 1,
        handsOnMinutes: 30,
        waitAfterMinutes: 60,
        needs: [{ instrumentId: READER, minutes: 30 }],
      },
    ],
    plate: { name: 'Dose plate', format: '96_well', wells: wells(4) },
    worklist: {
      format: 'csv',
      mode: 'stamp',
      sourcePlate: 'Dilutions',
      transfers: [{ sourceWell: 'A1', destWell: 'A1', volumeUl: 20, label: 'S1' }],
    },
    samples: sampleId ? [{ recordId: sampleId, quantity: 5, unit: 'µL' }] : [],
    schedule: true,
    warnings: [],
  })

  it('is saved as a draft that creates nothing', async () => {
    const before = await mark()
    const row = (
      await owner.query(`select * from api.create_experiment_plan($1,'Test compound X',$2::jsonb,'page')`, [
        PROJECT,
        JSON.stringify(plan()),
      ])
    ).rows[0]
    expect(row).toMatchObject({ status: 'proposed', source: 'page', number: 1 })
    expect(row.summary).toBe('Dose response of compound X.')
    const made = await migrator.query(`select count(*)::int as n from api.records where title = 'Dose response of X'`)
    expect(made.rows[0].n).toBe(0)
    expect(await feed(before)).toEqual(['plan.proposed'])
  })

  it('refuses a plan with no title, a part without a title or a worklist without a plate', async () => {
    const bad = async (patch: Record<string, unknown>) =>
      owner.query(`select * from api.create_experiment_plan($1,'Bad',$2::jsonb)`, [
        PROJECT,
        JSON.stringify({ ...plan(), ...patch }),
      ])
    await expect(bad({ experiment: { title: '' } })).rejects.toThrow(/title/)
    await expect(bad({ parts: [{ title: '' }] })).rejects.toThrow(/every part needs a title/)
    await expect(bad({ plate: undefined })).rejects.toThrow(/worklist needs the plate/)
    await expect(bad({ samples: [{ recordId: READER, quantity: 0 }] })).rejects.toThrow(/quantity above zero/)
  })

  it('is refused for an archived project', async () => {
    await migrator.query(`update api.projects set archived_at = now() where id = $1`, [PROJECT])
    try {
      await expect(
        owner.query(`select * from api.create_experiment_plan($1,'Late',$2::jsonb)`, [PROJECT, JSON.stringify(plan())]),
      ).rejects.toThrow(/archived/)
    } finally {
      await migrator.query(`update api.projects set archived_at = null where id = $1`, [PROJECT])
    }
  })

  it('is for people who can write, in this workspace', async () => {
    await expect(
      viewer.query(`select * from api.create_experiment_plan($1,'Nope',$2::jsonb)`, [PROJECT, JSON.stringify(plan())]),
    ).rejects.toThrow(/not permitted/)
    await expect(
      outsider.query(`select * from api.create_experiment_plan($1,'Nope',$2::jsonb)`, [PROJECT, JSON.stringify(plan())]),
    ).rejects.toThrow(/not found|not permitted/)
    expect((await outsider.query(`select * from api.experiment_plans`)).rows).toHaveLength(0)
  })

  it('creates the experiment, parts, plate, worklist, reservations and a schedule request when applied', async () => {
    const sample = await record('sample', 'Compound X stock', { quantity: 100, quantityUnit: 'µL' })
    const saved = (
      await owner.query(`select * from api.create_experiment_plan($1,'Dose response',$2::jsonb,'assistant')`, [
        PROJECT,
        JSON.stringify(plan(sample.id)),
      ])
    ).rows[0]
    const before = await mark()
    const result = (await owner.query(`select api.apply_experiment_plan($1) as r`, [saved.id])).rows[0].r
    expect(result).toMatchObject({ parts: 2, reservations: 1 })

    const parts = await owner.query(`select * from api.record_parts($1) order by part_number`, [result.recordId])
    expect(parts.rows.map((p: { title: string }) => p.title)).toEqual(['Prepare dilutions', 'Read the plate'])
    const gated = await owner.query(`select opens_when, gate_mode from api.experiment_parts where id = $1`, [
      parts.rows[1].part_id,
    ])
    expect(gated.rows[0].gate_mode).toBe('block')
    expect(gated.rows[0].opens_when).toEqual([{ kind: 'part_done', partId: parts.rows[0].part_id }])
    const needs = await migrator.query(`select minutes, resource_id from api.part_resource_needs where part_id = $1`, [
      parts.rows[1].part_id,
    ])
    expect(needs.rows).toEqual([{ minutes: 30, resource_id: READER }])
    const planRow = await migrator.query(`select hands_on_minutes, wait_after_minutes from api.part_plans where part_id = $1`, [
      parts.rows[1].part_id,
    ])
    expect(planRow.rows[0]).toEqual({ hands_on_minutes: 30, wait_after_minutes: 60 })
    const run = await migrator.query(`select record_id, jsonb_array_length(wells) as wells from api.plate_runs where id = $1`, [result.plateRunId])
    expect(run.rows[0]).toEqual({ record_id: result.recordId, wells: 4 })
    const wl = await migrator.query(`select record_id, run_id as plate_run_id from api.plate_worklists where id = $1`, [result.worklistId])
    expect(wl.rows[0]).toEqual({ record_id: result.recordId, plate_run_id: result.plateRunId })
    const reserved = await migrator.query(`select quantity::numeric as q from api.sample_reservations where sample_record_id = $1 and experiment_record_id = $2`, [
      sample.id,
      result.recordId,
    ])
    expect(Number(reserved.rows[0].q)).toBe(5)
    const proposal = await migrator.query(`select status from api.schedule_proposals where id = $1`, [result.proposalId])
    expect(proposal.rows[0].status).toBe('requested')

    const after = (await owner.query(`select * from api.experiment_plans where id = $1`, [saved.id])).rows[0]
    expect(after).toMatchObject({ status: 'applied', decided_by_user_id: OWNER })
    expect(after.result.recordId).toBe(result.recordId)
    expect(await feed(before)).toContain('plan.applied')

    await expect(owner.query(`select api.apply_experiment_plan($1)`, [saved.id])).rejects.toThrow(/already applied/)
    await expect(owner.query(`select * from api.dismiss_experiment_plan($1)`, [saved.id])).rejects.toThrow(/waiting/)
  })

  it('creates nothing at all when one step is refused', async () => {
    const broken = { ...plan(), parts: [{ title: 'Needs a ghost', needs: [{ instrumentId: '00000000-0000-4000-8000-0000000000aa', minutes: 10 }] }] }
    const saved = (
      await owner.query(`select * from api.create_experiment_plan($1,'Broken',$2::jsonb)`, [PROJECT, JSON.stringify({ ...broken, experiment: { title: 'Broken experiment' } })])
    ).rows[0]
    await expect(owner.query(`select api.apply_experiment_plan($1)`, [saved.id])).rejects.toThrow()
    const made = await migrator.query(`select count(*)::int as n from api.records where title = 'Broken experiment'`)
    expect(made.rows[0].n).toBe(0)
    const row = (await owner.query(`select status from api.experiment_plans where id = $1`, [saved.id])).rows[0]
    expect(row.status).toBe('proposed')
  })

  it('can be dismissed by a writer and not by a viewer', async () => {
    const saved = (
      await owner.query(`select * from api.create_experiment_plan($1,'Dismiss me',$2::jsonb)`, [PROJECT, JSON.stringify(plan())])
    ).rows[0]
    await expect(viewer.query(`select * from api.dismiss_experiment_plan($1)`, [saved.id])).rejects.toThrow()
    const row = (await owner.query(`select * from api.dismiss_experiment_plan($1)`, [saved.id])).rows[0]
    expect(row.status).toBe('dismissed')
  })
})

describe('campaigns', () => {
  const factors = [
    { key: 'temp', label: 'Temperature', kind: 'continuous', min: 20, max: 40, unit: '°C' },
    { key: 'ph', label: 'pH', kind: 'discrete', values: [6, 7, 8] },
    { key: 'buffer', label: 'Buffer', kind: 'categorical', values: ['a', 'b'] },
  ]
  const objectives = [{ key: 'yield', label: 'Yield', direction: 'maximise', unit: '%' }]
  let campaignId: string

  const configure = (id: string, patch: { factors?: unknown; objectives?: unknown; rounds?: number; runs?: number | null; batch?: number; layout?: unknown } = {}, client: Client = owner) =>
    client.query(`select * from api.configure_campaign($1,$2::jsonb,$3::jsonb,$4,$5,$6,'builtin',$7::jsonb,null,true,1)`, [
      id,
      JSON.stringify(patch.factors ?? factors),
      JSON.stringify(patch.objectives ?? objectives),
      patch.batch ?? 4,
      patch.rounds ?? 2,
      patch.runs ?? null,
      JSON.stringify(patch.layout ?? { plateFormat: '96_well', replicates: 2, blanks: 2, volumeUl: 30, worklistFormat: 'csv' }),
    ])

  beforeAll(async () => {
    await owner.query(`select api.create_starter_model('campaign','Campaign','CMP','An optimisation campaign','[]'::jsonb,false)`)
    await owner.query(`select api.create_starter_model('notcampaign','Other','OTH','Not a campaign','[]'::jsonb,false)`)
    await owner.query(`select api.set_model_campaign_list('campaign', true)`)
    campaignId = (await record('campaign', 'Buffer optimisation')).id
  })

  it('needs a record of a model ticked as a campaign list', async () => {
    const other = await record('notcampaign', 'Not a campaign')
    await expect(configure(other.id)).rejects.toThrow(/ticked as a campaign list/)
    await expect(owner.query(`select api.set_model_campaign_list('nothing', true)`)).rejects.toThrow(/model not found/)
    await expect(viewer.query(`select api.set_model_campaign_list('campaign', false)`)).rejects.toThrow()
  })

  it('checks the factors and objectives', async () => {
    await expect(configure(campaignId, { factors: [] })).rejects.toThrow(/between 1 and 24 factors/)
    await expect(configure(campaignId, { factors: [{ key: 'Bad Key', label: 'x', kind: 'continuous', min: 0, max: 1 }] })).rejects.toThrow(/factor key/)
    await expect(configure(campaignId, { factors: [{ key: 'a', label: 'a', kind: 'continuous', min: 5, max: 1 }] })).rejects.toThrow(/minimum below its maximum/)
    await expect(configure(campaignId, { factors: [{ key: 'a', label: 'a', kind: 'discrete', values: [1] }] })).rejects.toThrow(/between 2 and 50/)
    await expect(configure(campaignId, { factors: [factors[0], factors[0]] })).rejects.toThrow(/two factors/)
    await expect(configure(campaignId, { objectives: [{ key: 'y', label: 'y', direction: 'target' }] })).rejects.toThrow(/target value/)
    await expect(configure(campaignId, { objectives: [{ key: 'y', label: 'y', direction: 'best' }] })).rejects.toThrow(/maximise, minimise or hit/)
    await expect(configure(campaignId, { layout: { plateFormat: '97_well' } })).rejects.toThrow(/unsupported plate format/)
  })

  it('is configured by people who can edit it', async () => {
    await expect(configure(campaignId, {}, viewer)).rejects.toThrow()
    const row = (await configure(campaignId)).rows[0]
    expect(row).toMatchObject({ status: 'draft', batch_size: 4, max_rounds: 2, engine: 'builtin' })
  })

  it('asks for the first round when started and does not ask twice', async () => {
    const before = await mark()
    await expect(owner.query(`select * from api.request_campaign_round($1)`, [campaignId])).rejects.toThrow(/start the campaign/)
    const started = (await owner.query(`select * from api.start_campaign($1)`, [campaignId])).rows[0]
    expect(started.status).toBe('active')
    const rounds = (await owner.query(`select * from api.campaign_rounds where campaign_record_id = $1`, [campaignId])).rows
    expect(rounds).toMatchObject([{ number: 1, status: 'requested', batch_size: 4 }])
    const again = (await owner.query(`select * from api.request_campaign_round($1)`, [campaignId])).rows[0]
    expect(again.id).toBe(rounds[0].id)
    expect(await feed(before)).toContain('campaign.started')
    // The design is locked once a round has been asked for.
    await expect(configure(campaignId, { factors: [factors[0], factors[1]] })).rejects.toThrow(/cannot change once a round/)
    expect((await configure(campaignId, { batch: 6 })).rows[0].batch_size).toBe(6)
  })

  it('proposes a round from the server, laid out on a plate', async () => {
    const before = await mark()
    expect(await sweep()).toBe(1)
    const round = (await owner.query(`select * from api.campaign_rounds where campaign_record_id = $1 and number = 1`, [campaignId])).rows[0]
    expect(round).toMatchObject({ status: 'proposed', engine: 'builtin' })
    expect(round.trials).toHaveLength(4)
    expect(round.rationale).toMatchObject({ observations: 0, strategy: 'space-filling' })
    expect(round.plate.wells.filter((w: { role: string }) => w.role === 'sample')).toHaveLength(8)
    expect(round.plate.transfers).toHaveLength(8)
    expect(round.trials[0].wells).toHaveLength(2)
    expect(await feed(before)).toEqual(['campaign.round.proposed'])
    // Nothing has been made yet.
    expect(round.experiment_record_id).toBeNull()
    expect(round.plate_run_id).toBeNull()
  })

  it('is approved by a person, which makes the experiment, series, plate run and worklist', async () => {
    const round = (await owner.query(`select * from api.campaign_rounds where campaign_record_id = $1 and number = 1`, [campaignId])).rows[0]
    await expect(viewer.query(`select * from api.approve_campaign_round($1)`, [round.id])).rejects.toThrow()
    const before = await mark()
    const approved = (await owner.query(`select * from api.approve_campaign_round($1)`, [round.id])).rows[0]
    expect(approved.status).toBe('approved')
    expect(approved.experiment_record_id).not.toBeNull()
    expect(approved.plate_run_id).not.toBeNull()
    expect(approved.worklist_id).not.toBeNull()
    const exp = await migrator.query(`select title, kind from api.records where id = $1`, [approved.experiment_record_id])
    expect(exp.rows[0].kind).toBe('experiment')
    expect(exp.rows[0].title).toMatch(/round 1$/)
    const campaign = (await owner.query(`select series_record_id from api.campaigns where record_id = $1`, [campaignId])).rows[0]
    expect(campaign.series_record_id).toBe(approved.experiment_record_id)
    expect(await feed(before)).toEqual(['campaign.round.approved'])
    await expect(owner.query(`select * from api.approve_campaign_round($1)`, [round.id])).rejects.toThrow(/only a proposed round/)
  })

  it('takes results by hand and from the plate, and carries on with the next round', async () => {
    const round1 = (await owner.query(`select * from api.campaign_rounds where campaign_record_id = $1 and number = 1`, [campaignId])).rows[0]
    await expect(owner.query(`select * from api.record_campaign_results($1,$2::jsonb)`, [round1.id, JSON.stringify([{ trial: 9, results: { yield: 1 } }])])).rejects.toThrow(/trial 9 is not in round 1/)
    await expect(owner.query(`select * from api.record_campaign_results($1,$2::jsonb)`, [round1.id, JSON.stringify([{ trial: 1, results: { colour: 1 } }])])).rejects.toThrow(/not an objective/)
    await expect(owner.query(`select * from api.record_campaign_results($1,$2::jsonb)`, [round1.id, JSON.stringify([{ trial: 1, results: { yield: 'high' } }])])).rejects.toThrow(/must be a number/)

    const partial = (await owner.query(`select * from api.record_campaign_results($1,$2::jsonb)`, [round1.id, JSON.stringify([{ trial: 1, results: { yield: 40 } }])])).rows[0]
    expect(partial.status).toBe('approved')

    // The rest come from the plate's readings: the mean of each trial's wells.
    const readout: Record<string, number> = {}
    round1.trials.forEach((t: { trial: number; wells: string[] }) => t.wells.forEach((w, i) => (readout[w] = t.trial * 10 + i * 2)))
    await migrator.query(`update api.plate_runs set readout = $2::jsonb where id = $1`, [round1.plate_run_id, JSON.stringify(readout)])
    const before = await mark()
    const done = (await owner.query(`select * from api.pull_campaign_round_results($1,'yield')`, [round1.id])).rows[0]
    expect(done.status).toBe('completed')
    expect(done.trials.map((t: { results: { yield: number } }) => t.results.yield)).toEqual([11, 21, 31, 41])
    expect(await feed(before)).toEqual(['campaign.round.completed'])

    // The next round was asked for straight away and learns from these results.
    const next = (await owner.query(`select * from api.campaign_rounds where campaign_record_id = $1 and number = 2`, [campaignId])).rows[0]
    expect(next.status).toBe('requested')
    expect(await sweep()).toBe(1)
    const proposed = (await owner.query(`select * from api.campaign_rounds where id = $1`, [next.id])).rows[0]
    expect(proposed.status).toBe('proposed')
    expect(proposed.rationale).toMatchObject({ observations: 4, strategy: 'expected-improvement' })
    expect(proposed.rationale.best).toMatchObject({ round: 1, trial: 4, values: { yield: 41 } })
    expect(proposed.trials).toHaveLength(6)
  })

  it('can reject a round, ask again, and finishes when the rounds are spent', async () => {
    const round2 = (await owner.query(`select * from api.campaign_rounds where campaign_record_id = $1 and number = 2`, [campaignId])).rows[0]
    const rejected = (await owner.query(`select * from api.reject_campaign_round($1,'Wrong range')`, [round2.id])).rows[0]
    expect(rejected).toMatchObject({ status: 'rejected', error_message: 'Wrong range' })
    // A rejected round does not use up the budget.
    const again = (await owner.query(`select * from api.request_campaign_round($1)`, [campaignId])).rows[0]
    expect(again.number).toBe(3)
    expect(await sweep()).toBe(1)
    const approved = (await owner.query(`select * from api.approve_campaign_round($1)`, [again.id])).rows[0]
    const series = await owner.query(`select count(*)::int as n from api.experiment_series_members where series_record_id = (select series_record_id from api.campaigns where record_id = $1)`, [campaignId])
    expect(series.rows[0].n).toBe(1)
    const before = await mark()
    const results = approved.trials.map((t: { trial: number }) => ({ trial: t.trial, results: { yield: 50 + t.trial } }))
    await owner.query(`select * from api.record_campaign_results($1,$2::jsonb)`, [approved.id, JSON.stringify(results)])
    const campaign = (await owner.query(`select status from api.campaigns where record_id = $1`, [campaignId])).rows[0]
    expect(campaign.status).toBe('finished')
    expect(await feed(before)).toEqual(['campaign.round.completed', 'campaign.finished'])
    await expect(owner.query(`select * from api.request_campaign_round($1)`, [campaignId])).rejects.toThrow(/start the campaign/)
  })

  it('stops at the run budget and when finished by hand', async () => {
    const small = (await record('campaign', 'Small budget')).id
    await configure(small, { rounds: 10, runs: 5, batch: 4, layout: {} })
    await owner.query(`select * from api.start_campaign($1)`, [small])
    await sweep()
    const first = (await owner.query(`select * from api.campaign_rounds where campaign_record_id = $1 and number = 1`, [small])).rows[0]
    expect(first.trials).toHaveLength(4)
    expect(first.plate).toBeNull()
    await owner.query(`select * from api.approve_campaign_round($1)`, [first.id])
    await owner.query(`select * from api.record_campaign_results($1,$2::jsonb)`, [
      first.id,
      JSON.stringify(first.trials.map((t: { trial: number }) => ({ trial: t.trial, results: { yield: t.trial } }))),
    ])
    const second = (await owner.query(`select * from api.campaign_rounds where campaign_record_id = $1 and number = 2`, [small])).rows[0]
    // Only one run is left in the budget.
    expect(second.batch_size).toBe(1)

    const manual = (await record('campaign', 'Finish by hand')).id
    await configure(manual, { layout: {} })
    await expect(owner.query(`select * from api.set_campaign_status($1,'paused')`, [manual])).rejects.toThrow(/has not started/)
    await owner.query(`select * from api.start_campaign($1)`, [manual])
    await owner.query(`select * from api.set_campaign_status($1,'finished')`, [manual])
    const open = await owner.query(`select status from api.campaign_rounds where campaign_record_id = $1`, [manual])
    expect(open.rows.map((r: { status: string }) => r.status)).toEqual(['rejected'])
  })

  it('records a round that could not be proposed as failed', async () => {
    const odd = (await record('campaign', 'Cannot fit')).id
    await configure(odd, { layout: { plateFormat: '6_well', replicates: 1 }, batch: 20 })
    await owner.query(`select * from api.start_campaign($1)`, [odd])
    await sweep()
    const round = (await owner.query(`select * from api.campaign_rounds where campaign_record_id = $1`, [odd])).rows[0]
    expect(round.status).toBe('failed')
    expect(round.error_message).toMatch(/needs 20 wells/)
    expect((await owner.query(`select * from api.reject_campaign_round($1)`, [round.id])).rows[0].status).toBe('rejected')
  })

  it('is hidden from other workspaces', async () => {
    expect((await outsider.query(`select * from api.campaigns`)).rows).toHaveLength(0)
    expect((await outsider.query(`select * from api.campaign_rounds`)).rows).toHaveLength(0)
    expect((await outsider.query(`select * from api.model_campaign_lists`)).rows).toHaveLength(0)
  })
})
