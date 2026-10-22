/**
 * Pipeline scheduling database proof: cron triggers, input bindings (pinned,
 * latest, incremental), the missed-run policy, overlap, the activity log and
 * the event cursor — against a real PostgreSQL surface and the real sweep.
 */
import type { Client } from 'pg'
import { Client as PgClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { nextCronAfter } from '#/lib/pipeline-cron'
import { sweepPipelines } from '#/lib/pipeline-scheduler.server'
import type {
  PipelineSchedulerDeps,
  SchedulerConnection,
} from '#/lib/pipeline-scheduler.server'
import { prepareTestDatabase, setActorJwt, testDatabaseName } from './helpers'

const WS = '0e010000-0000-4000-8000-000000000501'
const OWNER = 'scheduling-owner-a'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

let schemaVersionId = ''
let definitionId = ''
let owner: Client
let sweepConn: PgClient

const FIELD: Record<string, string> = {}

function superuserTestUrl(): string {
  const url = new URL(process.env.DATABASE_URL!)
  url.pathname = `/${testDatabaseName()}`
  return url.toString()
}

async function actor(userId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await setActorJwt(client, userId, WS)
  return client
}

async function createSchedule(
  kind: string,
  spec: Record<string, unknown>,
  enabled = true,
): Promise<{
  id: string
  next_run_at: string | null
  last_evaluated_sequence: string | null
}> {
  const { rows } = await owner.query(
    `select * from api.create_pipeline_schedule($1::uuid, $2::uuid, $3::text, $4::jsonb, $5::boolean)`,
    [WS, definitionId, kind, JSON.stringify(spec), enabled],
  )
  return rows[0]
}

async function updateSchedule(
  id: string,
  patch: { kind?: string; spec?: Record<string, unknown>; enabled?: boolean },
) {
  const { rows } = await owner.query(
    `select * from api.update_pipeline_schedule($1::uuid, $2::uuid, $3::text, $4::jsonb, $5::boolean)`,
    [
      WS,
      id,
      patch.kind ?? null,
      patch.spec ? JSON.stringify(patch.spec) : null,
      patch.enabled ?? null,
    ],
  )
  return rows[0]
}

/** Only this schedule is live, so a sweep cannot start anyone else's run. */
async function isolate(scheduleId: string) {
  await migrator.query(
    `update api.pipeline_schedules set enabled = (id = $1)`,
    [scheduleId],
  )
}

async function makeDue(scheduleId: string, minutesAgo: number) {
  await migrator.query(
    `update api.pipeline_schedules
        set next_run_at = now() - make_interval(mins => $2) where id = $1`,
    [scheduleId, minutesAgo],
  )
}

function schedulerConnection(conn: Client): SchedulerConnection {
  return {
    query: async (text, values = []) => conn.query(text, values),
    begin: () => conn.query('BEGIN').then(() => undefined),
    commit: () => conn.query('COMMIT').then(() => undefined),
    rollback: () => conn.query('ROLLBACK').then(() => undefined),
    end: () => Promise.resolve(),
  }
}

/** Starts runs but never executes them: they stay `running` until settled. */
function sweepDeps(): PipelineSchedulerDeps {
  return {
    connect: () => Promise.resolve(schedulerConnection(sweepConn)),
    run: async () => undefined,
  }
}

async function settleRuns() {
  await migrator.query(
    `update api.pipeline_runs
        set status = 'succeeded', finished_at = now()
      where status = 'running'`,
  )
}

async function runsOf(scheduleId: string) {
  const { rows } = await migrator.query<{
    id: string
    input_versions: Record<string, string>
    trigger_kind: string
  }>(
    `select id, input_versions, trigger_kind from api.pipeline_runs
      where schedule_id = $1 order by started_at`,
    [scheduleId],
  )
  return rows
}

async function activityOf(scheduleId: string) {
  const { rows } = await migrator.query<{
    kind: string
    message: string
    detail: { count?: number }
  }>(
    `select kind, message, detail from api.pipeline_schedule_activity
      where schedule_id = $1 order by occurred_at`,
    [scheduleId],
  )
  return rows
}

let datasetId = ''
let revision = 2
const versionIds: string[] = []
let rowCounter = 0

/** A new Dataset Version of the shared Dataset. */
async function addVersion(label: string): Promise<string> {
  rowCounter += 1
  const rowId = `aaaaaaaa-aaaa-4aaa-8aaa-${String(rowCounter).padStart(12, '0')}`
  await owner.query(
    `select api.commit_dataset_row_batch($1::uuid, $2::bigint, $3::jsonb, $4::text)`,
    [
      datasetId,
      revision,
      JSON.stringify([
        {
          operation: 'create',
          rowId,
          values: { [FIELD.batch]: 'Z', [FIELD.value]: rowCounter },
        },
      ]),
      `scheduling-${label}`,
    ],
  )
  revision += 1
  const { rows } = await owner.query<{ id: string }>(
    `select (api.snapshot_dataset($1::uuid, $2::bigint, $3::text)).id::text as id`,
    [datasetId, revision, label],
  )
  versionIds.push(rows[0].id)
  return rows[0].id
}

beforeAll(async () => {
  const prepared = await prepareTestDatabase()
  migrator = prepared.migrator
  asRole = prepared.asRole

  await migrator.query(
    `insert into api.workspaces(id, slug, name) values($1, 'scheduling-ws', 'Scheduling WS')`,
    [WS],
  )
  await migrator.query(
    `insert into internal."user"(id, name, email) values ($1, 'Owner', 'owner@scheduling.test')`,
    [OWNER],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id, user_id, role) values ($1, $2, 'owner')`,
    [WS, OWNER],
  )
  owner = await actor(OWNER)
  sweepConn = new PgClient({ connectionString: superuserTestUrl() })
  await sweepConn.connect()

  const { rows: schema } = await owner.query<{
    schema: { schema_version_id: string }
  }>(
    `select api.create_dataset_schema_definition($1::uuid, $2::text, $3::text, $4::text, $5::jsonb) as schema`,
    [
      WS,
      'scheduling_measurement',
      'Scheduling measurement',
      null,
      JSON.stringify([
        { key: 'batch', label: 'Batch', logicalType: 'text', nullable: false },
        {
          key: 'value',
          label: 'Value',
          logicalType: 'decimal',
          nullable: false,
        },
      ]),
    ],
  )
  schemaVersionId = schema[0].schema.schema_version_id
  await owner.query(`select api.publish_dataset_schema_version($1::uuid)`, [
    schemaVersionId,
  ])
  const fields = await migrator.query<{ id: string; key: string }>(
    `select field_id as id, key from api.dataset_schema_version_fields
      where schema_version_id = $1 and lifecycle = 'active'`,
    [schemaVersionId],
  )
  for (const field of fields.rows) FIELD[field.key] = field.id

  const created = await owner.query<{ id: string }>(
    `insert into api.datasets(workspace_id, schema_version_id, name, created_by_user_id)
     values ($1, $2, 'Weekly readings', $3) returning id`,
    [WS, schemaVersionId, OWNER],
  )
  datasetId = created.rows[0].id
  // The Dataset starts at revision 1; the first version is made like the rest.
  await owner.query(
    `select api.commit_dataset_row_batch($1::uuid, 1::bigint, $2::jsonb, $3::text)`,
    [
      datasetId,
      JSON.stringify([
        {
          operation: 'create',
          rowId: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001',
          values: { [FIELD.batch]: 'A', [FIELD.value]: 1 },
        },
      ]),
      'scheduling-seed',
    ],
  )
  const first = await owner.query<{ id: string }>(
    `select (api.snapshot_dataset($1::uuid, 2::bigint, 'seed')).id::text as id`,
    [datasetId],
  )
  versionIds.push(first.rows[0].id)

  const def = await owner.query<{ id: string }>(
    `select * from api.create_pipeline_definition($1::uuid, 'weekly_summary', 'Weekly summary', null)`,
    [WS],
  )
  definitionId = def.rows[0].id
  const version = await owner.query<{ id: string }>(
    `select * from api.create_pipeline_definition_version($1::uuid, $2::uuid, $3::jsonb)`,
    [
      WS,
      definitionId,
      JSON.stringify({
        configVersion: 1,
        description: 'sum the readings',
        parameters: [],
        inputs: [{ name: 'readings', required: true }],
        transform: {
          language: 'sql',
          statement: 'SELECT batch, value FROM readings',
        },
        output: {
          mode: 'create',
          schemaVersionId,
          datasetName: 'Summary',
          datasetLabel: 'summary',
          fieldMapping: null,
        },
      }),
    ],
  )
  await owner.query(
    `select api.publish_pipeline_definition_version($1::uuid, $2::uuid)`,
    [WS, version.rows[0].id],
  )
})

afterAll(async () => {
  await sweepConn?.end().catch(() => {})
  for (const client of clients) await client.end().catch(() => {})
  await migrator?.end()
})

describe('cron on the database matches the page', () => {
  const cases: Array<[string, string, string]> = [
    ['0 9 * * 1-5', 'UTC', '2026-10-23T10:00:00Z'],
    ['*/20 8-10 * * *', 'Europe/London', '2026-10-21T08:41:00Z'],
    ['30 9 * * *', 'Europe/London', '2026-10-24T00:00:00Z'],
    ['30 9 * * *', 'Europe/London', '2026-10-25T09:00:00Z'],
    ['0 8 * * *', 'America/New_York', '2026-10-22T03:30:00Z'],
    ['0 0 1 * 1', 'UTC', '2026-10-21T00:00:00Z'],
    ['15 14 1,15 * *', 'Asia/Tokyo', '2026-12-31T20:00:00Z'],
    ['0 0 29 2 *', 'UTC', '2026-10-21T00:00:00Z'],
    ['0 6 * * 0,7', 'Australia/Sydney', '2026-10-21T00:00:00Z'],
  ]
  for (const [expression, zone, from] of cases) {
    it(`${expression} in ${zone} after ${from}`, async () => {
      const { rows } = await migrator.query<{ next: Date }>(
        `select api.pipeline_cron_next($1, $2, $3::timestamptz) as next`,
        [expression, zone, from],
      )
      expect(rows[0].next.toISOString()).toBe(
        nextCronAfter(expression, zone, new Date(from))!.toISOString(),
      )
    })
  }

  it('refuses an invalid expression, zone or an impossible date', async () => {
    for (const [expression, zone] of [
      ['0 9 * *', 'UTC'],
      ['61 9 * * *', 'UTC'],
      ['0 9 * * *', 'Nowhere/Land'],
      ['0 0 31 2 *', 'UTC'],
    ]) {
      await expect(
        migrator.query(`select api.pipeline_cron_next($1, $2, now())`, [
          expression,
          zone,
        ]),
        `${expression} ${zone}`,
      ).rejects.toMatchObject({ code: 'SB034' })
    }
  })
})

describe('creating and updating triggers', () => {
  it('stamps next_run_at for a cron trigger and stores its zone', async () => {
    const schedule = await createSchedule('cron', {
      cron: '0 9 * * 1-5',
      timeZone: 'Europe/London',
    })
    expect(schedule.next_run_at).not.toBeNull()
    const expected = nextCronAfter('0 9 * * 1-5', 'Europe/London', new Date())!
    // Created a moment ago: the next run is the same weekday 09:00.
    expect(
      Math.abs(new Date(schedule.next_run_at!).getTime() - expected.getTime()),
    ).toBeLessThan(2 * 60_000)
  })

  it('refuses an invalid cron expression and a missing Dataset binding', async () => {
    await expect(
      createSchedule('cron', { cron: 'every day' }),
    ).rejects.toMatchObject({ code: 'SB034' })
    await expect(
      createSchedule('daily', {
        dailyAt: '06:00',
        inputs: {
          readings: {
            mode: 'latest',
            datasetId: '00000000-0000-4000-8000-00000000dead',
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'SB034' })
    await expect(
      createSchedule('daily', {
        dailyAt: '06:00',
        missedRunPolicy: 'whenever',
      }),
    ).rejects.toMatchObject({ code: 'SB034' })
  })

  it('refuses incremental inputs on an event trigger', async () => {
    await expect(
      createSchedule('event', {
        eventType: 'dataset.versioned',
        inputs: { other: { mode: 'incremental', datasetId } },
      }),
    ).rejects.toMatchObject({ code: 'SB034' })
  })

  it('starts a new event trigger at the workspace cursor and does not replay history', async () => {
    await addVersion('history-1')
    const head = await changeHead()
    const schedule = await createSchedule('event', {
      eventType: 'dataset.versioned',
      inputName: 'readings',
    })
    // It starts at the workspace's change sequence, not at zero.
    expect(Number(schedule.last_evaluated_sequence)).toBeGreaterThanOrEqual(
      head,
    )
    await isolate(schedule.id)
    expect(await sweepSweeps()).toBe(0)

    const fresh = await addVersion('fresh-1')
    expect(await sweepSweeps()).toBe(1)
    const runs = await runsOf(schedule.id)
    expect(runs).toHaveLength(1)
    expect(runs[0].input_versions).toEqual({ readings: fresh })
    await settleRuns()
  })
})

async function changeHead(): Promise<number> {
  const { rows } = await migrator.query<{ head: string }>(
    `select max(sequence)::text as head from api.change_events where workspace_id = $1`,
    [WS],
  )
  return Number(rows[0].head)
}

async function sweepSweeps(): Promise<number> {
  return sweepPipelines(sweepDeps())
}

describe('input bindings', () => {
  it('reads the Dataset latest version when the run starts, not a pinned one', async () => {
    const schedule = await createSchedule('interval', {
      intervalMinutes: 60,
      inputs: { readings: { mode: 'latest', datasetId } },
    })
    await isolate(schedule.id)
    const newest = await addVersion('latest-1')
    await makeDue(schedule.id, 1)
    expect(await sweepSweeps()).toBe(1)
    expect((await runsOf(schedule.id))[0].input_versions).toEqual({
      readings: newest,
    })

    // The same trigger a day later reads whatever is newest then.
    await settleRuns()
    const newer = await addVersion('latest-2')
    await makeDue(schedule.id, 1)
    expect(await sweepSweeps()).toBe(1)
    const runs = await runsOf(schedule.id)
    expect(runs).toHaveLength(2)
    expect(runs[1].input_versions).toEqual({ readings: newer })
    await settleRuns()
  })

  it('runs an incremental input only when the Dataset has a new version', async () => {
    const schedule = await createSchedule('interval', {
      intervalMinutes: 60,
      inputs: { readings: { mode: 'incremental', datasetId } },
    })
    await isolate(schedule.id)
    const first = await addVersion('inc-1')

    await makeDue(schedule.id, 1)
    expect(await sweepSweeps()).toBe(1)
    expect((await runsOf(schedule.id))[0].input_versions).toEqual({
      readings: first,
    })
    await settleRuns()
    const { rows: marked } = await migrator.query(
      `select input_watermarks from api.pipeline_schedules where id = $1`,
      [schedule.id],
    )
    expect(marked[0].input_watermarks).toEqual({ readings: first })

    // Nothing new: two ticks, no runs, one counted activity row.
    await makeDue(schedule.id, 1)
    expect(await sweepSweeps()).toBe(0)
    await makeDue(schedule.id, 1)
    expect(await sweepSweeps()).toBe(0)
    expect(await runsOf(schedule.id)).toHaveLength(1)
    const idle = await activityOf(schedule.id)
    expect(idle).toHaveLength(1)
    expect(idle[0].kind).toBe('skipped_unchanged')
    expect(idle[0].detail.count).toBe(2)

    // A new version: the next tick runs on it and moves the watermark.
    const second = await addVersion('inc-2')
    await makeDue(schedule.id, 1)
    expect(await sweepSweeps()).toBe(1)
    const runs = await runsOf(schedule.id)
    expect(runs).toHaveLength(2)
    expect(runs[1].input_versions).toEqual({ readings: second })
    await settleRuns()
    const { rows: moved } = await migrator.query(
      `select input_watermarks from api.pipeline_schedules where id = $1`,
      [schedule.id],
    )
    expect(moved[0].input_watermarks).toEqual({ readings: second })
  })

  it('records an unresolved input instead of failing silently', async () => {
    const empty = await owner.query<{ id: string }>(
      `insert into api.datasets(workspace_id, schema_version_id, name, created_by_user_id)
       values ($1, $2, 'Not yet snapshotted', $3) returning id`,
      [WS, schemaVersionId, OWNER],
    )
    const schedule = await createSchedule('interval', {
      intervalMinutes: 60,
      inputs: { readings: { mode: 'latest', datasetId: empty.rows[0].id } },
    })
    await isolate(schedule.id)
    await makeDue(schedule.id, 1)
    expect(await sweepSweeps()).toBe(0)
    const activity = await activityOf(schedule.id)
    expect(activity.map((a) => a.kind)).toEqual(['input_unresolved'])
    expect(activity[0].message).toMatch(/readings/)
  })

  it('pinned bindings keep reading the one version', async () => {
    const pinned = versionIds[0]
    const schedule = await createSchedule('interval', {
      intervalMinutes: 60,
      inputs: { readings: { mode: 'pinned', versionId: pinned } },
    })
    await isolate(schedule.id)
    await addVersion('pin-noise')
    await makeDue(schedule.id, 1)
    expect(await sweepSweeps()).toBe(1)
    expect((await runsOf(schedule.id))[0].input_versions).toEqual({
      readings: pinned,
    })
    await settleRuns()
  })

  it('binds an event trigger to the version that triggered it', async () => {
    const schedule = await createSchedule('event', {
      eventType: 'dataset.versioned',
      inputName: 'readings',
      datasetId,
    })
    await isolate(schedule.id)
    const created = await addVersion('evt-bound')
    expect(await sweepSweeps()).toBe(1)
    expect((await runsOf(schedule.id))[0].input_versions).toMatchObject({
      readings: created,
    })
    await settleRuns()
  })
})

describe('missed runs, overlap and pausing', () => {
  it('runs once on recovery by default', async () => {
    const schedule = await createSchedule('interval', {
      intervalMinutes: 60,
      inputs: { readings: { mode: 'latest', datasetId } },
    })
    await isolate(schedule.id)
    await makeDue(schedule.id, 180)
    expect(await sweepSweeps()).toBe(1)
    expect(await runsOf(schedule.id)).toHaveLength(1)
    await settleRuns()
  })

  it('skips what was missed when the policy says skip, and says so', async () => {
    const schedule = await createSchedule('interval', {
      intervalMinutes: 60,
      missedRunPolicy: 'skip',
      inputs: { readings: { mode: 'latest', datasetId } },
    })
    await isolate(schedule.id)
    await makeDue(schedule.id, 180)
    expect(await sweepSweeps()).toBe(0)
    expect(await runsOf(schedule.id)).toHaveLength(0)
    const activity = await activityOf(schedule.id)
    expect(activity.map((a) => a.kind)).toEqual(['skipped_missed'])
    const { rows } = await migrator.query(
      `select next_run_at > now() as moved from api.pipeline_schedules where id = $1`,
      [schedule.id],
    )
    expect(rows[0].moved).toBe(true)

    // A tick that is only a little late still runs.
    await makeDue(schedule.id, 2)
    expect(await sweepSweeps()).toBe(1)
    await settleRuns()
  })

  it('does not stack a run on one that is still working', async () => {
    const schedule = await createSchedule('interval', {
      intervalMinutes: 60,
      inputs: { readings: { mode: 'latest', datasetId } },
    })
    await isolate(schedule.id)
    await makeDue(schedule.id, 1)
    expect(await sweepSweeps()).toBe(1)
    // The first run never finishes; the next tick is skipped, with a reason.
    await makeDue(schedule.id, 1)
    expect(await sweepSweeps()).toBe(0)
    expect(await runsOf(schedule.id)).toHaveLength(1)
    expect((await activityOf(schedule.id)).map((a) => a.kind)).toEqual([
      'skipped_overlap',
    ])
    await settleRuns()
  })

  it('a paused trigger does not run and a resumed one carries on from now', async () => {
    const schedule = await createSchedule('interval', {
      intervalMinutes: 60,
      inputs: { readings: { mode: 'latest', datasetId } },
    })
    await isolate(schedule.id)
    await updateSchedule(schedule.id, { enabled: false })
    await makeDue(schedule.id, 600)
    expect(await sweepSweeps()).toBe(0)
    const resumed = await updateSchedule(schedule.id, { enabled: true })
    expect(new Date(resumed.next_run_at).getTime()).toBeGreaterThan(Date.now())
    expect(await sweepSweeps()).toBe(0)
  })

  it('resuming an event trigger honours the missed-run policy', async () => {
    const skipping = await createSchedule('event', {
      eventType: 'dataset.versioned',
      inputName: 'readings',
      missedRunPolicy: 'skip',
    })
    const catchingUp = await createSchedule('event', {
      eventType: 'dataset.versioned',
      inputName: 'readings',
    })
    await updateSchedule(skipping.id, { enabled: false })
    await updateSchedule(catchingUp.id, { enabled: false })
    await addVersion('while-paused')
    const pausedEvent = await changeHead()
    const a = await updateSchedule(skipping.id, { enabled: true })
    const b = await updateSchedule(catchingUp.id, { enabled: true })
    // Skip: moved past the paused event, which is ignored.
    expect(Number(a.last_evaluated_sequence)).toBeGreaterThanOrEqual(
      pausedEvent,
    )
    // Run once: the cursor stays, so the waiting event is still to process.
    expect(Number(b.last_evaluated_sequence)).toBeLessThan(pausedEvent)
    await isolate(catchingUp.id)
    expect(await sweepSweeps()).toBe(1)
    await settleRuns()
  })
})
