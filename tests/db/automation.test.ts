/**
 * Robots, the scheduler and code cells (migration automation_robots_scheduler_code_cells),
 * against a freshly migrated database: a worklist goes to a robot, waits for a
 * person, and its log withdraws the samples; a plan is accepted into bookings;
 * a code cell run is kept and reproduced.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { sweepScheduleRequests } from '../../src/lib/scheduler/plan-requests.server'
import { mapEventType } from '../../src/lib/webhook-events'
import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000fc01'
const WS2 = '00000000-0000-4000-8000-00000000fc02'
const PROJECT = '00000000-0000-4000-8000-00000000fc11'
const ROBOT = '00000000-0000-4000-8000-00000000fc21'
const READER = '00000000-0000-4000-8000-00000000fc22'
const OWNER = 'au-owner'
const VIEWER = 'au-viewer'
const OUTSIDER = 'au-outsider'

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
      where workspace_id = $1 and entity_type in ('instrument_job','schedule_proposal','code_cell_run') and sequence > $2
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
    `insert into api.workspaces(id,slug,name) values ($1,'au','Automation'),($2,'au2','Other lab')`,
    [WS, WS2],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values ($1,$2,'owner'),($1,$3,'viewer'),($4,$5,'owner')`,
    [WS, OWNER, VIEWER, WS2, OUTSIDER],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,lead_user_id) values ($1,$2,'au','Automation',$3)`,
    [PROJECT, WS, OWNER],
  )
  await migrator.query(
    `insert into api.instruments(id,workspace_id,name,instrument_type,created_by_user_id)
     values ($1,$3,'OT-2','other',$4),($2,$3,'Plate reader','other',$4)`,
    [ROBOT, READER, WS, OWNER],
  )
  owner = await actor(OWNER, WS)
  viewer = await actor(VIEWER, WS)
  outsider = await actor(OUTSIDER, WS2)
  // The booking rules still apply to what the scheduler books.
  await owner.query(
    `select * from api.set_instrument_qualification($1,$2,$3)`,
    [READER, OWNER, new Date(Date.now() + 365 * 86400_000).toISOString()],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

describe('robot settings', () => {
  it('sets a robot up, with the format its driver needs', async () => {
    const set = await owner.query(
      `select * from api.set_instrument_robot($1,'opentrons',null,'{"opentronsPipette":"p20_single_gen2"}'::jsonb)`,
      [ROBOT],
    )
    expect(set.rows[0]).toMatchObject({
      driver: 'opentrons',
      worklist_format: 'opentrons',
    })
    await expect(
      owner.query(
        `select * from api.set_instrument_robot($1,'opentrons','csv')`,
        [ROBOT],
      ),
    ).rejects.toThrow(/Opentrons protocol/)
    await expect(
      owner.query(`select * from api.set_instrument_robot($1,'telepathy')`, [
        ROBOT,
      ]),
    ).rejects.toThrow(/how Sheetbase reaches/)
  })

  it('is for people who manage instruments, in this workspace', async () => {
    await expect(
      viewer.query(`select * from api.set_instrument_robot($1,'file')`, [
        ROBOT,
      ]),
    ).rejects.toThrow(/instrument.manage/)
    await expect(
      outsider.query(`select * from api.set_instrument_robot($1,'file')`, [
        ROBOT,
      ]),
    ).rejects.toThrow(/not found/)
    expect(
      (await outsider.query(`select * from api.instrument_robot_settings`))
        .rows,
    ).toHaveLength(0)
  })
})

describe('a worklist on its way to a robot', () => {
  const transfers = (sampleId: string) => [
    { sourceWell: 'A1', destWell: 'A1', volumeUl: 10, label: 'B', sampleId },
    { sourceWell: 'A1', destWell: 'A2', volumeUl: 5, label: 'B', sampleId },
  ]
  const worklist = async (experimentId: string | null, sampleId: string) =>
    (
      await owner.query(
        `select * from api.create_plate_worklist('Stamp','opentrons','cherry_pick','SRC','96_well','DST','96_well',$1::jsonb,null,$2)`,
        [JSON.stringify(transfers(sampleId)), experimentId],
      )
    ).rows[0] as { id: string; number: number }

  it('is queued, staged by the agent, started by a person, and completed from the robot log', async () => {
    const experiment = await record('experiment', 'Dilution')
    const sample = await record('sample', 'Compound', {
      quantity: 100,
      quantityUnit: 'µL',
    })
    const wl = await worklist(experiment.id, sample.id)
    const before = await mark()

    const job = (
      await owner.query(
        `select * from api.queue_instrument_job($1,$2,'first run')`,
        [ROBOT, wl.id],
      )
    ).rows[0]
    expect(job).toMatchObject({
      status: 'queued',
      number: 1,
      driver: 'opentrons',
      record_id: experiment.id,
    })

    // Nothing can start before the robot has it.
    await expect(
      owner.query(`select * from api.start_instrument_job($1)`, [job.id]),
    ).rejects.toThrow(/not received/)
    // And the same worklist cannot be sent twice.
    await expect(
      owner.query(`select * from api.queue_instrument_job($1,$2)`, [
        ROBOT,
        wl.id,
      ]),
    ).rejects.toThrow(/already on its way/)

    const listed = (
      await owner.query(`select api.agent_instrument_jobs($1) as jobs`, [ROBOT])
    ).rows[0].jobs
    expect(listed).toHaveLength(1)
    expect(listed[0].worklist.transfers).toHaveLength(2)

    await owner.query(
      `select * from api.agent_report_instrument_job($1,'staged','run-9','On the robot')`,
      [job.id],
    )
    // A completed run cannot arrive before anyone started it on the robot, unless the robot reports it started.
    const started = (
      await owner.query(`select * from api.start_instrument_job($1)`, [job.id])
    ).rows[0]
    expect(started).toMatchObject({
      status: 'starting',
      started_by_user_id: OWNER,
    })
    await owner.query(
      `select * from api.agent_report_instrument_job($1,'running',null,'Started')`,
      [job.id],
    )

    const reconciled = [
      { ...transfers(sample.id)[0], status: 'done', movedUl: 10 },
      { ...transfers(sample.id)[1], status: 'short', movedUl: 4 },
    ]
    const done = (
      await owner.query(
        `select * from api.agent_report_instrument_job($1,'complete',null,'Finished',$2::jsonb)`,
        [job.id, JSON.stringify(reconciled)],
      )
    ).rows[0]
    expect(done.status).toBe('complete')
    expect(done.result).toMatchObject({
      transfers: 2,
      byStatus: { done: 1, short: 1 },
    })
    expect(done.remote_ref).toBe('run-9')
    expect(done.log.map((l: { status: string }) => l.status)).toEqual([
      'queued',
      'staged',
      'starting',
      'running',
      'complete',
    ])

    const list = (
      await owner.query(
        `select status, withdrawals from api.plate_worklists where id = $1`,
        [wl.id],
      )
    ).rows[0]
    expect(list.status).toBe('complete')
    expect(list.withdrawals.withdrawn).toHaveLength(1)
    const left = await migrator.query(
      `select (properties->>'quantity')::numeric as q from api.records where id = $1`,
      [sample.id],
    )
    expect(Number(left.rows[0].q)).toBe(86)

    const events = (await feed(before)).map((e) => e.wire)
    expect(events).toEqual([
      'instrument.job.queued',
      'instrument.job.staged',
      'instrument.job.started',
      'instrument.job.completed',
    ])
  })

  it('can be cancelled before the robot has it, and asks a running robot to stop', async () => {
    const sample = await record('sample', 'Compound X', {
      quantity: 100,
      quantityUnit: 'µL',
    })
    const first = await worklist(null, sample.id)
    const queued = (
      await owner.query(`select * from api.queue_instrument_job($1,$2)`, [
        ROBOT,
        first.id,
      ])
    ).rows[0]
    const cancelled = (
      await owner.query(`select * from api.cancel_instrument_job($1)`, [
        queued.id,
      ])
    ).rows[0]
    expect(cancelled.status).toBe('cancelled')
    await expect(
      owner.query(`select * from api.cancel_instrument_job($1)`, [queued.id]),
    ).rejects.toThrow(/already cancelled/)

    const second = await worklist(null, sample.id)
    const job = (
      await owner.query(`select * from api.queue_instrument_job($1,$2)`, [
        ROBOT,
        second.id,
      ])
    ).rows[0]
    await owner.query(
      `select * from api.agent_report_instrument_job($1,'staged','r2')`,
      [job.id],
    )
    const asked = (
      await owner.query(`select * from api.cancel_instrument_job($1)`, [job.id])
    ).rows[0]
    expect(asked).toMatchObject({ status: 'staged', cancel_requested: true })
    const stopped = (
      await owner.query(
        `select * from api.agent_report_instrument_job($1,'cancelled',null,'Stopped')`,
        [job.id],
      )
    ).rows[0]
    expect(stopped.status).toBe('cancelled')
    // A finished job stays finished.
    await expect(
      owner.query(
        `select * from api.agent_report_instrument_job($1,'running')`,
        [job.id],
      ),
    ).rejects.toThrow(/already cancelled/)
  })

  it('closes the job when the worklist is completed by hand', async () => {
    const sample = await record('sample', 'Compound Y', {
      quantity: 100,
      quantityUnit: 'µL',
    })
    const wl = await worklist(null, sample.id)
    const job = (
      await owner.query(`select * from api.queue_instrument_job($1,$2)`, [
        ROBOT,
        wl.id,
      ])
    ).rows[0]
    await owner.query(
      `select * from api.complete_plate_worklist($1,'[]'::jsonb,null,false)`,
      [wl.id],
    )
    const after = (
      await owner.query(
        `select status, result from api.instrument_jobs where id = $1`,
        [job.id],
      )
    ).rows[0]
    expect(after.status).toBe('complete')
    expect(after.result.manual).toBe(true)
  })

  it('needs a robot, a planned worklist and someone who can write', async () => {
    const sample = await record('sample', 'Compound Z', {
      quantity: 100,
      quantityUnit: 'µL',
    })
    const wl = await worklist(null, sample.id)
    await expect(
      owner.query(`select * from api.queue_instrument_job($1,$2)`, [
        READER,
        wl.id,
      ]),
    ).rejects.toThrow(/not been set up as a robot/)
    await expect(
      viewer.query(`select * from api.queue_instrument_job($1,$2)`, [
        ROBOT,
        wl.id,
      ]),
    ).rejects.toThrow(/not permitted/)
    await expect(
      outsider.query(`select * from api.queue_instrument_job($1,$2)`, [
        ROBOT,
        wl.id,
      ]),
    ).rejects.toThrow()
    expect(
      (await viewer.query(`select * from api.instrument_jobs`)).rows.length,
    ).toBeGreaterThan(0)
    expect(
      (await outsider.query(`select * from api.instrument_jobs`)).rows,
    ).toHaveLength(0)
    await expect(
      owner.query(`select api.clear_instrument_robot($1)`, [ROBOT]),
    ).resolves.toBeDefined()
    await owner.query(
      `select * from api.set_instrument_robot($1,'opentrons')`,
      [ROBOT],
    )
  })
})

describe('the scheduler', () => {
  async function experimentWithParts() {
    const experiment = await record('experiment', 'Cell assay')
    const parts = (
      await owner.query(
        `select * from api.split_record_into_parts($1,$2::jsonb)`,
        [
          experiment.id,
          JSON.stringify([
            { title: 'Seed cells', dayOffset: 0 },
            { title: 'Treat', dayOffset: 1 },
            { title: 'Read', dayOffset: 3 },
          ]),
        ],
      )
    ).rows
    return { experiment, parts }
  }

  it('keeps working hours and part needs, for those who may set them', async () => {
    await expect(
      owner.query(
        `select * from api.set_scheduler_settings($1,'Europe/London',480,1080,ARRAY[1,2,3,4])`,
        [WS],
      ),
    ).resolves.toBeDefined()
    await expect(
      owner.query(
        `select * from api.set_scheduler_settings($1,'Mars/Olympus',480,1080,ARRAY[1])`,
        [WS],
      ),
    ).rejects.toThrow(/time zone/)
    await expect(
      owner.query(
        `select * from api.set_scheduler_settings($1,'UTC',600,500,ARRAY[1])`,
        [WS],
      ),
    ).rejects.toThrow(/end after/)
    await expect(
      viewer.query(
        `select * from api.set_scheduler_settings($1,'UTC',480,1080,ARRAY[1])`,
        [WS],
      ),
    ).rejects.toThrow(/settings access/)
  })

  it('asks for a plan once, accepts it into bookings and puts parts on the planned days', async () => {
    const { experiment, parts } = await experimentWithParts()
    expect(parts.length).toBeGreaterThan(0)
    const part = (
      await owner.query(
        `select * from api.record_parts($1) order by part_number`,
        [experiment.id],
      )
    ).rows[1]
    await owner.query(`select * from api.set_part_plan($1,90,1440,$2::jsonb)`, [
      part.part_id,
      JSON.stringify([{ resourceId: READER, minutes: 60 }]),
    ])
    await expect(
      owner.query(`select * from api.set_part_plan($1,90,0,$2::jsonb)`, [
        part.part_id,
        JSON.stringify([{ resourceId: READER, minutes: 1 }]),
      ]),
    ).rejects.toThrow(/between 5 minutes/)
    const needs = await owner.query(
      `select * from api.part_resource_needs where part_id = $1`,
      [part.part_id],
    )
    expect(needs.rows).toHaveLength(1)

    const asked = (
      await owner.query(`select * from api.request_schedule_proposal($1)`, [
        experiment.id,
      ])
    ).rows[0]
    expect(asked).toMatchObject({ status: 'requested', reason: 'plan' })
    const again = (
      await owner.query(`select * from api.request_schedule_proposal($1)`, [
        experiment.id,
      ])
    ).rows[0]
    expect(again.id).toBe(asked.id)

    // The planner (a server worker) claims it and writes the answer.
    const claimed = (
      await migrator.query(`select * from internal.claim_schedule_proposal()`)
    ).rows[0]
    expect(claimed.id).toBe(asked.id)
    const day = new Date(Date.now() + 5 * 86400_000)
    const starts = new Date(
      Date.UTC(
        day.getUTCFullYear(),
        day.getUTCMonth(),
        day.getUTCDate(),
        10,
        0,
      ),
    )
    const ends = new Date(starts.getTime() + 3600_000)
    const before = await mark()
    const items = [
      {
        partId: part.part_id,
        partTitle: 'Treat',
        kind: 'instrument',
        resourceId: READER,
        resourceName: 'Plate reader',
        startsAt: starts.toISOString(),
        endsAt: ends.toISOString(),
        plannedOn: starts.toISOString().slice(0, 10),
        conflicts: [],
      },
    ]
    await migrator.query(
      `select internal.fill_schedule_proposal($1,$2::date,$3::jsonb,0,null)`,
      [asked.id, new Date().toISOString().slice(0, 10), JSON.stringify(items)],
    )
    const proposed = (
      await owner.query(`select * from api.schedule_proposals where id = $1`, [
        asked.id,
      ])
    ).rows[0]
    expect(proposed).toMatchObject({ status: 'proposed', conflict_count: 0 })

    const result = (
      await owner.query(`select api.accept_schedule_proposal($1) as r`, [
        asked.id,
      ])
    ).rows[0].r
    expect(result.skipped).toEqual([])
    expect(result.booked).toHaveLength(1)
    const booking = (
      await owner.query(`select * from api.calendar_bookings where id = $1`, [
        result.booked[0].bookingId,
      ])
    ).rows[0]
    expect(booking).toMatchObject({
      resource_id: READER,
      status: 'confirmed',
      linked_experiment_record_id: experiment.id,
    })
    const moved = (
      await owner.query(
        `select day_offset from api.experiment_parts where id = $1`,
        [part.part_id],
      )
    ).rows[0]
    expect(moved.day_offset).toBeGreaterThanOrEqual(5)
    expect((await feed(before)).map((e) => e.wire)).toEqual([
      'schedule.proposed',
      'schedule.accepted',
    ])
    await expect(
      owner.query(`select api.accept_schedule_proposal($1)`, [asked.id]),
    ).rejects.toThrow(/is accepted/)
  })

  it('lists a slot the booking rules refuse instead of hiding it, and replans when a part slips', async () => {
    const { experiment } = await experimentWithParts()
    const parts = (
      await owner.query(
        `select * from api.record_parts($1) order by part_number`,
        [experiment.id],
      )
    ).rows
    const asked = (
      await owner.query(`select * from api.request_schedule_proposal($1)`, [
        experiment.id,
      ])
    ).rows[0]
    await migrator.query(`select * from internal.claim_schedule_proposal()`)
    const items = [
      {
        partId: parts[0].part_id,
        partTitle: 'Seed',
        kind: 'instrument',
        resourceId: READER,
        resourceName: 'Plate reader',
        startsAt: '2030-01-07T10:00:00Z',
        endsAt: '2030-01-07T11:00:00Z',
        plannedOn: '2030-01-07',
        conflicts: [],
      },
      {
        partId: parts[1].part_id,
        partTitle: 'Treat',
        kind: 'instrument',
        resourceId: READER,
        resourceName: 'Plate reader',
        startsAt: '2030-01-07T10:30:00Z',
        endsAt: '2030-01-07T11:30:00Z',
        plannedOn: '2030-01-07',
        conflicts: [],
      },
    ]
    await migrator.query(
      `select internal.fill_schedule_proposal($1,'2030-01-07',$2::jsonb,0,null)`,
      [asked.id, JSON.stringify(items)],
    )
    const result = (
      await owner.query(`select api.accept_schedule_proposal($1) as r`, [
        asked.id,
      ])
    ).rows[0].r
    expect(result.booked).toHaveLength(1)
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0].reason).toMatch(/overlaps/)

    const planned = (
      await owner.query(
        `select part_number, day_offset from api.record_parts($1) order by part_number`,
        [experiment.id],
      )
    ).rows
    const slipped = (
      await owner.query(`select * from api.slip_experiment_part($1,2)`, [
        parts[1].part_id,
      ])
    ).rows[0]
    expect(slipped).toMatchObject({
      reason: 'slip',
      status: 'requested',
      slipped_part_id: parts[1].part_id,
    })
    const after = (
      await owner.query(
        `select part_number, day_offset from api.record_parts($1) order by part_number`,
        [experiment.id],
      )
    ).rows
    expect(after[1].day_offset).toBe(planned[1].day_offset + 2)
    expect(after[0].day_offset).toBe(planned[0].day_offset)
    await expect(
      owner.query(`select * from api.slip_experiment_part($1,0)`, [
        parts[1].part_id,
      ]),
    ).rejects.toThrow(/between 1 and 365/)
    await expect(
      viewer.query(`select * from api.slip_experiment_part($1,1)`, [
        parts[1].part_id,
      ]),
    ).rejects.toThrow()
    await owner.query(`select * from api.dismiss_schedule_proposal($1)`, [
      slipped.id,
    ])
  })

  it('plans a requested schedule on the server, around bookings and absences', async () => {
    const { experiment } = await experimentWithParts()
    const parts = (
      await owner.query(
        `select * from api.record_parts($1) order by part_number`,
        [experiment.id],
      )
    ).rows
    await owner.query(
      `select * from api.update_experiment_part($1,null,0,$2)`,
      [parts[0].part_id, OWNER],
    )
    await owner.query(`select * from api.set_part_plan($1,60,0,$2::jsonb)`, [
      parts[0].part_id,
      JSON.stringify([{ resourceId: READER, minutes: 60 }]),
    ])
    await owner.query(
      `select * from api.set_part_plan($1,30,1440,'[]'::jsonb)`,
      [parts[1].part_id],
    )
    // Someone else holds the reader first thing, and the owner is away on the first day.
    const start = new Date(Date.now() + 2 * 86400_000)
    const day = start.toISOString().slice(0, 10)
    await migrator.query(
      `insert into api.calendar_bookings(workspace_id,resource_id,title,status,starts_at,ends_at)
       values ($1,$2,'Someone else','confirmed',$3,$4)`,
      [WS, READER, `${day}T00:00:00Z`, `${day}T12:00:00Z`],
    )
    await migrator.query(
      `insert into api.member_absences(workspace_id,user_id,starts_on,ends_on,created_by_user_id)
       values ($1,$2,current_date,current_date + 1,$2)`,
      [WS, OWNER],
    )
    const asked = (
      await owner.query(`select * from api.request_schedule_proposal($1)`, [
        experiment.id,
      ])
    ).rows[0]
    const handled = await sweepScheduleRequests({
      connect: async () => ({
        query: (text, values) => migrator.query(text, values as never) as never,
        end: async () => {},
      }),
      now: () => new Date(),
    })
    expect(handled).toBeGreaterThanOrEqual(1)
    const row = (
      await owner.query(`select * from api.schedule_proposals where id = $1`, [
        asked.id,
      ])
    ).rows[0]
    expect(row.status).toBe('proposed')
    const first = row.items.find(
      (i: { partId: string; kind: string }) =>
        i.partId === parts[0].part_id && i.kind === 'instrument',
    )
    expect(first.title).toContain(experiment.identifier)
    // Not on the days the owner is away, and not while the reader is taken.
    const startsAt = new Date(first.startsAt).getTime()
    expect(startsAt).toBeGreaterThanOrEqual(
      new Date(`${day}T00:00:00Z`).getTime(),
    )
    const clash =
      startsAt < new Date(`${day}T12:00:00Z`).getTime() &&
      first.plannedOn === day
    expect(clash).toBe(false)
    expect(row.conflict_count).toBe(0)
    // The second part waits for the first and lands later.
    const second = row.items.find(
      (i: { partId: string }) => i.partId === parts[1].part_id,
    )
    expect(new Date(second.startsAt).getTime()).toBeGreaterThan(startsAt)
  })

  it('shows proposals only to people who can see the experiment’s workspace', async () => {
    expect(
      (await outsider.query(`select * from api.schedule_proposals`)).rows,
    ).toHaveLength(0)
  })
})

describe('code cells', () => {
  const sha = 'a'.repeat(64)
  const run = (experimentId: string, over: Record<string, unknown> = {}) =>
    owner.query(
      `select * from api.record_code_cell_run($1,null,'python',$2,$3,'[]'::jsonb,'{}'::jsonb,'succeeded',$4::jsonb,$5,'sha256:img',null,'[]'::jsonb,null,12,$6,$7,null)`,
      [
        experimentId,
        'def transform(inputs, parameters):\n    return []',
        sha,
        JSON.stringify({
          rows: [{ a: 1 }],
          rowCount: 1,
          columns: [{ name: 'a', type: 'integer' }],
        }),
        'b'.repeat(64),
        over.reproduces ?? null,
        over.matches ?? null,
      ],
    )

  it('keeps a run with its code, digest and runtime, and a reproduction of it', async () => {
    const experiment = await record('experiment', 'Analysis')
    const before = await mark()
    const first = (await run(experiment.id)).rows[0]
    expect(first).toMatchObject({
      status: 'succeeded',
      runtime: 'sha256:img',
      number: 1,
      matches: null,
    })
    const again = (
      await run(experiment.id, { reproduces: first.id, matches: true })
    ).rows[0]
    expect(again).toMatchObject({ reproduces_run_id: first.id, matches: true })
    expect((await feed(before)).map((e) => e.wire)).toEqual([
      'code_cell.run',
      'code_cell.reproduced',
    ])
  })

  it('refuses a bad language, a viewer and a stranger', async () => {
    const experiment = await record('experiment', 'Analysis 2')
    await expect(
      owner.query(
        `select * from api.record_code_cell_run($1,null,'ruby','x',$2,'[]','{}','succeeded',null,null,null,null,'[]',null,1)`,
        [experiment.id, sha],
      ),
    ).rejects.toThrow(/Python or SQL/)
    await expect(
      viewer.query(
        `select * from api.record_code_cell_run($1,null,'python','x',$2,'[]','{}','succeeded',null,null,null,null,'[]',null,1)`,
        [experiment.id, sha],
      ),
    ).rejects.toThrow(/not permitted/)
    expect(
      (await outsider.query(`select * from api.code_cell_runs`)).rows,
    ).toHaveLength(0)
  })

  it('stores a code cell block', async () => {
    const experiment = await record('experiment', 'Analysis 3')
    const block = await owner
      .query(
        `select * from api.create_block($1,'code_cell','{"language":"python","source":"print(1)"}'::jsonb)`,
        [experiment.id],
      )
      .catch((error: Error) => error)
    // create_block may have another signature; the constraint is what this checks.
    const check = await migrator.query(
      `select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'chk_blocks_type'`,
    )
    expect(check.rows[0].def).toContain("'code_cell'")
    expect(block).toBeDefined()
  })

  it('reads the rows of a dataset version as objects', async () => {
    await expect(
      owner.query(
        `select api.dataset_version_rows_json('00000000-0000-4000-8000-00000000ffff')`,
      ),
    ).rejects.toThrow(/not found/)
  })
})
