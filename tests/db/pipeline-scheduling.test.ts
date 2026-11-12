/**
 * Pipeline scheduling database proof: cron triggers, input bindings (pinned,
 * latest, incremental), the missed-run policy, overlap, the activity log and
 * the event cursor — against a real PostgreSQL surface and the real sweep.
 */
import type { Client } from 'pg'
import { Client as PgClient } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { nextCronAfter } from '#/lib/pipeline-cron'
import { simpleConfig } from '#/lib/pipelines/simple/compile'
import { sweepPipelines } from '#/lib/pipeline-scheduler.server'
import type {
  PipelineSchedulerDeps,
  SchedulerConnection,
} from '#/lib/pipeline-scheduler.server'
import {
  grantProjectAccess,
  prepareTestDatabase,
  setActorJwt,
  testDatabaseName,
} from './helpers'
import { publishPipelineVersion } from './support/publish-pipeline'

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

/** Why a start did not run. Starts that did run are read with `startsOf`. */
async function activityOf(scheduleId: string) {
  const { rows } = await migrator.query<{
    kind: string
    message: string
    detail: { count?: number }
  }>(
    `select kind, message, detail from api.pipeline_schedule_activity
      where schedule_id = $1 and kind <> 'started' order by occurred_at`,
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
        configVersion: 2,
        mode: 'standard',
        description: 'sum the readings',
        parameters: [],
        inputs: [{ name: 'readings', required: true }],
        steps: [
          {
            name: 'analysis',
            kind: 'sql',
            statement: 'SELECT batch, value FROM readings',
          },
        ],
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
  await publishPipelineVersion(owner, WS, version.rows[0].id)
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

describe('sample events as triggers', () => {
  it('starts a run for the one kind of sample event it names, and not for the others', async () => {
    const project = '0e010000-0000-4000-8000-000000000511'
    await migrator.query(
      `insert into api.projects(id, workspace_id, key, title) values ($1, $2, 'samples', 'Samples')`,
      [project, WS],
    )
    await grantProjectAccess(migrator, {
      workspaceId: WS,
      projectId: project,
      userId: OWNER,
      canManage: true,
    })
    const { rows } = await owner.query<{
      id: string
      metadata_version: number
    }>(
      `select * from api.create_record($1::uuid, 'sample', 'Trigger sample', 'available', array[]::text[], $2::jsonb)`,
      [
        project,
        JSON.stringify({
          quantity: 5,
          quantityUnit: 'mL',
          storageLocation: 'Bench 1',
        }),
      ],
    )
    const schedule = await createSchedule('event', {
      eventType: 'sample.received',
      inputs: { readings: { mode: 'latest', datasetId } },
    })
    await isolate(schedule.id)

    // A move is a different sample event on the same producer pair.
    await owner.query(
      `select api.transfer_sample($1::uuid, 'Fridge 1', $2::int, null)`,
      [rows[0].id, rows[0].metadata_version],
    )
    expect(await sweepSweeps()).toBe(0)
    expect(await runsOf(schedule.id)).toHaveLength(0)

    const moved = await migrator.query<{ metadata_version: number }>(
      `select metadata_version from api.records where id = $1`,
      [rows[0].id],
    )
    await owner.query(
      `select api.receive_sample($1::uuid, 3, $2::int, 'mL', null, null)`,
      [rows[0].id, moved.rows[0].metadata_version],
    )
    expect(await sweepSweeps()).toBe(1)
    expect(await runsOf(schedule.id)).toHaveLength(1)
    await settleRuns()
  })
})

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

describe('events told apart by their payload', () => {
  it('starts a pipeline when an instrument run completes, and not when one is queued or fails', async () => {
    const schedule = await createSchedule('event', {
      eventType: 'instrument.run.completed',
      inputs: { readings: { mode: 'latest', datasetId } },
    })
    await isolate(schedule.id)
    const instrument = await owner.query<{ id: string }>(
      `select id from api.create_instrument($1, 'Sweep reader')`,
      [WS],
    )
    const makeRun = async (identifier: string) =>
      (
        await owner.query<{ id: string }>(
          `select id from api.create_instrument_run($1, $2, $2, $3)`,
          [WS, identifier, instrument.rows[0]!.id],
        )
      ).rows[0]!.id
    const failed = await makeRun('sweep-failed')
    await owner.query(`select api.fail_instrument_run($1, $2, 'boom')`, [
      WS,
      failed,
    ])
    expect(await sweepSweeps()).toBe(0)

    const finished = await makeRun('sweep-done')
    await owner.query(`select api.start_instrument_run($1, $2)`, [WS, finished])
    expect(await sweepSweeps()).toBe(0)
    await owner.query(`select api.complete_instrument_run($1, $2)`, [
      WS,
      finished,
    ])
    expect(await sweepSweeps()).toBe(1)
    expect(await runsOf(schedule.id)).toHaveLength(1)
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

describe('a run event never starts its own pipeline again', () => {
  /** A schedule on a pipeline's runs succeeding, added as a person adds one. */
  async function onRunSucceeded(defId: string): Promise<string> {
    const { rows } = await owner.query<{ id: string }>(
      `select (api.create_pipeline_schedule($1::uuid, $2::uuid, 'event', $3::jsonb, true)).id`,
      [
        WS,
        defId,
        JSON.stringify({
          eventType: 'pipeline.run.succeeded',
          inputs: { readings: { mode: 'pinned', versionId: versionIds[0] } },
        }),
      ],
    )
    return rows[0].id
  }

  /** Finishes the running runs as the worker does, so each says so in an event. */
  async function succeedRuns() {
    await migrator.query('BEGIN')
    await migrator.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ role: 'authenticated', sub: OWNER, workspace_id: WS }),
    ])
    await settleRuns()
    await migrator.query('COMMIT')
  }

  it('lets A start B, but not A start A, nor B start A again', async () => {
    const other = await owner.query<{ id: string }>(
      `select * from api.create_pipeline_definition($1::uuid, 'after_summary', 'After summary', null)`,
      [WS],
    )
    const otherId = other.rows[0].id
    const { rows: source } = await migrator.query<{ configuration: unknown }>(
      `select configuration from api.pipeline_definition_versions
        where definition_id = $1 and lifecycle = 'published'`,
      [definitionId],
    )
    const draft = await owner.query<{ id: string }>(
      `select * from api.create_pipeline_definition_version($1::uuid, $2::uuid, $3::jsonb)`,
      [WS, otherId, JSON.stringify(source[0].configuration)],
    )
    await publishPipelineVersion(owner, WS, draft.rows[0].id)

    await settleRuns()
    const onA = await onRunSucceeded(definitionId)
    const onB = await onRunSucceeded(otherId)
    await migrator.query(
      `update api.pipeline_schedules set enabled = (id in ($1, $2))`,
      [onA, onB],
    )

    // A runs by hand and succeeds.
    const { rows: published } = await migrator.query<{ id: string }>(
      `select id from api.pipeline_definition_versions
        where definition_id = $1 and lifecycle = 'published'`,
      [definitionId],
    )
    await owner.query(
      `select * from api.run_pipeline_version($1::uuid, '{}'::jsonb, $2::jsonb)`,
      [published[0].id, JSON.stringify({ readings: versionIds[0] })],
    )
    await succeedRuns()

    // B starts on A's success; A does not start itself.
    expect(await sweepSweeps()).toBe(1)
    expect(await runsOf(onB)).toHaveLength(1)
    expect(await runsOf(onA)).toHaveLength(0)

    // B's success would start A (A led to B) and B (itself): neither runs.
    await succeedRuns()
    expect(await sweepSweeps()).toBe(0)
    expect(await runsOf(onA)).toHaveLength(0)
    expect(await runsOf(onB)).toHaveLength(1)
  })
})

describe('start rules', () => {
  const setRules = (rules: Record<string, unknown>) =>
    owner.query(
      `select * from api.set_pipeline_start_rules($1::uuid, $2::uuid, $3::jsonb)`,
      [WS, definitionId, JSON.stringify(rules)],
    )

  async function startsOf(scheduleId: string) {
    const { rows } = await migrator.query<{
      message: string
      run_id: string | null
      label: string | null
      detail: { joined?: number; newRows?: number | null }
    }>(
      `select message, run_id, label, detail from api.pipeline_schedule_activity
        where schedule_id = $1 and kind = 'started' order by occurred_at`,
      [scheduleId],
    )
    return rows
  }

  afterEach(async () => {
    await migrator.query(
      `update api.pipeline_definitions set start_rules = '{}' where id = $1`,
      [definitionId],
    )
    await settleRuns()
  })

  // A Wednesday at 10:00 UTC, far enough ahead that every schedule is due.
  const WEDNESDAY = new Date('2030-01-02T10:00:00Z')

  it('stores the rules in full and refuses what cannot work', async () => {
    const { rows } = await setRules({
      window: {
        days: 'weekdays',
        from: '07:00',
        to: '19:00',
        timeZone: 'Europe/London',
      },
      minNewRows: 8,
      waitMinutes: 2,
    })
    expect(rows[0].start_rules).toEqual({
      conditionsMatch: 'all',
      window: {
        days: 'weekdays',
        from: '07:00',
        to: '19:00',
        timeZone: 'Europe/London',
      },
      minNewRows: 8,
      waitMinutes: 2,
      whileRunning: 'skip',
      missedRuns: 'run_once',
    })

    await expect(
      setRules({
        window: { days: 'daily', from: '19:00', to: '07:00', timeZone: 'UTC' },
      }),
    ).rejects.toThrow(/open before it closes/)
    await expect(
      setRules({
        window: {
          days: 'daily',
          from: '07:00',
          to: '19:00',
          timeZone: 'Nowhere/Land',
        },
      }),
    ).rejects.toThrow(/unknown time zone/)
    await expect(setRules({ minNewRows: 0 })).rejects.toThrow(/minNewRows/)
    await expect(setRules({ waitMinutes: 2000 })).rejects.toThrow(/waitMinutes/)
    await expect(setRules({ whileRunning: 'queue' })).rejects.toThrow(
      /whileRunning/,
    )

    const cleared = await setRules({})
    expect(cleared.rows[0].start_rules).toEqual({})
  })

  it('skips a timed start outside the window and starts one inside it', async () => {
    const schedule = await createSchedule('interval', {
      intervalMinutes: 60,
      inputs: { readings: { mode: 'latest', datasetId } },
    })
    await isolate(schedule.id)
    await setRules({
      window: { days: 'weekends', from: '07:00', to: '19:00', timeZone: 'UTC' },
    })
    await makeDue(schedule.id, 1)
    expect(await sweepPipelines(sweepDeps(), WEDNESDAY)).toBe(0)
    const skipped = await activityOf(schedule.id)
    expect(skipped.map((a) => a.kind)).toEqual(['skipped_condition'])
    expect(skipped[0].message).toMatch(/Outside the hours/)

    await setRules({
      window: { days: 'weekdays', from: '07:00', to: '19:00', timeZone: 'UTC' },
    })
    await makeDue(schedule.id, 1)
    expect(await sweepPipelines(sweepDeps(), WEDNESDAY)).toBe(1)
    const starts = await startsOf(schedule.id)
    expect(starts).toHaveLength(1)
    expect(starts[0].run_id).toBe((await runsOf(schedule.id))[0].id)
  })

  it('judges a snapshot by the rows it added', async () => {
    const schedule = await createSchedule('event', {
      eventType: 'dataset.versioned',
      inputName: 'readings',
      datasetId,
    })
    await isolate(schedule.id)
    await setRules({ minNewRows: 2 })
    await addVersion('rules-few')
    expect(await sweepSweeps()).toBe(0)
    const skipped = await activityOf(schedule.id)
    expect(skipped.map((a) => a.kind)).toEqual(['skipped_condition'])
    expect(skipped[0].message).toMatch(/Fewer than 2 new rows/)

    await setRules({ minNewRows: 1 })
    const enough = await addVersion('rules-enough')
    expect(await sweepSweeps()).toBe(1)
    expect((await runsOf(schedule.id))[0].input_versions).toMatchObject({
      readings: enough,
    })
    const starts = await startsOf(schedule.id)
    expect(starts[0].detail.newRows).toBe(1)
    expect(starts[0].label).toMatch(/rules-enough/)
  })

  it('waits to batch imports, then runs once for all of them', async () => {
    const schedule = await createSchedule('event', {
      eventType: 'dataset.versioned',
      inputName: 'readings',
      datasetId,
    })
    await isolate(schedule.id)
    await setRules({ waitMinutes: 10 })
    await addVersion('batch-1')
    const last = await addVersion('batch-2')

    expect(await sweepPipelines(sweepDeps())).toBe(0)
    // A second sweep while waiting notes nothing twice.
    expect(await sweepPipelines(sweepDeps())).toBe(0)
    const waiting = await migrator.query(
      `select kind from api.pipeline_schedule_activity where schedule_id = $1`,
      [schedule.id],
    )
    expect(waiting.rows.map((r) => r.kind)).toEqual(['batched', 'batched'])
    expect(await runsOf(schedule.id)).toHaveLength(0)

    const later = new Date(Date.now() + 11 * 60_000)
    expect(await sweepPipelines(sweepDeps(), later)).toBe(1)
    const runs = await runsOf(schedule.id)
    expect(runs).toHaveLength(1)
    expect(runs[0].input_versions).toMatchObject({ readings: last })
    const starts = await startsOf(schedule.id)
    expect(starts).toHaveLength(1)
    expect(starts[0].detail.joined).toBe(1)
    expect(starts[0].detail.newRows).toBe(2)
    // Nothing is left to run on the next sweep.
    await settleRuns()
    expect(await sweepPipelines(sweepDeps(), later)).toBe(0)
  })

  it('holds a start back while any run of the pipeline is going', async () => {
    const running = await createSchedule('interval', {
      intervalMinutes: 60,
      inputs: { readings: { mode: 'latest', datasetId } },
    })
    await isolate(running.id)
    await makeDue(running.id, 1)
    expect(await sweepSweeps()).toBe(1)

    const watcher = await createSchedule('event', {
      eventType: 'dataset.versioned',
      inputName: 'readings',
      datasetId,
    })
    await isolate(watcher.id)
    await setRules({ waitMinutes: 0, minNewRows: 1 })
    await addVersion('while-running')
    expect(await sweepSweeps()).toBe(0)
    const skipped = await activityOf(watcher.id)
    expect(skipped.map((a) => a.kind)).toEqual(['skipped_overlap'])
    expect(await runsOf(watcher.id)).toHaveLength(0)
  })

  it('lists the snapshots a snapshot start heard, with the rows each added', async () => {
    const schedule = await createSchedule('event', {
      eventType: 'dataset.versioned',
      datasetId,
    })
    await isolate(schedule.id)
    const heard = await addVersion('heard-1')

    const { rows } = await owner.query<{
      schedule_id: string
      version_label: string
      new_rows: number
      dataset_id: string
    }>(`select * from api.pipeline_start_events($1::uuid, $2::uuid, 7)`, [
      WS,
      definitionId,
    ])

    const mine = rows.filter((row) => row.schedule_id === schedule.id)
    expect(mine.map((row) => row.version_label)).toContain('heard-1')
    expect(mine.find((row) => row.version_label === 'heard-1')).toMatchObject({
      new_rows: 1,
      dataset_id: datasetId,
    })
    expect(heard).toBeTruthy()

    await expect(
      owner.query(
        `select * from api.pipeline_start_events($1::uuid, $2::uuid, 0)`,
        [WS, definitionId],
      ),
    ).rejects.toThrow(/p_days/)
  })
})

describe('a recipe that starts on a failed run', () => {
  it('is told who owns the pipeline that failed', async () => {
    const def = await owner.query<{ id: string }>(
      `select * from api.create_pipeline_definition($1::uuid, 'tell_owner', 'Tell the owner', null)`,
      [WS],
    )
    const config = simpleConfig({
      when: { datasetId: '', event: 'run_failed' },
      join: 'and',
      conditions: [],
      actions: [
        {
          kind: 'inbox',
          mode: 'task',
          userId: '@event',
          text: 'A run failed',
        },
      ],
    })
    const version = await owner.query<{ id: string }>(
      `select * from api.create_pipeline_definition_version($1::uuid, $2::uuid, $3::jsonb)`,
      [WS, def.rows[0].id, JSON.stringify(config)],
    )
    await migrator.query(
      `select internal.publish_pipeline_definition_version(id, revision, $2) from api.pipeline_definition_versions where id = $1`,
      [version.rows[0].id, OWNER],
    )
    const schedule = await owner.query<{ id: string }>(
      `select * from api.create_pipeline_schedule($1::uuid, $2::uuid, 'event', $3::jsonb, true)`,
      [
        WS,
        def.rows[0].id,
        JSON.stringify({ eventType: 'pipeline.run.failed' }),
      ],
    )
    await isolate(schedule.rows[0].id)

    // A different pipeline's run: a pipeline is never started by its own failure.
    const weekly = await migrator.query<{ id: string }>(
      `select id::text from api.pipeline_definition_versions
        where definition_id = $1 and lifecycle = 'published'`,
      [definitionId],
    )
    const started = await owner.query<{ id: string }>(
      `select (api.start_pipeline_run($1::uuid, $2::uuid, 'manual', '{}'::jsonb, $3::jsonb, null, null, null)).id::text as id`,
      [WS, weekly.rows[0].id, JSON.stringify({ readings: versionIds[0] })],
    )
    // The change event needs someone to say who made it.
    await migrator.query(`select set_config('request.jwt.claims', $1, false)`, [
      JSON.stringify({ role: 'authenticated', sub: OWNER, workspace_id: WS }),
    ])
    await migrator.query(
      `update api.pipeline_runs set status = 'failed', finished_at = now(), error_code = 'x', error_message = 'boom' where id = $1`,
      [started.rows[0].id],
    )
    await migrator.query(`select set_config('request.jwt.claims', '', false)`)
    expect(await sweepSweeps()).toBe(1)

    const { rows } = await migrator.query<{
      parameters: Record<string, string>
    }>(`select parameters from api.pipeline_runs where schedule_id = $1`, [
      schedule.rows[0].id,
    ])
    await settleRuns()
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0].parameters.event_person).toBe(OWNER)
    expect(rows[0].parameters.event_subject).toContain('Weekly summary')
  })
})
