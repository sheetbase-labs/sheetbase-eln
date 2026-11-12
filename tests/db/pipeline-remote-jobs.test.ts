/**
 * Pipelines, build H: a job on an HPC queue and SQL over the lakehouse.
 *
 * The migration adds the two step kinds, a check on their settings when a
 * version is saved, the table of jobs a run sent, and the steward's switch for
 * lakehouse SQL. The runner and the callback talk to a fake scheduler here; the
 * database is the real one.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase, setActorJwt } from './helpers'
import {
  handleRemoteJobInput,
  handleRemoteJobResult,
  runRemoteJobStep,
  sweepRemoteJobs,
} from '#/lib/pipeline-hpc.server'
import type {
  HpcConnection,
  JobCallbackDeps,
  RemoteJobDeps,
  SchedulerClient,
  SubmitJob,
} from '#/lib/pipeline-hpc.server'
import type { PipelineRemoteJobStep } from '#/lib/pipelines/config'

const WS = '00000000-0000-4000-8000-000000060000'
const OTHER_WS = '00000000-0000-4000-8000-000000060010'
const DEF = '00000000-0000-4000-8000-000000060001'
const VERSION = '00000000-0000-4000-8000-000000060002'
const RUN = '00000000-0000-4000-8000-000000060003'
const OWNER = 'pipeh-owner'
const SCIENTIST = 'pipeh-scientist'
const OUTSIDER = 'pipeh-outsider'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())

  for (const user of [OWNER, SCIENTIST, OUTSIDER]) {
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values($1,$1,$2,true)`,
      [user, `${user}@test.invalid`],
    )
  }

  for (const [id, slug] of [
    [WS, 'pipeh'],
    [OTHER_WS, 'pipehb'],
  ]) {
    await migrator.query(
      `insert into api.workspaces(id,slug,name) values($1,$2,$2)`,
      [id, slug],
    )
  }

  for (const [user, role, ws] of [
    [OWNER, 'owner', WS],
    [SCIENTIST, 'scientist', WS],
    [OUTSIDER, 'owner', OTHER_WS],
  ]) {
    await migrator.query(
      `insert into api.workspace_memberships(workspace_id,user_id,role) values($1,$2,$3)`,
      [ws, user, role],
    )
  }

  await migrator.query(
    `insert into api.pipeline_definitions(id,workspace_id,key,name) values($1,$2,'pipeh','Pipeline H')`,
    [DEF, WS],
  )
  await migrator.query(
    `insert into api.pipeline_definition_versions(id,definition_id,workspace_id,version,lifecycle,configuration)
     values($1,$2,$3,1,'published','{}'::jsonb)`,
    [VERSION, DEF, WS],
  )
  await migrator.query(
    `insert into api.pipeline_runs(id,workspace_id,definition_version_id,trigger_kind,status,parameters,input_versions,actor_user_id)
     values($1,$2,$3,'manual','running','{}'::jsonb,'{}'::jsonb,$4)`,
    [RUN, WS, VERSION, OWNER],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

async function actor(userId: string, workspaceId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('set role authenticated')
  await setActorJwt(client, userId, workspaceId)

  return client
}

type JobOverrides = Partial<PipelineRemoteJobStep['remoteJob']>

const job = (over: JobOverrides = {}) => ({
  connection: 'campus-hpc',
  queue: 'hpc-short',
  script: 'python fit.py',
  limitMinutes: 20,
  ...over,
})

const config = (steps: unknown[]) => JSON.stringify({ configVersion: 2, steps })

async function saveVersion(steps: unknown[]) {
  await migrator.query(
    `update api.pipeline_definition_versions set configuration = $2::jsonb where id = $1`,
    [VERSION, config(steps)],
  )
}

describe('the two step kinds', () => {
  it('lists both in the registry', async () => {
    const { rows } = await migrator.query(
      `select kind, runs from internal.pipeline_step_kinds
        where kind in ('lakehouse','remote_job') order by kind`,
    )

    expect(rows).toEqual([
      { kind: 'lakehouse', runs: 'sql' },
      { kind: 'remote_job', runs: 'remote_job' },
    ])
  })

  it('saves a good remote job and a good lakehouse step', async () => {
    await saveVersion([
      { name: 'fit', kind: 'remote_job', remoteJob: job() },
      {
        name: 'fit_named',
        kind: 'remote_job',
        remoteJob: job({ secret: 'HPC_SUBMIT_KEY' }),
      },
      {
        name: 'recent',
        kind: 'lakehouse',
        statement: 'select 1',
        lake: { tables: ['batches', 'plates'] },
      },
    ])
  })

  it.each([
    ['no script', { script: '  ' }, /script/],
    ['a bad queue', { queue: 'Not A Queue' }, /queue/],
    ['a bad connection', { connection: '' }, /connection/],
    ['a fractional limit', { limitMinutes: 1.5 }, /minutes/],
    ['a limit past a week', { limitMinutes: 10081 }, /minutes/],
    ['a secret with spaces', { secret: 'my key' }, /secret/],
  ])('refuses a remote job with %s', async (_name, over, message) => {
    await expect(
      saveVersion([{ name: 'fit', kind: 'remote_job', remoteJob: job(over) }]),
    ).rejects.toThrow(message)
  })

  it.each([
    ['no tables', [], /1 to 10/],
    ['a repeated table', ['a', 'a'], /once/],
    ['a bad table name', ['Bad-Name'], /lowercase/],
    ['eleven tables', Array.from({ length: 11 }, (_, i) => `t${i}`), /1 to 10/],
  ])('refuses a lakehouse step with %s', async (_name, tables, message) => {
    await expect(
      saveVersion([
        {
          name: 'q',
          kind: 'lakehouse',
          statement: 'select 1',
          lake: { tables },
        },
      ]),
    ).rejects.toThrow(message)
  })
})

describe('the lakehouse switch', () => {
  it('is off until a steward turns it on', async () => {
    const owner = await actor(OWNER, WS)

    expect(
      (
        await owner.query('select api.pipeline_lakehouse_settings($1) as s', [
          WS,
        ])
      ).rows[0].s,
    ).toMatchObject({ enabled: false, lakeEnabled: false })

    const after = await owner.query(
      'select api.set_pipeline_lakehouse_sql($1, true) as s',
      [WS],
    )

    expect(after.rows[0].s).toMatchObject({ enabled: true })

    const event = await migrator.query(
      `select payload from api.change_events
        where workspace_id = $1 and entity_type = 'lake_table'
          and payload->>'action' = 'pipeline-lakehouse-sql'`,
      [WS],
    )

    expect(event.rows).toHaveLength(1)
    expect(event.rows[0].payload.enabled).toBe(true)
  })

  it('stays with people who have data access', async () => {
    const scientist = await actor(SCIENTIST, WS)

    await expectDenied(
      scientist.query('select api.set_pipeline_lakehouse_sql($1, false)', [WS]),
      '42501',
    )
  })

  it('is not readable from another workspace', async () => {
    const outsider = await actor(OUTSIDER, OTHER_WS)

    await expectDenied(
      outsider.query('select api.pipeline_lakehouse_settings($1)', [WS]),
      'SB033',
    )
  })

  it('refuses to hand over a table while it is off', async () => {
    const owner = await actor(OWNER, WS)
    await owner.query('select api.set_pipeline_lakehouse_sql($1, false)', [WS])

    // The runner calls it as the app, on the connection of the run's person.
    await setActorJwt(migrator, OWNER, WS)

    await expect(
      migrator.query('select internal.pipeline_lake_table($1, $2)', [
        WS,
        'batches',
      ]),
    ).rejects.toThrow(/open tables are off|lakehouse SQL is off/)
  })
})

// ---------------------------------------------------------------------------
// A job from the run's side, through the callback and the sweep.
// ---------------------------------------------------------------------------

const CONNECTION: HpcConnection = {
  key: 'campus-hpc',
  scheduler: 'slurm',
  baseUrl: 'https://slurm.example.org',
  apiVersion: 'v0.0.40',
  user: 'sheetbase',
  queues: [{ name: 'hpc-short', maxMinutes: 60 }, { name: 'gpu' }],
  token: 'sealed',
}

function fakeScheduler() {
  const submitted: SubmitJob[] = []
  const cancelled: string[] = []
  const states = new Map<string, 'queued' | 'running' | 'finished' | 'failed'>()

  const client: SchedulerClient = {
    async submit(j) {
      submitted.push(j)
      const id = `slurm-${submitted.length}`
      states.set(id, 'queued')

      return { jobId: id }
    },
    async status(id) {
      return { state: states.get(id) ?? 'failed' }
    },
    async cancel(id) {
      cancelled.push(id)
    },
  }

  return { client, submitted, cancelled, states }
}

let clock = new Date('2026-11-12T10:00:00Z')

const secretsAsked: string[] = []

const depsFor = (client: SchedulerClient): RemoteJobDeps => ({
  loadConnection: async (_conn, _workspace, _key, secret) => {
    secretsAsked.push(secret)

    return { kind: 'ready', connection: CONNECTION }
  },
  client: () => client,
  publicUrl: () => 'https://eln.example.org',
  now: () => clock,
})

const callbackDeps = (conn: Client): JobCallbackDeps => ({
  withTransaction: async (fn) => fn(conn),
  now: () => clock,
})

const step = (over: JobOverrides = {}): PipelineRemoteJobStep => ({
  name: 'fit',
  kind: 'remote_job',
  remoteJob: job(over),
})

const post = (
  token: string,
  body:
    { rows: Array<Record<string, string | number>> } | Record<string, never>,
) =>
  new Request('https://eln.example.org/x', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })

describe('a remote job step', () => {
  it('sends the job once, waits, and takes the table the job gives back', async () => {
    const { client, submitted } = fakeScheduler()
    const deps = depsFor(client)
    await migrator.query(`select set_config('request.jwt.claims',$1,false)`, [
      JSON.stringify({ role: 'authenticated', sub: OWNER, workspace_id: WS }),
    ])

    const first = await runRemoteJobStep({
      conn: migrator,
      run: { id: RUN, workspace_id: WS },
      step: step(),
      previous: [{ batch: 'B1', titre: 4.2 }],
      deps,
    })

    expect(first.kind).toBe('waiting')
    expect(submitted).toHaveLength(1)
    // The step names no secret, so the default is the one asked for and kept with the job.
    expect(secretsAsked.at(-1)).toBe('HPC_SUBMIT_KEY')
    expect(
      (
        await migrator.query(
          `select secret_name from api.pipeline_remote_jobs where run_id = $1`,
          [RUN],
        )
      ).rows[0].secret_name,
    ).toBe('HPC_SUBMIT_KEY')
    expect(submitted[0].queue).toBe('hpc-short')
    expect(submitted[0].limitMinutes).toBe(20)
    const env = submitted[0].environment
    expect(env.SHEETBASE_INPUT_URL).toMatch(
      /^https:\/\/eln\.example\.org\/api\/remote-jobs\/.+\/input$/,
    )

    // A second pass finds the job and does not send it again.
    const again = await runRemoteJobStep({
      conn: migrator,
      run: { id: RUN, workspace_id: WS },
      step: step(),
      previous: [],
      deps,
    })

    expect(again.kind).toBe('waiting')
    expect(submitted).toHaveLength(1)

    const id = first.kind === 'waiting' ? first.job.id : ''
    const token = env.SHEETBASE_JOB_TOKEN

    // The job reads the step before it, with its key and no one else's.
    const wrong = await handleRemoteJobInput(
      post('not-the-key', {}),
      id,
      callbackDeps(migrator),
    )

    expect(wrong.status).toBe(401)

    const input = await handleRemoteJobInput(
      post(token, {}),
      id,
      callbackDeps(migrator),
    )

    expect(input.status).toBe(200)
    expect((await input.json()).rows).toEqual([{ batch: 'B1', titre: 4.2 }])

    const result = await handleRemoteJobResult(
      post(token, { rows: [{ batch: 'B1', slope: 0.31 }] }),
      id,
      callbackDeps(migrator),
    )

    expect(result.status).toBe(200)

    const done = await runRemoteJobStep({
      conn: migrator,
      run: { id: RUN, workspace_id: WS },
      step: step(),
      previous: [],
      deps,
    })

    expect(done).toEqual({ kind: 'rows', rows: [{ batch: 'B1', slope: 0.31 }] })

    // The key stops working once the job is done.
    const late = await handleRemoteJobResult(
      post(token, { rows: [] }),
      id,
      callbackDeps(migrator),
    )

    expect(late.status).toBe(409)

    const events = await migrator.query(
      `select operation, payload->>'state' as state from api.change_events
        where entity_type = 'pipeline_remote_job' and entity_uuid = $1 order by created_at`,
      [id],
    )

    expect(events.rows.map((r) => r.state)).toContain('succeeded')
  })

  it('refuses a queue the connection does not offer and a limit the queue does not take', async () => {
    const { client, submitted } = fakeScheduler()

    const unknown = await runRemoteJobStep({
      conn: migrator,
      run: { id: RUN, workspace_id: WS },
      step: { ...step({ queue: 'nowhere' }), name: 'lost' },
      previous: [],
      deps: depsFor(client),
    })

    expect(unknown).toMatchObject({
      kind: 'error',
      message: expect.stringContaining('no queue called nowhere'),
    })

    const long = await runRemoteJobStep({
      conn: migrator,
      run: { id: RUN, workspace_id: WS },
      step: { ...step({ limitMinutes: 90 }), name: 'toolong' },
      previous: [],
      deps: depsFor(client),
    })

    expect(long).toMatchObject({
      kind: 'error',
      message: expect.stringContaining('up to 60 minutes'),
    })
    expect(submitted).toHaveLength(0)
  })

  it('stops a job that runs out of time and says so', async () => {
    const { client, submitted, cancelled } = fakeScheduler()
    const deps = depsFor(client)
    const named = { ...step({ queue: 'gpu', limitMinutes: 5 }), name: 'slow' }

    const sent = await runRemoteJobStep({
      conn: migrator,
      run: { id: RUN, workspace_id: WS },
      step: named,
      previous: [],
      deps,
    })

    expect(sent.kind).toBe('waiting')
    expect(submitted).toHaveLength(1)

    // The run waits for its job; one that is not waiting is cancelled instead.
    await migrator.query(
      `update api.pipeline_runs set status = 'waiting' where id = $1`,
      [RUN],
    )
    clock = new Date(clock.getTime() + 30 * 60_000)

    const report = await sweepRemoteJobs(
      callbackDeps(migrator).withTransaction,
      deps,
    )

    expect(report.stopped).toBeGreaterThanOrEqual(1)
    expect(cancelled).toContain('slurm-1')

    const failed = await runRemoteJobStep({
      conn: migrator,
      run: { id: RUN, workspace_id: WS },
      step: named,
      previous: [],
      deps,
    })

    expect(failed).toMatchObject({
      kind: 'error',
      message: expect.stringContaining('ran out of time after 5 minutes'),
    })
  })

  it('lets a person read the jobs of their workspace and no one else', async () => {
    const scientist = await actor(SCIENTIST, WS)
    const outsider = await actor(OUTSIDER, OTHER_WS)

    const mine = await scientist.query(
      'select step_name from api.pipeline_remote_jobs',
    )

    const theirs = await outsider.query(
      'select step_name from api.pipeline_remote_jobs',
    )

    expect(mine.rows.length).toBeGreaterThan(0)
    expect(theirs.rows).toHaveLength(0)

    await expectDenied(
      scientist.query(
        `insert into api.pipeline_remote_jobs(workspace_id,run_id,step_name,connection_key,queue,limit_minutes,deadline_at)
         values($1,$2,'forged','campus-hpc','hpc-short',5,now())`,
        [WS, RUN],
      ),
      '42501',
    )
    await expectDenied(
      scientist.query('select * from internal.pipeline_remote_job_data'),
      '42501',
    )
  })
})
