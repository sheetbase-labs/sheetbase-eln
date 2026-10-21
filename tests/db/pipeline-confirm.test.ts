/**
 * PIPE-02.2 — a `confirm` step pauses a run for a person.
 *
 * Proves against a real PostgreSQL surface that:
 *  - a confirm step commits the work so far, records a prompt and stops the
 *    run in `waiting` (never succeeded/failed);
 *  - answering resumes from the step with the pinned input versions, so live
 *    data changed while waiting cannot leak into the resumed run;
 *  - the author's skip and stop paths behave as configured;
 *  - the expiry job applies the configured no-answer outcome (stop and re-ask,
 *    apply the proposal attributed to the pipeline, or fail) and deletes the
 *    temporary prompt.
 */
import type { Client } from 'pg'
import { Client as PgClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  expirePipelinePrompts,
  failStuckPipelineRun,
  resumePipelineRun,
  runPipelineExecution,
} from '#/lib/pipeline-execute.server'
import { runPipelineJobs } from '#/lib/pipeline-queue.server'
import { handlePipelineExecute } from '#/lib/pipeline-run-requests.server'
import type {
  PipelineExecuteDeps,
  PipelineExecuteReport,
} from '#/lib/pipeline-execute.server'
import {
  connectTestSandbox,
  prepareTestDatabase,
  setActorJwt,
  testDatabaseName,
} from './helpers'

const WS = '0e020000-0000-4000-8000-000000000201'
const OWNER = 'pipeline-confirm-owner'
const MEMBER = 'pipeline-confirm-member'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

let schemaVersionId = ''
let inputDatasetId = ''
let inputDatasetVersionId = ''
let definitionId = ''
let reaskVersionId = ''
let applyVersionId = ''
let failVersionId = ''

function superuserTestUrl(): string {
  const url = new URL(process.env.DATABASE_URL!)
  url.pathname = `/${testDatabaseName()}`
  return url.toString()
}

async function actor(userId: string, workspaceId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await setActorJwt(client, userId, workspaceId)
  return client
}

const RPC_ARG_TYPES: Record<string, string[]> = {
  create_pipeline_definition: ['uuid', 'text', 'text', 'text'],
  create_pipeline_definition_version: ['uuid', 'uuid', 'jsonb'],
  publish_pipeline_definition_version: ['uuid', 'uuid'],
  start_pipeline_run: [
    'uuid',
    'uuid',
    'text',
    'jsonb',
    'jsonb',
    'uuid',
    'text',
    'uuid',
  ],
  create_dataset_schema_definition: ['uuid', 'text', 'text', 'text', 'jsonb'],
  publish_dataset_schema_version: ['uuid'],
  commit_dataset_row_batch: ['uuid', 'bigint', 'jsonb', 'text'],
  snapshot_dataset: ['uuid', 'bigint', 'text'],
}

async function rpc<T>(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const types = RPC_ARG_TYPES[name]
  if (!types) throw new Error(`no argument types registered for ${name}`)
  const raw = Object.values(args)
  const values = raw.map((value, index) =>
    value !== null && types[index] === 'jsonb' ? JSON.stringify(value) : value,
  )
  while (values.length < types.length) values.push(null)
  const placeholders = types
    .map((type, index) => `$${index + 1}::${type}`)
    .join(',')
  const { rows } = await client.query(
    `select * from api.${name}(${placeholders})`,
    values,
  )
  const row = rows[0]
  if (!row) return undefined as T
  const keys = Object.keys(row)
  if (keys.length === 1) {
    const value = row[keys[0]]
    if (value && typeof value === 'object' && !Array.isArray(value))
      return value as T
  }
  return row as T
}

function execConnection(conn: Client): PipelineExecuteDeps['connect'] {
  return async () => ({
    query: async (text, values = []) => conn.query(text, values),
    begin: () => conn.query('BEGIN').then(() => undefined),
    commit: () => conn.query('COMMIT').then(() => undefined),
    rollback: () => conn.query('ROLLBACK').then(() => undefined),
    end: () => Promise.resolve(),
  })
}

async function makeExecDeps(actorId: string): Promise<{
  deps: PipelineExecuteDeps
  close: () => Promise<void>
}> {
  const conn = new PgClient({ connectionString: superuserTestUrl() })
  await conn.connect()
  return {
    deps: {
      getSession: async () => ({ user: { id: actorId } }),
      connect: execConnection(conn),
    },
    close: async () => conn.end(),
  }
}

function confirmConfig(
  noAnswer: 'reask' | 'apply' | 'fail',
): Record<string, unknown> {
  return {
    configVersion: 1,
    description: 'confirm units before scaling',
    parameters: [{ name: 'factor', type: 'decimal', required: true }],
    inputs: [{ name: 'measurements', required: true }],
    transform: {
      language: 'sql',
      statement:
        'SELECT batch, value, value * {{factor}} AS scaled FROM measurements',
    },
    steps: [
      {
        name: 'confirm_units',
        language: 'sql',
        statement:
          'SELECT batch, count(*) AS rows, min(value) AS values_seen FROM measurements GROUP BY batch ORDER BY batch',
        confirm: {
          fields: [
            { key: 'unit', label: 'Unit', type: 'text', required: true },
          ],
          askedUserIds: [OWNER],
          skipSteps: ['set_units'],
          noAnswer,
          expiresHours: 24,
        },
      },
      {
        name: 'set_units',
        language: 'sql',
        statement:
          "SELECT batch, value, value * {{factor}} + CASE WHEN (SELECT answer->>'unit' FROM confirm_answer) IS NULL THEN 0 ELSE 1 END AS scaled FROM measurements",
      },
    ],
    output: {
      mode: 'create',
      schemaVersionId,
      datasetName: 'Confirmed measurements',
      datasetLabel: 'confirmed output',
      fieldMapping: null,
    },
  }
}

async function createPublishedSchema(owner: Client): Promise<string> {
  const definition = await rpc<{
    schema_definition_id: string
    schema_version_id: string
  }>(owner, 'create_dataset_schema_definition', {
    p_workspace_id: WS,
    p_key: 'confirm_measurement',
    p_name: 'Confirm measurement',
    p_description: null,
    p_fields: [
      { key: 'batch', label: 'Batch', logicalType: 'text', nullable: false },
      { key: 'value', label: 'Value', logicalType: 'decimal', nullable: false },
      {
        key: 'scaled',
        label: 'Scaled',
        logicalType: 'decimal',
        nullable: true,
      },
    ],
  })
  await rpc(owner, 'publish_dataset_schema_version', {
    p_schema_version_id: definition.schema_version_id,
  })
  return definition.schema_version_id
}

async function commitRows(
  owner: Client,
  rows: Array<{ rowId: string; batch: string; value: number }>,
  expectedRevision: number,
  idempotencyKey: string,
): Promise<void> {
  const fields = await migrator.query<{ id: string; key: string }>(
    `select field_id as id, key from api.dataset_schema_version_fields
      where schema_version_id = $1 and lifecycle = 'active'`,
    [schemaVersionId],
  )
  const fieldId = Object.fromEntries(fields.rows.map((f) => [f.key, f.id]))
  const committed = await rpc<Record<string, unknown>>(
    owner,
    'commit_dataset_row_batch',
    {
      p_dataset_id: inputDatasetId,
      p_expected_dataset_revision: expectedRevision,
      p_rows: rows.map((row) => ({
        operation: 'create',
        rowId: row.rowId,
        values: { [fieldId.batch]: row.batch, [fieldId.value]: row.value },
      })),
      p_idempotency_key: idempotencyKey,
    },
  )
  if (committed.ok !== true)
    throw new Error(`commit failed: ${JSON.stringify(committed)}`)
}

async function datasetRevision(): Promise<number> {
  const { rows } = await migrator.query<{ revision: string }>(
    `select revision from api.datasets where id = $1`,
    [inputDatasetId],
  )
  return Number(rows[0].revision)
}

async function publishVersion(
  owner: Client,
  key: string,
  config: Record<string, unknown>,
): Promise<string> {
  const version = await rpc<{ id: string }>(
    owner,
    'create_pipeline_definition_version',
    {
      p_workspace_id: WS,
      p_definition_id: definitionId,
      p_configuration: config,
    },
  )
  await rpc(owner, 'publish_pipeline_definition_version', {
    p_workspace_id: WS,
    p_version_id: version.id,
  })
  return version.id
}

let ownerClient: Client | null = null
async function ownerActor(): Promise<Client> {
  if (!ownerClient) ownerClient = await actor(OWNER, WS)
  return ownerClient
}

async function startRun(versionId: string, factor: number): Promise<string> {
  const run = await rpc<{ id: string; status: string }>(
    await ownerActor(),
    'start_pipeline_run',
    {
      p_workspace_id: WS,
      p_definition_version_id: versionId,
      p_trigger_kind: 'manual',
      p_parameters: { factor },
      p_input_versions: { measurements: inputDatasetVersionId },
    },
  )
  expect(run.status).toBe('running')
  return run.id
}

async function runToWaiting(
  versionId: string,
  factor: number,
): Promise<string> {
  const runId = await startRun(versionId, factor)
  const { deps, close } = await makeExecDeps(OWNER)
  const report = await runPipelineExecution(OWNER, runId, deps)
  await close()
  expect(report.ok).toBe(true)
  expect(report.run?.status).toBe('waiting')
  return runId
}

async function answer(
  runId: string,
  value: unknown,
): Promise<PipelineExecuteReport> {
  const { deps, close } = await makeExecDeps(OWNER)
  const report = await resumePipelineRun(OWNER, runId, value, deps)
  await close()
  return report
}

async function outputScaled(outputDatasetVersionId: string): Promise<number[]> {
  const { rows } = await migrator.query<{ numeric_value: string }>(
    `select v.numeric_value
       from api.dataset_version_values v
       join api.dataset_schema_version_fields f on f.field_id = v.field_id
      where v.dataset_version_id = $1 and f.key = 'scaled'
      order by v.row_id`,
    [outputDatasetVersionId],
  )
  return rows.map((r) => Number(r.numeric_value)).sort((a, b) => a - b)
}

beforeAll(async () => {
  const prepared = await prepareTestDatabase()
  migrator = prepared.migrator
  asRole = prepared.asRole

  await migrator.query(
    `insert into api.workspaces(id, slug, name) values($1, 'pipeline-confirm', 'Pipeline confirm')`,
    [WS],
  )
  await migrator.query(
    `insert into internal."user"(id, name, email) values
       ($1, 'Confirm Owner', 'confirm-owner@pipeline.test'),
       ($2, 'Confirm Member', 'confirm-member@pipeline.test')`,
    [OWNER, MEMBER],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id, user_id, role) values
       ($1, $2, 'owner'),
       ($1, $3, 'member')`,
    [WS, OWNER, MEMBER],
  )

  const owner = await ownerActor()
  schemaVersionId = await createPublishedSchema(owner)

  const created = await owner.query<{ id: string; revision: number }>(
    `insert into api.datasets(workspace_id, schema_version_id, name, created_by_user_id)
     values ($1, $2, $3, $4) returning id, revision`,
    [WS, schemaVersionId, 'Raw confirm measurements', OWNER],
  )
  inputDatasetId = created.rows[0].id
  await commitRows(
    owner,
    [
      { rowId: '11111111-1111-4111-8111-111111111111', batch: 'A', value: 2 },
      { rowId: '22222222-2222-4222-8222-222222222222', batch: 'A', value: 4 },
      { rowId: '33333333-3333-4333-8333-333333333333', batch: 'B', value: 8 },
    ],
    1,
    'confirm-rows-1',
  )
  const snapshot = await rpc<{ id: string }>(owner, 'snapshot_dataset', {
    p_dataset_id: inputDatasetId,
    p_expected_dataset_revision: await datasetRevision(),
    p_label: 'raw input',
  })
  inputDatasetVersionId = snapshot.id

  const definition = await rpc<{ id: string }>(
    owner,
    'create_pipeline_definition',
    {
      p_workspace_id: WS,
      p_key: 'confirm_units',
      p_name: 'Confirm units',
    },
  )
  definitionId = definition.id
  reaskVersionId = await publishVersion(owner, 'reask', confirmConfig('reask'))
  applyVersionId = await publishVersion(owner, 'apply', confirmConfig('apply'))
  failVersionId = await publishVersion(owner, 'fail', confirmConfig('fail'))
})

afterAll(async () => {
  for (const client of clients) await client.end().catch(() => {})
  await migrator?.end()
})

describe('PIPE-02.2 confirm steps', () => {
  it('stops the run in waiting with a prompt and bounded committed work', async () => {
    const runId = await runToWaiting(reaskVersionId, 10)

    const run = await migrator.query<{
      status: string
      result: { pending: Record<string, unknown> }
    }>(`select status, result from api.pipeline_runs where id = $1`, [runId])
    expect(run.rows[0].status).toBe('waiting')
    expect(run.rows[0].result.pending).toMatchObject({
      step: 'confirm_units',
      previousRows: 3,
    })

    const prompts = await migrator.query<{
      step_id: string
      asked_user_ids: string[]
      answer: unknown
      expires_at: string
      form_schema: { fields: unknown[]; proposal: { rows: unknown[] } }
    }>(`select * from api.pipeline_run_prompts where run_id = $1`, [runId])
    expect(prompts.rows).toHaveLength(1)
    expect(prompts.rows[0].step_id).toBe('confirm_units')
    expect(prompts.rows[0].asked_user_ids).toEqual([OWNER])
    expect(prompts.rows[0].answer).toBeNull()
    expect(prompts.rows[0].expires_at).not.toBeNull()
    // The proposal (work so far) is committed for the person to decide on.
    expect(prompts.rows[0].form_schema.proposal.rows).toHaveLength(2)
  })

  it('resumes from the step with the pinned inputs, not changed live data', async () => {
    const runId = await runToWaiting(reaskVersionId, 11)

    // Live data changes while the run waits: two extra rows are committed to
    // the dataset, but the run pinned the earlier Snapshot.
    const owner = await ownerActor()
    await commitRows(
      owner,
      [
        {
          rowId: '44444444-4444-4444-8444-444444444444',
          batch: 'C',
          value: 16,
        },
        {
          rowId: '55555555-5555-4555-8555-555555555555',
          batch: 'C',
          value: 32,
        },
      ],
      await datasetRevision(),
      'confirm-rows-2',
    )
    const liveCount = await migrator.query<{ count: string }>(
      `select count(*) from api.dataset_version_rows where dataset_version_id = $1`,
      [inputDatasetVersionId],
    )
    expect(Number(liveCount.rows[0].count)).toBe(3)

    const report = await answer(runId, {
      decision: 'confirm',
      values: { unit: 'g/L' },
      reason: 'confirmed against AMB-25-112',
    })
    expect(report.ok).toBe(true)
    expect(report.run?.status).toBe('succeeded')
    // Three pinned rows, and the recorded answer reached the dependent step.
    expect(report.run?.result).toMatchObject({ rowCount: 3 })
    expect(
      await outputScaled(String(report.run?.result.outputDatasetVersionId)),
    ).toEqual([23, 45, 89])

    const prompt = await migrator.query<{
      answer: { decision: string; values: { unit: string } }
      answered_by_user_id: string
      answered_at: string
    }>(`select * from api.pipeline_run_prompts where run_id = $1`, [runId])
    expect(prompt.rows[0].answer).toMatchObject({
      decision: 'confirm',
      values: { unit: 'g/L' },
    })
    expect(prompt.rows[0].answered_by_user_id).toBe(OWNER)
    expect(prompt.rows[0].answered_at).not.toBeNull()
  })

  it('queues a decision over HTTP and resumes it on a worker', async () => {
    const runId = await runToWaiting(reaskVersionId, 21)
    const conn = new PgClient({ connectionString: superuserTestUrl() })
    await conn.connect()
    const post = (user: string, body: unknown) =>
      handlePipelineExecute(
        new Request('http://localhost/api/pipelines/execute', {
          method: 'POST',
          body: JSON.stringify(body),
        }),
        {
          getSession: async () => ({ user: { id: user } }),
          connect: async () => ({
            ...(await execConnection(conn)()),
            end: async () => {},
          }),
          wake: () => {},
        },
      )
    // A decision that cannot apply is refused before anything is queued.
    expect(
      (await post(MEMBER, { runId, answer: { decision: 'confirm' } })).status,
    ).toBe(409)
    expect(
      (await post(OWNER, { runId, answer: { decision: 'maybe' } })).status,
    ).toBe(400)
    const queued = await post(OWNER, {
      runId,
      answer: { decision: 'confirm', values: { unit: 'g/L' } },
    })
    expect(queued.status).toBe(202)
    // The request only queued the resumption: the run is still waiting.
    expect((await queued.json()).status).toBe('waiting')
    // A second decision cannot queue another while one is pending.
    expect(
      (
        await post(OWNER, {
          runId,
          answer: { decision: 'confirm', values: { unit: 'g/L' } },
        })
      ).status,
    ).toBe(409)

    const processed = await runPipelineJobs({
      workerId: 'confirm-worker',
      busyDelaySeconds: 0,
      connect: async () => {
        const queue = new PgClient({ connectionString: superuserTestUrl() })
        await queue.connect()
        return {
          query: (text, values) => queue.query(text, values),
          end: () => queue.end(),
        }
      },
      execute: async (actorId, id) => {
        const { deps, close } = await makeExecDeps(actorId)
        try {
          return await runPipelineExecution(actorId, id, {
            ...deps,
            sandbox: connectTestSandbox,
          })
        } finally {
          await close()
        }
      },
      resume: async (actorId, id, value) => {
        const { deps, close } = await makeExecDeps(actorId)
        try {
          return await resumePipelineRun(actorId, id, value, {
            ...deps,
            sandbox: connectTestSandbox,
          })
        } finally {
          await close()
        }
      },
      failRun: async (id, code, message) => {
        const { deps, close } = await makeExecDeps('system')
        try {
          await failStuckPipelineRun(deps, id, code, message)
        } finally {
          await close()
        }
      },
    })
    expect(processed).toBeGreaterThanOrEqual(1)
    const { rows } = await migrator.query(
      'select status, result from api.pipeline_runs where id = $1',
      [runId],
    )
    expect(rows[0].status).toBe('succeeded')
    const job = await migrator.query(
      `select kind, state from internal.pipeline_run_jobs where run_id = $1 and kind = 'resume'`,
      [runId],
    )
    expect(job.rows).toEqual([{ kind: 'resume', state: 'done' }])
    await conn.end()
  })

  it('skips the configured dependent steps on a Skip decision', async () => {
    const runId = await runToWaiting(reaskVersionId, 12)
    const report = await answer(runId, { decision: 'skip' })
    expect(report.ok).toBe(true)
    expect(report.run?.status).toBe('succeeded')
    expect(report.run?.result).toMatchObject({ rowCount: 3 })
    // set_units never ran: scaled is unshifted by the answer.
    expect(
      await outputScaled(String(report.run?.result.outputDatasetVersionId)),
    ).toEqual([24, 48, 96])

    const logs = await migrator.query<{ stage: string; message: string }>(
      `select stage, message from api.pipeline_run_logs
        where run_id = $1 and stage = 'skip'`,
      [runId],
    )
    expect(logs.rows).toHaveLength(1)
    expect(logs.rows[0].message).toContain('set_units')
  })

  it('stops the run on a Stop decision without writing output', async () => {
    const runId = await runToWaiting(reaskVersionId, 13)
    const report = await answer(runId, { decision: 'stop' })
    expect(report.ok).toBe(true)
    expect(report.run?.status).toBe('cancelled')

    const outputs = await migrator.query(
      `select 1 from api.pipeline_run_outputs where run_id = $1`,
      [runId],
    )
    expect(outputs.rows).toHaveLength(0)
  })

  it('refuses an answer from someone who was not asked', async () => {
    const runId = await runToWaiting(reaskVersionId, 14)
    const { deps, close } = await makeExecDeps(MEMBER)
    const report = await resumePipelineRun(
      MEMBER,
      runId,
      { decision: 'confirm', values: { unit: 'g/L' } },
      deps,
    )
    await close()
    expect(report.ok).toBe(false)
    expect(report.errorCode).toBe('confirm_not_asked')
  })

  it('re-asks on expiry: the run stops and the temporary prompt is deleted', async () => {
    const runId = await runToWaiting(reaskVersionId, 15)
    await migrator.query(
      `update api.pipeline_run_prompts set expires_at = now() - interval '1 hour' where run_id = $1`,
      [runId],
    )
    const { deps, close } = await makeExecDeps(OWNER)
    const report = await expirePipelinePrompts(deps, new Date())
    await close()
    expect(report.reasked).toBe(1)

    const run = await migrator.query<{
      status: string
      error_code: string
    }>(`select status, error_code from api.pipeline_runs where id = $1`, [
      runId,
    ])
    expect(run.rows[0].status).toBe('cancelled')
    expect(run.rows[0].error_code).toBe('waiting_expired')
    const prompts = await migrator.query(
      `select 1 from api.pipeline_run_prompts where run_id = $1`,
      [runId],
    )
    expect(prompts.rows).toHaveLength(0)
  })

  it('applies the proposal on expiry, attributed to the pipeline', async () => {
    const runId = await runToWaiting(applyVersionId, 16)
    await migrator.query(
      `update api.pipeline_run_prompts set expires_at = now() - interval '1 hour' where run_id = $1`,
      [runId],
    )
    const { deps, close } = await makeExecDeps(OWNER)
    const report = await expirePipelinePrompts(deps, new Date())
    await close()
    expect(report.applied).toBe(1)

    const run = await migrator.query<{
      status: string
      result: { rowCount: number; outputDatasetVersionId: string }
    }>(`select status, result from api.pipeline_runs where id = $1`, [runId])
    expect(run.rows[0].status).toBe('succeeded')
    expect(run.rows[0].result.rowCount).toBe(3)
    const prompts = await migrator.query(
      `select 1 from api.pipeline_run_prompts where run_id = $1`,
      [runId],
    )
    expect(prompts.rows).toHaveLength(0)
    const logs = await migrator.query<{ message: string }>(
      `select message from api.pipeline_run_logs where run_id = $1 and stage = 'waiting'`,
      [runId],
    )
    expect(
      logs.rows.some((row) =>
        row.message.includes('attributed to the pipeline'),
      ),
    ).toBe(true)
  })

  it('fails the run on expiry when the author configured fail', async () => {
    const runId = await runToWaiting(failVersionId, 17)
    await migrator.query(
      `update api.pipeline_run_prompts set expires_at = now() - interval '1 hour' where run_id = $1`,
      [runId],
    )
    const { deps, close } = await makeExecDeps(OWNER)
    const report = await expirePipelinePrompts(deps, new Date())
    await close()
    expect(report.failed).toBe(1)

    const run = await migrator.query<{
      status: string
      error_code: string
    }>(`select status, error_code from api.pipeline_runs where id = $1`, [
      runId,
    ])
    expect(run.rows[0].status).toBe('failed')
    expect(run.rows[0].error_code).toBe('confirm_expired')
  })
})
