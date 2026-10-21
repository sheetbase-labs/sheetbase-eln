/**
 * AUTO-01/02/03 database proof.
 *
 * Proves the deterministic, versioned Pipeline model against a real
 * PostgreSQL surface:
 *
 *  - Definitions/Versions are steward-gated, workspace-scoped and immutable
 *    once published; runs pin the exact published version;
 *  - start/execute/complete/fail/cancel through the governed RPCs, with
 *    digest idempotency, attempt lineage and bounded error codes;
 *  - the server executor materializes input Dataset Versions, runs the
 *    transform in the zero-grant pipeline_worker role and lands outputs only
 *    through commit_dataset_row_batch / snapshot_dataset;
 *  - schedule/event triggers fire runs from the platform sweep;
 *  - permissions fail closed for viewer/member authoring.
 */
import { createHash } from 'node:crypto'
import { handlePipelineWebhook } from '#/lib/pipeline-webhook.server'
import type { Client } from 'pg'
import { Client as PgClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  releaseSettledRunArtefacts,
  runPipelineExecution,
} from '#/lib/pipeline-execute.server'
import type { PipelineExecuteDeps } from '#/lib/pipeline-execute.server'
import { sweepPipelines } from '#/lib/pipeline-scheduler.server'
import type {
  PipelineSchedulerDeps,
  SchedulerConnection,
} from '#/lib/pipeline-scheduler.server'
import {
  connectTestSandbox,
  prepareTestDatabase,
  setActorJwt,
  TEST_DATABASE,
  testDatabaseName,
} from './helpers'

const WS = '0e010000-0000-4000-8000-000000000101'
const OWNER = 'pipeline-owner-a'
const MEMBER = 'pipeline-member-a'
const VIEWER = 'pipeline-viewer-a'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

let schemaVersionId = ''
let inputDatasetId = ''
let inputDatasetVersionId = ''
let pipelineDefinitionId = ''
let pipelineVersionId = ''

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

// Positional argument types for the RPCs used by this suite. Explicit casts
// let PostgreSQL resolve signatures with defaulted parameters correctly when
// the caller omits trailing defaults.
const RPC_ARG_TYPES: Record<string, string[]> = {
  create_pipeline_definition: ['uuid', 'text', 'text', 'text'],
  update_pipeline_definition: ['uuid', 'uuid', 'text', 'text', 'text'],
  create_pipeline_definition_version: ['uuid', 'uuid', 'jsonb'],
  update_pipeline_definition_version_draft: ['uuid', 'uuid', 'bigint', 'jsonb'],
  publish_pipeline_definition_version: ['uuid', 'uuid'],
  retire_pipeline_definition_version: ['uuid', 'uuid'],
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
  complete_pipeline_run: ['uuid', 'uuid', 'jsonb'],
  fail_pipeline_run: ['uuid', 'uuid', 'text', 'text'],
  append_pipeline_run_log: ['uuid', 'uuid', 'text', 'text', 'text', 'jsonb'],
  cancel_pipeline_run: ['uuid', 'uuid'],
  create_pipeline_schedule: ['uuid', 'uuid', 'text', 'jsonb', 'boolean'],
  update_pipeline_schedule: ['uuid', 'uuid', 'text', 'jsonb', 'boolean'],
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
  // Trailing defaults are omitted from the call; keep placeholder numbering
  // consecutive so the pg driver can bind every $n.
  while (values.length < types.length) {
    values.push(null)
  }
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
  // Functions returning a scalar jsonb (e.g. the schema RPCs) come back as a
  // single column whose value is the payload; unwrap it. Functions returning
  // a composite row (the pipeline RPCs) come back column-per-field.
  if (keys.length === 1) {
    const value = row[keys[0]]
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as T
    }
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
      sandbox: connectTestSandbox,
    },
    close: async () => conn.end(),
  }
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

async function createPublishedSchema(owner: Client): Promise<string> {
  const definition = await rpc<{
    schema_definition_id: string
    schema_version_id: string
  }>(owner, 'create_dataset_schema_definition', {
    p_workspace_id: WS,
    p_key: 'pipeline_measurement',
    p_name: 'Pipeline measurement',
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

async function createInputDatasetVersion(
  owner: Client,
  schemaVersion: string,
  idempotencyKey = 'pipeline-test-input-1',
  rowIds = [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
  ],
): Promise<{ datasetId: string; versionId: string }> {
  const created = await owner.query<{ id: string; revision: number }>(
    `insert into api.datasets(workspace_id, schema_version_id, name, created_by_user_id)
     values ($1, $2, $3, $4) returning id, revision`,
    [WS, schemaVersion, 'Raw measurements', OWNER],
  )
  const dataset = created.rows[0]
  const fields = await migrator.query<{ id: string; key: string }>(
    `select field_id as id, key from api.dataset_schema_version_fields
      where schema_version_id = $1 and lifecycle = 'active'`,
    [schemaVersion],
  )
  const fieldId = Object.fromEntries(fields.rows.map((f) => [f.key, f.id]))
  await rpc(owner, 'commit_dataset_row_batch', {
    p_dataset_id: dataset.id,
    p_expected_dataset_revision: 1,
    p_rows: [
      {
        operation: 'create',
        rowId: rowIds[0],
        values: { [fieldId.batch]: 'A', [fieldId.value]: 2 },
      },
      {
        operation: 'create',
        rowId: rowIds[1],
        values: { [fieldId.batch]: 'A', [fieldId.value]: 4 },
      },
      {
        operation: 'create',
        rowId: rowIds[2],
        values: { [fieldId.batch]: 'B', [fieldId.value]: 8 },
      },
    ],
    p_idempotency_key: idempotencyKey,
  })
  const snapshot = await rpc<{ id: string }>(owner, 'snapshot_dataset', {
    p_dataset_id: dataset.id,
    p_expected_dataset_revision: 2,
    p_label: 'raw input',
  })
  return { datasetId: dataset.id, versionId: snapshot.id }
}

function pipelineConfig(statement: string): Record<string, unknown> {
  return {
    configVersion: 1,
    description: 'scale measurement values',
    parameters: [
      { name: 'factor', type: 'decimal', required: true },
      { name: 'note', type: 'text', required: false, default: 'scaled' },
    ],
    inputs: [{ name: 'measurements', required: true }],
    transform: { language: 'sql', statement },
    output: {
      mode: 'create',
      schemaVersionId,
      datasetName: 'Scaled measurements',
      datasetLabel: 'pipeline output',
      fieldMapping: null,
    },
  }
}

beforeAll(async () => {
  const prepared = await prepareTestDatabase()
  migrator = prepared.migrator
  asRole = prepared.asRole

  // Workspace + memberships.
  await migrator.query(
    `insert into api.workspaces(id, slug, name) values($1, 'pipeline-ws', 'Pipeline WS')`,
    [WS],
  )
  await migrator.query(
    `insert into internal."user"(id, name, email) values
       ($1, 'Owner', 'owner@pipeline.test'),
       ($2, 'Member', 'member@pipeline.test'),
       ($3, 'Viewer', 'viewer@pipeline.test')`,
    [OWNER, MEMBER, VIEWER],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id, user_id, role) values
       ($1, $2, 'owner'),
       ($1, $3, 'member'),
       ($1, $4, 'viewer')`,
    [WS, OWNER, MEMBER, VIEWER],
  )

  const owner = await actor(OWNER, WS)
  schemaVersionId = await createPublishedSchema(owner)
  const input = await createInputDatasetVersion(owner, schemaVersionId)
  inputDatasetId = input.datasetId
  inputDatasetVersionId = input.versionId

  // Pipeline definition + version + publish.
  const definition = await rpc<{ id: string }>(
    owner,
    'create_pipeline_definition',
    { p_workspace_id: WS, p_key: 'scale_values', p_name: 'Scale values' },
  )
  pipelineDefinitionId = definition.id
  const version = await rpc<{ id: string }>(
    owner,
    'create_pipeline_definition_version',
    {
      p_workspace_id: WS,
      p_definition_id: definition.id,
      p_configuration: pipelineConfig(
        'SELECT batch, value, value * {{factor}} AS scaled FROM measurements',
      ),
    },
  )
  pipelineVersionId = version.id
  await rpc(owner, 'publish_pipeline_definition_version', {
    p_workspace_id: WS,
    p_version_id: version.id,
  })
})

afterAll(async () => {
  for (const client of clients) await client.end().catch(() => {})
  await migrator?.end()
})

describe('Pipeline Definition lifecycle', () => {
  it('requires pipelines.manage to create definitions', async () => {
    const member = await actor(MEMBER, WS)
    await expect(
      rpc(member, 'create_pipeline_definition', {
        p_workspace_id: WS,
        p_key: 'denied',
        p_name: 'Denied',
      }),
    ).rejects.toMatchObject({ code: '42501' })
    const viewer = await actor(VIEWER, WS)
    await expect(
      rpc(viewer, 'create_pipeline_definition', {
        p_workspace_id: WS,
        p_key: 'denied2',
        p_name: 'Denied',
      }),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('rejects an invalid configuration at the version boundary', async () => {
    const owner = await actor(OWNER, WS)
    await expect(
      rpc(owner, 'create_pipeline_definition_version', {
        p_workspace_id: WS,
        p_definition_id: pipelineDefinitionId,
        p_configuration: {
          configVersion: 1,
          inputs: [{ name: 'measurements', required: true }],
          transform: { language: 'javascript', statement: 'x' },
          output: {
            mode: 'create',
            schemaVersionId,
            datasetName: 'Bad',
            datasetLabel: 'x',
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'SB070' })
  })

  it('refuses to run an unpublished version', async () => {
    const owner = await actor(OWNER, WS)
    const draft = await rpc<{ id: string }>(
      owner,
      'create_pipeline_definition_version',
      {
        p_workspace_id: WS,
        p_definition_id: pipelineDefinitionId,
        p_configuration: pipelineConfig('SELECT 1 AS x'),
      },
    )
    await expect(
      rpc(owner, 'start_pipeline_run', {
        p_workspace_id: WS,
        p_definition_version_id: draft.id,
        p_trigger_kind: 'manual',
        p_input_versions: { measurements: inputDatasetVersionId },
      }),
    ).rejects.toMatchObject({ code: 'SB072' })
  })
})

describe('Pipeline execution (AUTO-02)', () => {
  it('runs a published version end-to-end and produces a canonical Dataset Version', async () => {
    const owner = await actor(OWNER, WS)
    const run = await rpc<{ id: string; status: string }>(
      owner,
      'start_pipeline_run',
      {
        p_workspace_id: WS,
        p_definition_version_id: pipelineVersionId,
        p_trigger_kind: 'manual',
        p_parameters: { factor: 10, note: 'tenfold' },
        p_input_versions: { measurements: inputDatasetVersionId },
      },
    )
    expect(run.status).toBe('running')

    const { deps, close } = await makeExecDeps(OWNER)
    const report = await runPipelineExecution(OWNER, run.id, deps)
    await close()

    expect(report.ok).toBe(true)
    expect(report.run?.status).toBe('succeeded')
    expect(report.run?.result).toMatchObject({
      rowCount: 3,
      outputDatasetId: expect.any(String),
      outputDatasetVersionId: expect.any(String),
    })

    // The output is a canonical Dataset Version with scaled rows.
    const { rows } = await migrator.query(
      `select dvv.numeric_value, dvv.row_id
         from api.dataset_version_values dvv
        where dvv.dataset_version_id = $1
          and dvv.field_id in (select field_id from api.dataset_schema_version_fields f
                                where f.schema_version_id = $2 and f.key = 'scaled')
        order by dvv.row_id`,
      [report.run!.result.outputDatasetVersionId, schemaVersionId],
    )
    expect(
      rows.map((r) => Number(r.numeric_value)).sort((a, b) => a - b),
    ).toEqual([20, 40, 80])
  })

  it('replays a prior success idempotently for the same canonical inputs', async () => {
    const owner = await actor(OWNER, WS)
    const first = await rpc<{
      id: string
      status: string
      input_digest: string
    }>(owner, 'start_pipeline_run', {
      p_workspace_id: WS,
      p_definition_version_id: pipelineVersionId,
      p_trigger_kind: 'manual',
      p_parameters: { factor: 10 },
      p_input_versions: { measurements: inputDatasetVersionId },
    })
    // The canonical digest is computed server-side — never caller-supplied.
    expect(first.input_digest).toMatch(/^[0-9a-f]{64}$/)
    // Complete the first run so the replay resolves to the prior success.
    const { deps, close } = await makeExecDeps(OWNER)
    const executed = await runPipelineExecution(OWNER, first.id, deps)
    await close()
    expect(executed.ok).toBe(true)
    const replay = await rpc<{
      id: string
      status: string
      input_digest: string
    }>(owner, 'start_pipeline_run', {
      p_workspace_id: WS,
      p_definition_version_id: pipelineVersionId,
      p_trigger_kind: 'manual',
      p_parameters: { factor: 10 },
      p_input_versions: { measurements: inputDatasetVersionId },
    })
    expect(replay.id).toBe(first.id)
    expect(replay.status).toBe('succeeded')
    expect(replay.input_digest).toBe(first.input_digest)
  })

  it('computes a different run identity when parameters change (authoritative digest)', async () => {
    const owner = await actor(OWNER, WS)
    const runA = await rpc<{ id: string; input_digest: string }>(
      owner,
      'start_pipeline_run',
      {
        p_workspace_id: WS,
        p_definition_version_id: pipelineVersionId,
        p_trigger_kind: 'manual',
        p_parameters: { factor: 1.5 },
        p_input_versions: { measurements: inputDatasetVersionId },
      },
    )
    const runB = await rpc<{ id: string; input_digest: string }>(
      owner,
      'start_pipeline_run',
      {
        p_workspace_id: WS,
        p_definition_version_id: pipelineVersionId,
        p_trigger_kind: 'manual',
        p_parameters: { factor: 2.5 },
        p_input_versions: { measurements: inputDatasetVersionId },
      },
    )
    expect(runA.id).not.toBe(runB.id)
    expect(runA.input_digest).not.toBe(runB.input_digest)
  })

  it('computes a different run identity when the input Version changes', async () => {
    const owner = await actor(OWNER, WS)
    const other = await createInputDatasetVersion(
      owner,
      schemaVersionId,
      'pipeline-test-input-diff',
      [
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      ],
    )
    const runA = await rpc<{ id: string; input_digest: string }>(
      owner,
      'start_pipeline_run',
      {
        p_workspace_id: WS,
        p_definition_version_id: pipelineVersionId,
        p_trigger_kind: 'manual',
        p_parameters: { factor: 2 },
        p_input_versions: { measurements: inputDatasetVersionId },
      },
    )
    const runB = await rpc<{ id: string; input_digest: string }>(
      owner,
      'start_pipeline_run',
      {
        p_workspace_id: WS,
        p_definition_version_id: pipelineVersionId,
        p_trigger_kind: 'manual',
        p_parameters: { factor: 2 },
        p_input_versions: { measurements: other.versionId },
      },
    )
    expect(runA.input_digest).not.toBe(runB.input_digest)
  })

  it('rejects a caller-supplied digest (identity is never caller-chosen)', async () => {
    const owner = await actor(OWNER, WS)
    // The start RPC no longer accepts p_input_digest at all — a forged
    // digest cannot change the run identity because there is no parameter
    // to pass it through. The extra argument fails the call.
    await expect(
      rpc(owner, 'start_pipeline_run', {
        p_workspace_id: WS,
        p_definition_version_id: pipelineVersionId,
        p_trigger_kind: 'manual',
        p_parameters: { factor: 2 },
        p_input_versions: { measurements: inputDatasetVersionId },
        p_input_digest: 'f'.repeat(64),
        p_retry_of_run_id: null,
        p_trigger_occurrence_id: null,
      }),
    ).rejects.toBeTruthy()
  })

  it('rejects concurrent duplicate runs of the same inputs', async () => {
    const owner = await actor(OWNER, WS)
    await rpc(owner, 'start_pipeline_run', {
      p_workspace_id: WS,
      p_definition_version_id: pipelineVersionId,
      p_trigger_kind: 'manual',
      p_parameters: { factor: 2.75 },
      p_input_versions: { measurements: inputDatasetVersionId },
    })
    await expect(
      rpc(owner, 'start_pipeline_run', {
        p_workspace_id: WS,
        p_definition_version_id: pipelineVersionId,
        p_trigger_kind: 'manual',
        p_parameters: { factor: 2.75 },
        p_input_versions: { measurements: inputDatasetVersionId },
      }),
    ).rejects.toMatchObject({ code: 'SB044' })
  })

  it('fails a run whose transform is rejected by the boundary', async () => {
    const owner = await actor(OWNER, WS)
    const def = await rpc<{ id: string }>(owner, 'create_pipeline_definition', {
      p_workspace_id: WS,
      p_key: 'evil_sql',
      p_name: 'Evil SQL',
    })
    const version = await rpc<{ id: string }>(
      owner,
      'create_pipeline_definition_version',
      {
        p_workspace_id: WS,
        p_definition_id: def.id,
        p_configuration: pipelineConfig('SELECT * FROM api.datasets'),
      },
    )
    await rpc(owner, 'publish_pipeline_definition_version', {
      p_workspace_id: WS,
      p_version_id: version.id,
    })
    const run = await rpc<{ id: string }>(owner, 'start_pipeline_run', {
      p_workspace_id: WS,
      p_definition_version_id: version.id,
      p_trigger_kind: 'manual',
      p_parameters: { factor: 1 },
      p_input_versions: { measurements: inputDatasetVersionId },
    })
    const { deps, close } = await makeExecDeps(OWNER)
    const report = await runPipelineExecution(OWNER, run.id, deps)
    await close()
    expect(report.ok).toBe(false)
    expect(report.errorCode).toBe('transform_rejected')
    const { rows } = await migrator.query(
      `select status, error_code from api.pipeline_runs where id = $1`,
      [run.id],
    )
    expect(rows[0].status).toBe('failed')
    expect(rows[0].error_code).toBe('transform_rejected')
  })

  it('fails a run whose transform raises a SQL error', async () => {
    const owner = await actor(OWNER, WS)
    const def = await rpc<{ id: string }>(owner, 'create_pipeline_definition', {
      p_workspace_id: WS,
      p_key: 'broken_sql',
      p_name: 'Broken SQL',
    })
    const version = await rpc<{ id: string }>(
      owner,
      'create_pipeline_definition_version',
      {
        p_workspace_id: WS,
        p_definition_id: def.id,
        p_configuration: pipelineConfig(
          'SELECT nonexistent_column FROM measurements',
        ),
      },
    )
    await rpc(owner, 'publish_pipeline_definition_version', {
      p_workspace_id: WS,
      p_version_id: version.id,
    })
    const run = await rpc<{ id: string }>(owner, 'start_pipeline_run', {
      p_workspace_id: WS,
      p_definition_version_id: version.id,
      p_trigger_kind: 'manual',
      p_parameters: { factor: 1 },
      p_input_versions: { measurements: inputDatasetVersionId },
    })
    const { deps, close } = await makeExecDeps(OWNER)
    const report = await runPipelineExecution(OWNER, run.id, deps)
    await close()
    expect(report.ok).toBe(false)
    expect(report.errorCode).toBe('transform_failed')
  })

  it('keeps a transform that slips past the statement filter inside the sandbox login', async () => {
    const owner = await actor(OWNER, WS)
    const def = await rpc<{ id: string }>(owner, 'create_pipeline_definition', {
      p_workspace_id: WS,
      p_key: 'sandbox_escape',
      p_name: 'Sandbox escape',
    })
    // The schema name is assembled at run time, which the static filter cannot
    // see; only the sandbox login stands between this statement and the data.
    const version = await rpc<{ id: string }>(
      owner,
      'create_pipeline_definition_version',
      {
        p_workspace_id: WS,
        p_definition_id: def.id,
        p_configuration: pipelineConfig(
          `SELECT query_to_xml('select * from ap' || 'i.workspaces', true, false, '') AS leaked FROM measurements`,
        ),
      },
    )
    await rpc(owner, 'publish_pipeline_definition_version', {
      p_workspace_id: WS,
      p_version_id: version.id,
    })
    const run = await rpc<{ id: string }>(owner, 'start_pipeline_run', {
      p_workspace_id: WS,
      p_definition_version_id: version.id,
      p_trigger_kind: 'manual',
      p_parameters: { factor: 1 },
      p_input_versions: { measurements: inputDatasetVersionId },
    })
    const { deps, close } = await makeExecDeps(OWNER)
    const report = await runPipelineExecution(OWNER, run.id, deps)
    await close()
    expect(report.ok).toBe(false)
    expect(report.errorCode).toBe('transform_failed')
    expect(report.errorMessage).toMatch(/permission denied/)
  })

  it('fails a run when an input Dataset Version is missing', async () => {
    const owner = await actor(OWNER, WS)
    const run = await rpc<{ id: string }>(owner, 'start_pipeline_run', {
      p_workspace_id: WS,
      p_definition_version_id: pipelineVersionId,
      p_trigger_kind: 'manual',
      p_parameters: { factor: 1 },
      p_input_versions: {
        measurements: '99999999-9999-4999-8999-999999999999',
      },
    })
    const { deps, close } = await makeExecDeps(OWNER)
    const report = await runPipelineExecution(OWNER, run.id, deps)
    await close()
    expect(report.ok).toBe(false)
    expect(report.errorCode).toBe('input_not_found')
  })

  it('retries a failed run as a linked attempt', async () => {
    const owner = await actor(OWNER, WS)
    const def = await rpc<{ id: string }>(owner, 'create_pipeline_definition', {
      p_workspace_id: WS,
      p_key: 'flaky_sql',
      p_name: 'Flaky SQL',
    })
    const version = await rpc<{ id: string }>(
      owner,
      'create_pipeline_definition_version',
      {
        p_workspace_id: WS,
        p_definition_id: def.id,
        p_configuration: pipelineConfig('SELECT bogus FROM measurements'),
      },
    )
    await rpc(owner, 'publish_pipeline_definition_version', {
      p_workspace_id: WS,
      p_version_id: version.id,
    })
    const first = await rpc<{ id: string; status: string }>(
      owner,
      'start_pipeline_run',
      {
        p_workspace_id: WS,
        p_definition_version_id: version.id,
        p_trigger_kind: 'manual',
        p_parameters: { factor: 1 },
        p_input_versions: { measurements: inputDatasetVersionId },
      },
    )
    const { deps, close } = await makeExecDeps(OWNER)
    await runPipelineExecution(OWNER, first.id, deps)
    await close()

    // Without retry_of_run_id the same digest is refused after failure.
    await expect(
      rpc(owner, 'start_pipeline_run', {
        p_workspace_id: WS,
        p_definition_version_id: version.id,
        p_trigger_kind: 'manual',
        p_parameters: { factor: 1 },
        p_input_versions: { measurements: inputDatasetVersionId },
      }),
    ).rejects.toMatchObject({ code: 'SB045' })

    const retry = await rpc<{
      id: string
      attempt: number
      retry_of_run_id: string
    }>(owner, 'start_pipeline_run', {
      p_workspace_id: WS,
      p_definition_version_id: version.id,
      p_trigger_kind: 'manual',
      p_parameters: { factor: 1 },
      p_input_versions: { measurements: inputDatasetVersionId },
      p_retry_of_run_id: first.id,
    })
    expect(retry.attempt).toBe(2)
    expect(retry.retry_of_run_id).toBe(first.id)
  })

  it('cancels a running run', async () => {
    const owner = await actor(OWNER, WS)
    const run = await rpc<{ id: string }>(owner, 'start_pipeline_run', {
      p_workspace_id: WS,
      p_definition_version_id: pipelineVersionId,
      p_trigger_kind: 'manual',
      p_parameters: { factor: 1 },
      p_input_versions: { measurements: inputDatasetVersionId },
    })
    const cancelled = await rpc<{ status: string; error_code: string }>(
      owner,
      'cancel_pipeline_run',
      { p_workspace_id: WS, p_run_id: run.id },
    )
    expect(cancelled.status).toBe('cancelled')
    expect(cancelled.error_code).toBe('cancelled')
    // Executing a cancelled run is an idempotent no-op: nothing runs, the
    // run stays cancelled.
    const { deps, close } = await makeExecDeps(OWNER)
    const report = await runPipelineExecution(OWNER, run.id, deps)
    await close()
    expect(report.ok).toBe(true)
    expect(report.run).toMatchObject({ id: run.id, status: 'cancelled' })
    const { rows } = await migrator.query(
      `select status from api.pipeline_runs where id = $1`,
      [run.id],
    )
    expect(rows[0].status).toBe('cancelled')
  })

  it('lets a workspace member run a published version', async () => {
    const member = await actor(MEMBER, WS)
    const run = await rpc<{ id: string; actor_user_id: string }>(
      member,
      'start_pipeline_run',
      {
        p_workspace_id: WS,
        p_definition_version_id: pipelineVersionId,
        p_trigger_kind: 'manual',
        p_parameters: { factor: 3 },
        p_input_versions: { measurements: inputDatasetVersionId },
      },
    )
    expect(run.actor_user_id).toBe(MEMBER)
    const { deps, close } = await makeExecDeps(MEMBER)
    const report = await runPipelineExecution(MEMBER, run.id, deps)
    await close()
    expect(report.ok).toBe(true)
    expect(report.run?.status).toBe('succeeded')
  })

  it('forbids a non-actor writer from finalizing another run or forging logs', async () => {
    // OWNER starts a run; MEMBER (a writer, not the actor) must not be able
    // to complete it or append logs to it.
    const owner = await actor(OWNER, WS)
    const run = await rpc<{ id: string }>(owner, 'start_pipeline_run', {
      p_workspace_id: WS,
      p_definition_version_id: pipelineVersionId,
      p_trigger_kind: 'manual',
      p_parameters: { factor: 7 },
      p_input_versions: { measurements: inputDatasetVersionId },
    })
    const member = await actor(MEMBER, WS)
    await expect(
      rpc(member, 'complete_pipeline_run', {
        p_workspace_id: WS,
        p_run_id: run.id,
        p_result: { forged: true },
      }),
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      rpc(member, 'append_pipeline_run_log', {
        p_workspace_id: WS,
        p_run_id: run.id,
        p_level: 'info',
        p_stage: 'forged',
        p_message: 'fake evidence',
      }),
    ).rejects.toMatchObject({ code: '42501' })
    // The run is still running; the owner completes it legitimately.
    const { deps, close } = await makeExecDeps(OWNER)
    const report = await runPipelineExecution(OWNER, run.id, deps)
    await close()
    expect(report.ok).toBe(true)
    // No forged logs landed on the finished run.
    const { rows } = await migrator.query(
      `select count(*)::int as n from api.pipeline_run_logs
        where run_id = $1 and stage = 'forged'`,
      [run.id],
    )
    expect(rows[0].n).toBe(0)
  })

  it('rejects viewer run starts (writer-only)', async () => {
    const viewer = await actor(VIEWER, WS)
    await expect(
      rpc(viewer, 'start_pipeline_run', {
        p_workspace_id: WS,
        p_definition_version_id: pipelineVersionId,
        p_trigger_kind: 'manual',
        p_parameters: { factor: 1 },
        p_input_versions: { measurements: inputDatasetVersionId },
      }),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('commits a >1000-row output in chunks and records stage durations (PLAT-05)', async () => {
    // Input Dataset Version with 1,500 rows (one and a half commit batches).
    const owner = await actor(OWNER, WS)
    const created = await owner.query<{ id: string }>(
      `insert into api.datasets(workspace_id, schema_version_id, name, created_by_user_id)
       values ($1, $2, $3, $4) returning id`,
      [WS, schemaVersionId, 'Bulk input', OWNER],
    )
    const bulkDatasetId = created.rows[0].id
    await migrator.query(
      `insert into api.dataset_rows(id, dataset_id, workspace_id)
       select ('aaab0000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, $1, $2
         from generate_series(1, 1500) i`,
      [bulkDatasetId, WS],
    )
    const bulkFields = await migrator.query<{ id: string; key: string }>(
      `select field_id as id, key from api.dataset_schema_version_fields
        where schema_version_id = $1 and lifecycle = 'active'`,
      [schemaVersionId],
    )
    const fieldId = Object.fromEntries(
      bulkFields.rows.map((f) => [f.key, f.id]),
    )
    await migrator.query(
      `insert into api.dataset_row_values(row_id, field_id, ordinal, text_value)
       select r.id, $2, 0, 'B'
         from api.dataset_rows r where r.dataset_id = $1`,
      [bulkDatasetId, fieldId.batch],
    )
    await migrator.query(
      `insert into api.dataset_row_values(row_id, field_id, ordinal, numeric_value)
       select r.id, $2, 0, ((substring(r.id::text, 25, 12)::integer) * 2.0)::numeric
         from api.dataset_rows r where r.dataset_id = $1`,
      [bulkDatasetId, fieldId.value],
    )
    await migrator.query(
      `insert into api.dataset_versions(
         id, dataset_id, workspace_id, schema_version_id, source_dataset_revision, label, created_by_user_id
       ) values ($1, $2, $3, $4, 1, 'bulk input', $5)`,
      [
        'aaac0000-0000-4000-8000-000000000001',
        bulkDatasetId,
        WS,
        schemaVersionId,
        OWNER,
      ],
    )
    await migrator.query(
      `insert into api.dataset_version_rows(dataset_version_id, row_id, revision)
       select $1, id, revision from api.dataset_rows where dataset_id = $2`,
      ['aaac0000-0000-4000-8000-000000000001', bulkDatasetId],
    )
    await migrator.query(
      `insert into api.dataset_version_values(
         dataset_version_id, row_id, field_id, ordinal, text_value, numeric_value
       )
       select $1, v.row_id, v.field_id, v.ordinal, v.text_value, v.numeric_value
         from api.dataset_row_values v
         join api.dataset_rows r on r.id = v.row_id
        where r.dataset_id = $2`,
      ['aaac0000-0000-4000-8000-000000000001', bulkDatasetId],
    )

    const run = await rpc<{ id: string; status: string }>(
      owner,
      'start_pipeline_run',
      {
        p_workspace_id: WS,
        p_definition_version_id: pipelineVersionId,
        p_trigger_kind: 'manual',
        p_parameters: { factor: 3 },
        p_input_versions: {
          measurements: 'aaac0000-0000-4000-8000-000000000001',
        },
      },
    )
    expect(run.status).toBe('running')
    const { deps, close } = await makeExecDeps(OWNER)
    const report = await runPipelineExecution(OWNER, run.id, deps)
    await close()
    expect(report.ok).toBe(true)
    expect(report.run?.status).toBe('succeeded')
    const result = report.run?.result as {
      rowCount?: number
      stageDurationsMs?: Record<string, number>
      outputDatasetVersionId?: string
    }
    expect(result.rowCount).toBe(1500)
    expect(result.outputDatasetVersionId).toEqual(expect.any(String))
    expect(result.stageDurationsMs?.datasetCommit).toBeGreaterThan(0)
    expect(result.stageDurationsMs?.datasetSnapshot).toBeGreaterThan(0)
    const outputRows = await migrator.query(
      `select count(*)::int as n from api.dataset_version_rows
        where dataset_version_id = $1`,
      [result.outputDatasetVersionId],
    )
    expect(outputRows.rows[0].n).toBe(1500)
    // Clean up the bulk output dataset + its immutable version.
    await migrator.query(
      `alter table api.dataset_versions disable trigger prevent_dataset_version_mutation`,
    )
    await migrator.query(
      `alter table api.dataset_version_rows disable trigger prevent_dataset_version_row_mutation`,
    )
    await migrator.query(
      `alter table api.dataset_version_values disable trigger prevent_dataset_version_value_mutation`,
    )
    try {
      await migrator.query(
        `delete from api.pipeline_run_outputs where run_id = $1`,
        [run.id],
      )
      await migrator.query(
        `delete from api.dataset_version_values where dataset_version_id = any($1::uuid[])`,
        [
          [
            'aaac0000-0000-4000-8000-000000000001',
            result.outputDatasetVersionId,
          ],
        ],
      )
      await migrator.query(
        `delete from api.dataset_version_rows where dataset_version_id = any($1::uuid[])`,
        [
          [
            'aaac0000-0000-4000-8000-000000000001',
            result.outputDatasetVersionId,
          ],
        ],
      )
      await migrator.query(
        `delete from api.dataset_versions where id = any($1::uuid[])`,
        [
          [
            'aaac0000-0000-4000-8000-000000000001',
            result.outputDatasetVersionId,
          ],
        ],
      )
    } finally {
      await migrator.query(
        `alter table api.dataset_version_values enable trigger prevent_dataset_version_value_mutation`,
      )
      await migrator.query(
        `alter table api.dataset_version_rows enable trigger prevent_dataset_version_row_mutation`,
      )
      await migrator.query(
        `alter table api.dataset_versions enable trigger prevent_dataset_version_mutation`,
      )
    }
    await migrator.query(`delete from api.dataset_rows where dataset_id = $1`, [
      bulkDatasetId,
    ])
    await migrator.query(`delete from api.datasets where id = $1`, [
      bulkDatasetId,
    ])
  })
})

describe('Pipeline schedules and event triggers (AUTO-02)', () => {
  it('creates an interval schedule and fires it from the sweep', async () => {
    const owner = await actor(OWNER, WS)
    const schedule = await rpc<{ id: string; next_run_at: string | null }>(
      owner,
      'create_pipeline_schedule',
      {
        p_workspace_id: WS,
        p_definition_id: pipelineDefinitionId,
        p_kind: 'interval',
        p_spec: {
          intervalMinutes: 5,
          inputVersions: { measurements: inputDatasetVersionId },
          parameters: { factor: 2 },
        },
        p_enabled: true,
      },
    )
    expect(schedule.next_run_at).not.toBeNull()

    // Force due and run the sweep with real connections.
    await migrator.query(
      `update api.pipeline_schedules set next_run_at = now() - interval '1 minute' where id = $1`,
      [schedule.id],
    )
    const conn = new PgClient({ connectionString: superuserTestUrl() })
    await conn.connect()
    const schedulerDeps = {
      connect: () => Promise.resolve(schedulerConnection(conn)),
      run: async (actorId: string, runId: string) => {
        const { deps, close } = await makeExecDeps(actorId)
        const report = await runPipelineExecution(actorId, runId, deps)
        await close()
        return report
      },
    }
    const started = await sweepPipelines(schedulerDeps)
    await conn.end()
    expect(started).toBeGreaterThanOrEqual(1)

    const { rows } = await migrator.query(
      `select count(*)::int as n from api.pipeline_runs
        where definition_version_id = $1 and trigger_kind = 'scheduled'`,
      [pipelineVersionId],
    )
    expect(rows[0].n).toBeGreaterThanOrEqual(1)
  })

  it('fires an event schedule when a Dataset Version is created', async () => {
    const owner = await actor(OWNER, WS)
    await rpc(owner, 'create_pipeline_schedule', {
      p_workspace_id: WS,
      p_definition_id: pipelineDefinitionId,
      p_kind: 'event',
      p_spec: {
        eventType: 'dataset.versioned',
        inputName: 'measurements',
        parameters: { factor: 5 },
      },
      p_enabled: true,
    })
    // Create a new Dataset Version (also emits the change event).
    const { datasetId, versionId } = await createInputDatasetVersion(
      owner,
      schemaVersionId,
      'pipeline-test-input-2',
      [
        '44444444-4444-4444-8444-444444444444',
        '55555555-5555-4555-8555-555555555555',
        '66666666-6666-4666-8666-666666666666',
      ],
    )
    expect(versionId).not.toBeNull()
    expect(datasetId).not.toBeNull()

    const conn = new PgClient({ connectionString: superuserTestUrl() })
    await conn.connect()
    const schedulerDeps = {
      connect: () => Promise.resolve(schedulerConnection(conn)),
      run: async (actorId: string, runId: string) => {
        const { deps, close } = await makeExecDeps(actorId)
        const report = await runPipelineExecution(actorId, runId, deps)
        await close()
        return report
      },
    }
    const started = await sweepPipelines(schedulerDeps)
    await conn.end()
    expect(started).toBeGreaterThanOrEqual(1)

    const { rows } = await migrator.query(
      `select count(*)::int as n from api.pipeline_runs
        where definition_version_id = $1 and trigger_kind = 'event'`,
      [pipelineVersionId],
    )
    expect(rows[0].n).toBeGreaterThanOrEqual(1)
  })
  it('validates event specs on update the same way as on create', async () => {
    const owner = await actor(OWNER, WS)
    const schedule = await rpc<{ id: string }>(
      owner,
      'create_pipeline_schedule',
      {
        p_workspace_id: WS,
        p_definition_id: pipelineDefinitionId,
        p_kind: 'event',
        p_spec: {
          eventType: 'dataset.versioned',
          inputName: 'measurements',
        },
        p_enabled: true,
      },
    )
    const update = (
      spec: Record<string, unknown>,
    ): Promise<{ id: string; spec: { eventType: string } }> =>
      rpc(owner, 'update_pipeline_schedule', {
        p_workspace_id: WS,
        p_schedule_id: schedule.id,
        p_kind: 'event',
        p_spec: spec,
        p_enabled: true,
      })
    // Update rejects what create rejects: non-triggerable events and bad
    // dataset filters (previously the update path normalized the name only).
    await expect(
      update({ eventType: 'pipeline.created', inputName: 'measurements' }),
    ).rejects.toMatchObject({ code: 'SB034' })
    await expect(
      update({
        eventType: 'dataset.versioned',
        datasetId: 'not-a-uuid',
        inputName: 'measurements',
      }),
    ).rejects.toMatchObject({ code: 'SB034' })
    await expect(
      update({
        eventType: 'dataset.versioned',
        datasetId: 42,
        inputName: 'measurements',
      }),
    ).rejects.toMatchObject({ code: 'SB034' })
    // ... and still accepts what create accepts (alias in, canonical out).
    const updated = await update({
      eventType: 'dataset_version_created',
      inputName: 'measurements',
    })
    expect(updated.spec.eventType).toBe('dataset.versioned')
  })

  it('create path still rejects invalid event specs', async () => {
    const owner = await actor(OWNER, WS)
    const create = (spec: Record<string, unknown>): Promise<{ id: string }> =>
      rpc(owner, 'create_pipeline_schedule', {
        p_workspace_id: WS,
        p_definition_id: pipelineDefinitionId,
        p_kind: 'event',
        p_spec: spec,
        p_enabled: true,
      })
    await expect(
      create({ eventType: 'dataset.versioned', datasetId: 'not-a-uuid' }),
    ).rejects.toMatchObject({ code: 'SB034' })
    await expect(create({ eventType: 'nope.notreal' })).rejects.toMatchObject({
      code: 'SB034',
    })
  })

  it('records run outputs and stage logs for provenance', async () => {
    const { rows: outputs } = await migrator.query(
      `select run_id, dataset_id, dataset_version_id from api.pipeline_run_outputs limit 1`,
    )
    expect(outputs.length).toBeGreaterThan(0)
    const { rows: logs } = await migrator.query(
      `select stage, level from api.pipeline_run_logs
        where run_id = $1 order by sequence`,
      [outputs[0].run_id],
    )
    expect(logs.map((l) => l.stage)).toEqual(
      expect.arrayContaining(['start', 'inputs', 'transform', 'output']),
    )
  })

  async function makeSweepDeps(conn: PgClient): Promise<PipelineSchedulerDeps> {
    return {
      connect: () => Promise.resolve(schedulerConnection(conn)),
      run: async (actorId: string, runId: string) => {
        const { deps, close } = await makeExecDeps(actorId)
        const report = await runPipelineExecution(actorId, runId, deps)
        await close()
        return report
      },
    }
  }

  it('dedupes a duplicate schedule sweep by trigger occurrence', async () => {
    const owner = await actor(OWNER, WS)
    const schedule = await rpc<{ id: string; next_run_at: string }>(
      owner,
      'create_pipeline_schedule',
      {
        p_workspace_id: WS,
        p_definition_id: pipelineDefinitionId,
        p_kind: 'interval',
        p_spec: {
          intervalMinutes: 5,
          inputVersions: { measurements: inputDatasetVersionId },
          parameters: { factor: 4 },
        },
        p_enabled: true,
      },
    )
    // Pin the due time so both sweeps evaluate the SAME occurrence.
    const dueAt = new Date(Date.now() - 60_000)
    await migrator.query(
      `update api.pipeline_schedules set next_run_at = $2 where id = $1`,
      [schedule.id, dueAt.toISOString()],
    )
    const conn = new PgClient({ connectionString: superuserTestUrl() })
    await conn.connect()
    const deps = await makeSweepDeps(conn)
    expect(await sweepPipelines(deps)).toBeGreaterThanOrEqual(1)
    const occurrenceId = `sched:${schedule.id}:${dueAt.toISOString().replace(/[:.]/g, '-')}`
    const { rows: first } = await migrator.query(
      `select count(*)::int as n from api.pipeline_runs
        where trigger_occurrence_id = $1`,
      [occurrenceId],
    )
    expect(first[0].n).toBe(1)
    // A duplicate sweep of the SAME occurrence must not double-start: reset
    // the due time back to the same instant and sweep again.
    await migrator.query(
      `update api.pipeline_schedules set next_run_at = $2 where id = $1`,
      [schedule.id, dueAt.toISOString()],
    )
    await sweepPipelines(deps)
    await conn.end()
    const { rows: after } = await migrator.query(
      `select count(*)::int as n from api.pipeline_runs
        where trigger_occurrence_id = $1`,
      [occurrenceId],
    )
    expect(after[0].n).toBe(1)
  })

  it('recovers a crashed scheduled occurrence via a sweep, retrying the same occurrence', async () => {
    const owner = await actor(OWNER, WS)
    const schedule = await rpc<{ id: string; next_run_at: string }>(
      owner,
      'create_pipeline_schedule',
      {
        p_workspace_id: WS,
        p_definition_id: pipelineDefinitionId,
        p_kind: 'interval',
        p_spec: {
          intervalMinutes: 5,
          inputVersions: { measurements: inputDatasetVersionId },
          parameters: { factor: 6 },
        },
        p_enabled: true,
      },
    )
    const dueAt = new Date(Date.now() - 60_000)
    await migrator.query(
      `update api.pipeline_schedules set next_run_at = $2 where id = $1`,
      [schedule.id, dueAt.toISOString()],
    )
    const occurrenceId = `sched:${schedule.id}:${dueAt.toISOString().replace(/[:.]/g, '-')}`

    const conn = new PgClient({ connectionString: superuserTestUrl() })
    await conn.connect()
    // First sweep: the run is STARTED and next_run_at advances, but the
    // executor "crashes" (no-op run callback — the run is never executed).
    const crashDeps = await makeSweepDeps(conn)
    crashDeps.run = async () => undefined
    const started = await sweepPipelines(crashDeps)
    expect(started).toBeGreaterThanOrEqual(1)
    const { rows: crashedRows } = await migrator.query(
      `select id, status, attempt, schedule_id from api.pipeline_runs
        where trigger_occurrence_id = $1`,
      [occurrenceId],
    )
    expect(crashedRows).toHaveLength(1)
    expect(crashedRows[0].status).toBe('running')
    expect(crashedRows[0].attempt).toBe(1)
    expect(crashedRows[0].schedule_id).toBe(schedule.id)
    const crashedRunId = crashedRows[0].id

    // The schedule tick advanced to the NEXT occurrence (production does not
    // rewind next_run_at to the crashed occurrence).
    const { rows: nextRows } = await migrator.query(
      `select next_run_at from api.pipeline_schedules where id = $1`,
      [schedule.id],
    )
    expect(new Date(nextRows[0].next_run_at).getTime()).toBeGreaterThan(
      dueAt.getTime(),
    )

    // Age the crashed occurrence stale, then sweep normally WITHOUT touching
    // next_run_at: the stale occurrence must be recovered and retried with
    // its own trigger_occurrence_id.
    await migrator.query(
      `update api.pipeline_runs set started_at = now() - interval '1000 seconds' where id = $1`,
      [crashedRunId],
    )
    const deps = await makeSweepDeps(conn)
    expect(await sweepPipelines(deps)).toBeGreaterThanOrEqual(1)
    await conn.end()

    const { rows } = await migrator.query(
      `select id, status, error_code, attempt, retry_of_run_id
         from api.pipeline_runs
        where trigger_occurrence_id = $1
        order by started_at`,
      [occurrenceId],
    )
    expect(rows).toHaveLength(2)
    expect(rows[0].id).toBe(crashedRunId)
    expect(rows[0].status).toBe('failed')
    expect(rows[0].error_code).toBe('stale_run_reconciled')
    expect(rows[1].status).not.toBe('running')
    expect(rows[1].attempt).toBe(2)
    expect(rows[1].retry_of_run_id).toBe(crashedRunId)
  })

  it('fires an instrument-filtered event schedule only for versions imported from that instrument', async () => {
    const owner = await actor(OWNER, WS)
    const instrumentRows = await migrator.query<{ id: string }>(
      `insert into api.instruments(workspace_id,name,instrument_type)
       values($1,'Sweep filter reader A','qpcr'),($1,'Sweep filter reader B','qpcr')
       returning id`,
      [WS],
    )
    const [instrumentA, instrumentB] = instrumentRows.rows.map((r) => r.id)
    const schedule = await rpc<{ id: string }>(
      owner,
      'create_pipeline_schedule',
      {
        p_workspace_id: WS,
        p_definition_id: pipelineDefinitionId,
        p_kind: 'event',
        p_spec: {
          eventType: 'dataset.versioned',
          instrumentId: instrumentA,
          inputName: 'measurements',
          parameters: { factor: 3 },
        },
        p_enabled: true,
      },
    )
    // Only this schedule sees the events.
    await migrator.query(
      `update api.pipeline_schedules set enabled = false
        where kind = 'event' and id <> $1`,
      [schedule.id],
    )
    const fromA = await createInputDatasetVersion(
      owner,
      schemaVersionId,
      'pipeline-sweep-instrument-a',
      [
        'bbbb0000-0000-4000-8000-000000000001',
        'bbbb0000-0000-4000-8000-000000000002',
        'bbbb0000-0000-4000-8000-000000000003',
      ],
    )
    const fromB = await createInputDatasetVersion(
      owner,
      schemaVersionId,
      'pipeline-sweep-instrument-b',
      [
        'bbbb0000-0000-4000-8000-000000000004',
        'bbbb0000-0000-4000-8000-000000000005',
        'bbbb0000-0000-4000-8000-000000000006',
      ],
    )
    // A third version made by hand, with no instrument import behind it.
    await createInputDatasetVersion(
      owner,
      schemaVersionId,
      'pipeline-sweep-instrument-none',
      [
        'bbbb0000-0000-4000-8000-000000000007',
        'bbbb0000-0000-4000-8000-000000000008',
        'bbbb0000-0000-4000-8000-000000000009',
      ],
    )
    for (const [dataset, version, instrument, key] of [
      [fromA.datasetId, fromA.versionId, instrumentA, 'sweep-import-a'],
      [fromB.datasetId, fromB.versionId, instrumentB, 'sweep-import-b'],
    ] as const) {
      const file = await migrator.query<{ id: string }>(
        `insert into api.dataset_import_files(workspace_id,filename,byte_size,checksum,storage_key,format,status,created_by_user_id)
         values($1,$2,64,repeat('b',64),$3,'csv','parsed',$4) returning id`,
        [WS, `${key}.csv`, `imports/${key}.csv`, OWNER],
      )
      await migrator.query(
        `insert into api.dataset_imports(workspace_id,dataset_id,instrument_id,file_id,snapshot_version_id,
                                         status,idempotency_key,created_by_user_id)
         values($1,$2,$3,$4,$5,'committed',$6,$7)`,
        [WS, dataset, instrument, file.rows[0]!.id, version, key, OWNER],
      )
    }

    const conn = new PgClient({ connectionString: superuserTestUrl() })
    await conn.connect()
    const deps = await makeSweepDeps(conn)
    expect(await sweepPipelines(deps)).toBe(1)
    // Sweeping again finds nothing new: the filtered-out versions are not
    // fired later, and the matching one is not fired twice.
    expect(await sweepPipelines(deps)).toBe(0)
    await conn.end()

    const { rows } = await migrator.query<{
      input_versions: Record<string, string>
    }>(
      `select input_versions from api.pipeline_runs
        where schedule_id = $1 and trigger_kind = 'event'`,
      [schedule.id],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.input_versions.measurements).toBe(fromA.versionId)
  })

  it('recovers a crashed event occurrence via a sweep, retrying evt:<event_id>', async () => {
    const owner = await actor(OWNER, WS)
    const schedule = await rpc<{ id: string }>(
      owner,
      'create_pipeline_schedule',
      {
        p_workspace_id: WS,
        p_definition_id: pipelineDefinitionId,
        p_kind: 'event',
        p_spec: {
          eventType: 'dataset.versioned',
          inputName: 'measurements',
          parameters: { factor: 7 },
        },
        p_enabled: true,
      },
    )
    // Disable other event schedules so only THIS schedule sees the event.
    await migrator.query(
      `update api.pipeline_schedules set enabled = false
        where kind = 'event' and id <> $1`,
      [schedule.id],
    )
    const { datasetId, versionId } = await createInputDatasetVersion(
      owner,
      schemaVersionId,
      'pipeline-test-input-crash',
      [
        'aaaa0000-0000-4000-8000-000000000001',
        'aaaa0000-0000-4000-8000-000000000002',
        'aaaa0000-0000-4000-8000-000000000003',
      ],
    )
    // Scope the schedule to THIS Dataset so only the new event matches.
    await rpc(owner, 'update_pipeline_schedule', {
      p_workspace_id: WS,
      p_schedule_id: schedule.id,
      p_kind: 'event',
      p_spec: {
        eventType: 'dataset.versioned',
        datasetId,
        inputName: 'measurements',
        parameters: { factor: 7 },
      },
      p_enabled: true,
    })
    const { rows: evt } = await migrator.query(
      `select id, sequence from api.change_events
        where entity_type = 'dataset_version' and entity_uuid = $1`,
      [versionId],
    )
    expect(evt).toHaveLength(1)
    const occurrenceId = `evt:${evt[0].id}`

    const conn = new PgClient({ connectionString: superuserTestUrl() })
    await conn.connect()
    // First sweep: run starts + cursor advances, executor "crashes" (no-op).
    const crashDeps = await makeSweepDeps(conn)
    crashDeps.run = async () => undefined
    await sweepPipelines(crashDeps)
    const { rows: crashedRows } = await migrator.query(
      `select id, status from api.pipeline_runs where trigger_occurrence_id = $1`,
      [occurrenceId],
    )
    expect(crashedRows).toHaveLength(1)
    expect(crashedRows[0].status).toBe('running')
    const crashedRunId = crashedRows[0].id
    // The event cursor advanced (the event was consumed; its run just crashed).
    const { rows: cursorRows } = await migrator.query(
      `select last_evaluated_sequence from api.pipeline_schedules where id = $1`,
      [schedule.id],
    )
    expect(
      Number(cursorRows[0].last_evaluated_sequence),
    ).toBeGreaterThanOrEqual(Number(evt[0].sequence))

    // Age the crashed run stale, then sweep normally: the evt occurrence is
    // recovered as a linked retry; no duplicate occurrence is created.
    await migrator.query(
      `update api.pipeline_runs set started_at = now() - interval '1000 seconds' where id = $1`,
      [crashedRunId],
    )
    const deps = await makeSweepDeps(conn)
    await sweepPipelines(deps)
    await conn.end()

    const { rows } = await migrator.query(
      `select id, status, error_code, attempt, retry_of_run_id
         from api.pipeline_runs
        where trigger_occurrence_id = $1
        order by started_at`,
      [occurrenceId],
    )
    expect(rows).toHaveLength(2)
    expect(rows[0].id).toBe(crashedRunId)
    expect(rows[0].status).toBe('failed')
    expect(rows[0].error_code).toBe('stale_run_reconciled')
    expect(rows[1].status).not.toBe('running')
    expect(rows[1].attempt).toBe(2)
    expect(rows[1].retry_of_run_id).toBe(crashedRunId)
    expect(datasetId).not.toBeNull()
  })

  it('does not consume an event whose run start fails; retries then abandons durably', async () => {
    const owner = await actor(OWNER, WS)
    const failingSchedule = await rpc<{ id: string }>(
      owner,
      'create_pipeline_schedule',
      {
        p_workspace_id: WS,
        p_definition_id: pipelineDefinitionId,
        p_kind: 'event',
        p_spec: {
          eventType: 'dataset.versioned',
          inputName: 'measurements',
          // Deliberately invalid: the run request will be rejected by the
          // domain validation, so the start fails.
          inputVersions: { bogus: '00000000-0000-4000-8000-000000000000' },
          parameters: { factor: 9 },
        },
        p_enabled: true,
      },
    )
    const { datasetId, versionId } = await createInputDatasetVersion(
      owner,
      schemaVersionId,
      'pipeline-test-input-fail',
      [
        '77777777-7777-4777-8777-777777777777',
        '88888888-8888-4888-8888-888888888888',
        '99999999-9999-4999-8999-999999999999',
      ],
    )
    expect(versionId).not.toBeNull()
    // Scope the event schedule to THIS Dataset so no historic events
    // interfere with the retry-budget assertions, and disable the other
    // event schedules so only THIS schedule sees the new event.
    await rpc(owner, 'update_pipeline_schedule', {
      p_workspace_id: WS,
      p_schedule_id: failingSchedule.id,
      p_kind: 'event',
      p_spec: {
        eventType: 'dataset.versioned',
        datasetId,
        inputName: 'measurements',
        inputVersions: { bogus: '00000000-0000-4000-8000-000000000000' },
        parameters: { factor: 9 },
      },
      p_enabled: true,
    })
    await migrator.query(
      `update api.pipeline_schedules set enabled = false
        where kind = 'event' and id <> $1`,
      [failingSchedule.id],
    )

    const conn = new PgClient({ connectionString: superuserTestUrl() })
    await conn.connect()
    const deps = await makeSweepDeps(conn)
    // First sweep: the start fails (invalid request) — THIS schedule must
    // not consume the event, and the failure must be durable.
    await sweepPipelines(deps)
    const { rows: cursor } = await migrator.query(
      `select last_evaluated_sequence from api.pipeline_schedules where id = $1`,
      [failingSchedule.id],
    )
    expect(cursor[0].last_evaluated_sequence).toBeNull()
    const { rows: failures } = await migrator.query(
      `select status, attempt from api.pipeline_trigger_failures
        where schedule_id = $1 order by created_at desc limit 1`,
      [failingSchedule.id],
    )
    expect(failures.length).toBeGreaterThan(0)
    expect(failures[0].status).toBe('pending')

    // Retries accumulate the budget, then the occurrence is abandoned
    // durably (visible) and the cursor advances.
    await sweepPipelines(deps)
    await sweepPipelines(deps)
    await conn.end()
    const { rows: abandoned } = await migrator.query(
      `select status, attempt from api.pipeline_trigger_failures
        where schedule_id = $1 order by created_at desc limit 1`,
      [failingSchedule.id],
    )
    expect(abandoned[0].status).toBe('abandoned')
    expect(Number(abandoned[0].attempt)).toBeGreaterThanOrEqual(3)
    const { rows: advanced } = await migrator.query(
      `select last_evaluated_sequence from api.pipeline_schedules where id = $1`,
      [failingSchedule.id],
    )
    expect(Number(advanced[0].last_evaluated_sequence)).toBeGreaterThan(0)
  })

  it('pins the crashed Pipeline Version on stale recovery — a retry never silently upgrades to a newer version', async () => {
    const owner = await actor(OWNER, WS)
    // A dedicated Pipeline with V1 published, then V2 published after the
    // crash, so the recovery must still execute V1.
    const def = await rpc<{ id: string }>(owner, 'create_pipeline_definition', {
      p_workspace_id: WS,
      p_key: 'repro_v1_v2',
      p_name: 'Repro V1/V2',
      p_description: null,
    })
    const v1 = await rpc<{ id: string }>(
      owner,
      'create_pipeline_definition_version',
      {
        p_workspace_id: WS,
        p_definition_id: def.id,
        p_configuration: pipelineConfig(
          'SELECT batch, value, value * {{factor}} AS scaled FROM measurements',
        ),
      },
    )
    await rpc(owner, 'publish_pipeline_definition_version', {
      p_workspace_id: WS,
      p_version_id: v1.id,
    })
    const schedule = await rpc<{ id: string }>(
      owner,
      'create_pipeline_schedule',
      {
        p_workspace_id: WS,
        p_definition_id: def.id,
        p_kind: 'interval',
        p_spec: {
          intervalMinutes: 5,
          inputVersions: { measurements: inputDatasetVersionId },
          parameters: { factor: 8 },
        },
        p_enabled: true,
      },
    )
    const dueAt = new Date(Date.now() - 60_000)
    await migrator.query(
      `update api.pipeline_schedules set next_run_at = $2 where id = $1`,
      [schedule.id, dueAt.toISOString()],
    )
    const occurrenceId = `sched:${schedule.id}:${dueAt.toISOString().replace(/[:.]/g, '-')}`

    const conn = new PgClient({ connectionString: superuserTestUrl() })
    await conn.connect()
    // Sweep 1: V1 occurrence starts; executor crashes (no-op).
    const crashDeps = await makeSweepDeps(conn)
    crashDeps.run = async () => undefined
    expect(await sweepPipelines(crashDeps)).toBeGreaterThanOrEqual(1)
    const { rows: crashed } = await migrator.query(
      `select id, definition_version_id from api.pipeline_runs
        where trigger_occurrence_id = $1`,
      [occurrenceId],
    )
    expect(crashed).toHaveLength(1)
    expect(crashed[0].definition_version_id).toBe(v1.id)
    await migrator.query(
      `update api.pipeline_runs set started_at = now() - interval '1000 seconds' where id = $1`,
      [crashed[0].id],
    )

    // Publish V2 (a NEW version) AFTER the crash.
    const v2 = await rpc<{ id: string }>(
      owner,
      'create_pipeline_definition_version',
      {
        p_workspace_id: WS,
        p_definition_id: def.id,
        p_configuration: pipelineConfig(
          'SELECT batch, value, value * {{factor}} + 1 AS scaled FROM measurements',
        ),
      },
    )
    await rpc(owner, 'publish_pipeline_definition_version', {
      p_workspace_id: WS,
      p_version_id: v2.id,
    })

    // A genuinely NEW occurrence becomes due after V2 is published; it must
    // resolve the latest published version (V2), not the pinned V1.
    const newDueAt = new Date(Date.now() - 30_000)
    await migrator.query(
      `update api.pipeline_schedules set next_run_at = $2 where id = $1`,
      [schedule.id, newDueAt.toISOString()],
    )
    const newOccurrenceId = `sched:${schedule.id}:${newDueAt.toISOString().replace(/[:.]/g, '-')}`

    // Sweep 2 (normal): the stale V1 occurrence is recovered pinned to V1,
    // while the NEW occurrence resolves V2.
    const deps = await makeSweepDeps(conn)
    expect(await sweepPipelines(deps)).toBeGreaterThanOrEqual(1)
    await conn.end()

    const { rows: retries } = await migrator.query(
      `select id, definition_version_id, attempt, retry_of_run_id, status, error_code
         from api.pipeline_runs
        where trigger_occurrence_id = $1
        order by started_at`,
      [occurrenceId],
    )
    expect(retries).toHaveLength(2)
    expect(retries[0].id).toBe(crashed[0].id)
    expect(retries[0].status).toBe('failed')
    expect(retries[0].error_code).toBe('stale_run_reconciled')
    expect(retries[1].attempt).toBe(2)
    expect(retries[1].retry_of_run_id).toBe(crashed[0].id)
    // The retry executes the EXACT crashed version (V1), never the newer V2.
    expect(retries[1].definition_version_id).toBe(v1.id)
    expect(retries[1].definition_version_id).not.toBe(v2.id)

    // A genuinely NEW occurrence resolves the latest published version (V2).
    const { rows: fresh } = await migrator.query(
      `select definition_version_id from api.pipeline_runs
        where trigger_occurrence_id = $1`,
      [newOccurrenceId],
    )
    expect(fresh).toHaveLength(1)
    expect(fresh[0].definition_version_id).toBe(v2.id)
  })
})

describe('Pipeline workflow extensions', () => {
  async function workflow(config: Record<string, unknown>) {
    const owner = await actor(OWNER, WS)
    const definition = await rpc<{ id: string }>(
      owner,
      'create_pipeline_definition',
      {
        p_workspace_id: WS,
        p_key: `workflow_${crypto.randomUUID().replaceAll('-', '')}`,
        p_name: 'Workflow proof',
      },
    )
    const version = await rpc<{ id: string }>(
      owner,
      'create_pipeline_definition_version',
      {
        p_workspace_id: WS,
        p_definition_id: definition.id,
        p_configuration: config,
      },
    )
    await rpc(owner, 'publish_pipeline_definition_version', {
      p_workspace_id: WS,
      p_version_id: version.id,
    })
    return rpc<{ id: string }>(owner, 'start_pipeline_run', {
      p_workspace_id: WS,
      p_definition_version_id: version.id,
      p_trigger_kind: 'manual',
      p_parameters: {},
      p_input_versions: {},
    })
  }

  it('chains Python and SQL with no input datasets and records step provenance', async () => {
    const runtime = 'sheetbase/python@sha256:' + 'a'.repeat(64)
    const run = await workflow({
      configVersion: 1,
      parameters: [],
      inputs: [],
      pythonRuntime: runtime,
      transform: {
        language: 'python',
        statement: 'def transform(inputs, parameters): return [{"value": 3}]',
      },
      steps: [
        {
          name: 'double_value',
          language: 'sql',
          statement: 'SELECT value * 2 AS scaled FROM previous',
        },
      ],
      output: { mode: 'none' },
    })
    const { deps, close } = await makeExecDeps(OWNER)
    deps.executePython = async (input) => {
      expect(input.inputs).toEqual({})
      expect(input.runtime).toBe(runtime)
      return { rows: [{ value: 3 }], logs: ['analysis complete'], runtime }
    }
    const report = await runPipelineExecution(OWNER, run.id, deps)
    await close()
    expect(report).toMatchObject({
      ok: true,
      run: { status: 'succeeded', result: { rowCount: 1 } },
    })
    const logs = await migrator.query(
      "SELECT detail FROM api.pipeline_run_logs WHERE run_id=$1 AND stage='step' ORDER BY sequence",
      [run.id],
    )
    expect(logs.rows.map((row) => row.detail.language)).toEqual([
      'python',
      'sql',
    ])
    const outputs = await migrator.query(
      'SELECT count(*)::int AS count FROM api.pipeline_run_outputs WHERE run_id=$1',
      [run.id],
    )
    expect(outputs.rows[0].count).toBe(0)
  })

  it('rolls back a new dataset if a later webhook target is unavailable', async () => {
    const run = await workflow({
      configVersion: 1,
      parameters: [],
      inputs: [],
      transform: {
        language: 'sql',
        statement: "SELECT 'x'::text AS batch, 2 AS value, 4 AS scaled",
      },
      output: {
        mode: 'create',
        schemaVersionId,
        datasetName: 'Must roll back',
        datasetLabel: 'result',
      },
      notifications: [
        { subscriptionId: '00000000-0000-4000-8000-000000000099' },
      ],
    })
    const { deps, close } = await makeExecDeps(OWNER)
    const report = await runPipelineExecution(OWNER, run.id, deps)
    await close()
    expect(report.ok).toBe(false)
    const datasets = await migrator.query(
      "SELECT count(*)::int AS count FROM api.datasets WHERE workspace_id=$1 AND name='Must roll back'",
      [WS],
    )
    expect(datasets.rows[0].count).toBe(0)
    const status = await migrator.query(
      'SELECT status FROM api.pipeline_runs WHERE id=$1',
      [run.id],
    )
    expect(status.rows[0].status).toBe('failed')
  })

  it('creates a project and experiment through named ELN actions without any dataset', async () => {
    const run = await workflow({
      configVersion: 1,
      parameters: [],
      inputs: [],
      transform: { language: 'none', statement: '' },
      output: { mode: 'none' },
      actions: [
        {
          name: 'project',
          operation: 'create_project',
          arguments: { p_title: 'Action-created project' },
        },
        {
          name: 'experiment',
          operation: 'create_model_record',
          arguments: {
            p_project_id: { $ref: 'actions.project.id' },
            p_kind: 'experiment',
            p_title: 'Action-created experiment',
          },
        },
      ],
    })
    const { deps, close } = await makeExecDeps(OWNER)
    const report = await runPipelineExecution(OWNER, run.id, deps)
    await close()
    expect(report.ok).toBe(true)
    const actions = report.run?.result.actions as Record<
      string,
      { id: string; created_by_user_id: string }
    >
    expect(actions.experiment.created_by_user_id).toBe(OWNER)
    const created = await migrator.query(
      'SELECT project_id, workspace_id FROM api.records WHERE id=$1',
      [actions.experiment.id],
    )
    expect(created.rows[0]).toEqual({
      project_id: actions.project.id,
      workspace_id: WS,
    })
  })

  it('proposes a notebook block instead of inserting it when the action says propose', async () => {
    const record = (
      await migrator.query<{ id: string; structure_version: number }>(
        `INSERT INTO api.records(
           workspace_id, kind, identifier, title, status, created_by_user_id)
         VALUES($1,'experiment','EXP-031-PROPOSE','Proposal target','in_progress',$2)
         RETURNING id, structure_version`,
        [WS, OWNER],
      )
    ).rows[0]!

    const run = await workflow({
      configVersion: 1,
      parameters: [],
      inputs: [],
      transform: { language: 'none', statement: '' },
      output: { mode: 'none' },
      actions: [
        {
          name: 'summary',
          operation: 'insert_block',
          mode: 'propose',
          arguments: {
            p_record_id: record.id,
            p_type: 'rich_text',
            p_payload: { doc: { type: 'doc', content: [] } },
            p_expected_structure_version: record.structure_version,
          },
        },
      ],
    })
    const { deps, close } = await makeExecDeps(OWNER)
    const report = await runPipelineExecution(OWNER, run.id, deps)
    await close()
    expect(report.ok).toBe(true)

    const proposed = (
      report.run?.result.actions as Record<
        string,
        {
          id: string
          operation_kind: string
          status: string
          provenance: Record<string, unknown>
        }
      >
    ).summary
    expect(proposed.operation_kind).toBe('notebook_block.insert')
    // Inserting content is consequential, so it waits for a person.
    expect(proposed.status).toBe('pending')
    expect(proposed.provenance.kind).toBe('pipeline')
    expect(proposed.provenance.runId).toBe(run.id)

    // Nothing was inserted: the proposal is the whole effect of the step.
    const blocks = await migrator.query(
      `SELECT id FROM api.blocks WHERE record_id=$1`,
      [record.id],
    )
    expect(blocks.rows).toEqual([])
  })

  it('releases a settled run artifacts once, keeping them only if the run proposed something', async () => {
    const run = await workflow({
      configVersion: 1,
      parameters: [],
      inputs: [],
      transform: { language: 'none', statement: '' },
      output: { mode: 'none' },
      actions: [],
    })
    const { deps, close } = await makeExecDeps(OWNER)
    const report = await runPipelineExecution(OWNER, run.id, deps)
    expect(report.ok).toBe(true)

    // The runner is configured here but not reachable, so the release
    // fails; the run must be left unmarked so the next tick retries rather than looking
    // released when its files were never dealt with.
    const urlBefore = process.env.PIPELINE_PYTHON_RUNNER_URL
    const tokenBefore = process.env.PIPELINE_PYTHON_RUNNER_TOKEN
    process.env.PIPELINE_PYTHON_RUNNER_URL = 'http://127.0.0.1:9'
    process.env.PIPELINE_PYTHON_RUNNER_TOKEN = 'r'.repeat(32)
    let first: Awaited<ReturnType<typeof releaseSettledRunArtefacts>>
    try {
      first = await releaseSettledRunArtefacts(deps)
    } finally {
      if (urlBefore === undefined) delete process.env.PIPELINE_PYTHON_RUNNER_URL
      else process.env.PIPELINE_PYTHON_RUNNER_URL = urlBefore
      if (tokenBefore === undefined)
        delete process.env.PIPELINE_PYTHON_RUNNER_TOKEN
      else process.env.PIPELINE_PYTHON_RUNNER_TOKEN = tokenBefore
    }
    expect(first.failed).toBeGreaterThanOrEqual(1)
    const unmarked = await migrator.query(
      `SELECT 1 FROM api.pipeline_artefact_releases WHERE run_id = $1`,
      [run.id],
    )
    expect(unmarked.rows).toEqual([])
    await close()
  })

  it('marks a run released once the runner has released its files', async () => {
    const run = await workflow({
      configVersion: 1,
      parameters: [],
      inputs: [],
      transform: { language: 'none', statement: '' },
      output: { mode: 'none' },
      actions: [],
    })
    const { deps, close } = await makeExecDeps(OWNER)
    await runPipelineExecution(OWNER, run.id, deps)

    // With no runner configured the release is a no-op that succeeds, which is how a
    // deployment without Python behaves.
    const previous = process.env.PIPELINE_PYTHON_RUNNER_URL
    delete process.env.PIPELINE_PYTHON_RUNNER_URL
    const first = await releaseSettledRunArtefacts(deps)
    expect(first.released).toBeGreaterThanOrEqual(1)
    // The sweep is bounded, and this file leaves many settled runs behind, so assert on
    // what the sweep did rather than on this particular run being in the batch.
    const marked = await migrator.query<{ kept: boolean }>(
      `SELECT kept FROM api.pipeline_artefact_releases WHERE kept = false`,
    )
    expect(marked.rows.length).toBeGreaterThanOrEqual(1)

    // Drain the batch - the sweep is bounded and this file leaves settled runs behind -
    // then a further sweep has nothing to do: the release row is what stops it repeating.
    for (let tick = 0; tick < 20; tick += 1) {
      const pass = await releaseSettledRunArtefacts(deps)
      if (pass.released === 0 && pass.failed === 0) break
    }
    const settled = await releaseSettledRunArtefacts(deps)
    expect(settled.released).toBe(0)
    await close()
  })

  it("does not let a viewer fail another user's running pipeline", async () => {
    const run = await workflow({
      configVersion: 1,
      parameters: [],
      inputs: [],
      transform: { language: 'none', statement: '' },
      output: { mode: 'none' },
    })
    const { deps, close } = await makeExecDeps(VIEWER)
    const report = await runPipelineExecution(VIEWER, run.id, deps)
    await close()
    expect(report.errorCode).toBe('workspace_membership_required')
    const status = await migrator.query(
      'SELECT status FROM api.pipeline_runs WHERE id=$1',
      [run.id],
    )
    expect(status.rows[0].status).toBe('running')
  })

  it('cancels while Python is working and commits no output', async () => {
    const runtime = 'sheetbase/python@sha256:' + 'a'.repeat(64)
    const run = await workflow({
      configVersion: 1,
      parameters: [],
      inputs: [],
      pythonRuntime: runtime,
      transform: {
        language: 'python',
        statement: 'def transform(inputs, parameters): return []',
      },
      output: { mode: 'none' },
    })
    let release!: () => void
    let entered!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const ready = new Promise<void>((resolve) => {
      entered = resolve
    })
    const { deps, close } = await makeExecDeps(OWNER)
    deps.executePython = async () => {
      entered()
      await gate
      return { rows: [], logs: [], runtime }
    }
    const execution = runPipelineExecution(OWNER, run.id, deps)
    await ready
    const owner = await actor(OWNER, WS)
    try {
      await owner.query("SET statement_timeout = '1500ms'")
      const cancelled = await rpc<{ status: string }>(
        owner,
        'cancel_pipeline_run',
        { p_workspace_id: WS, p_run_id: run.id },
      )
      expect(cancelled.status).toBe('cancelled')
    } finally {
      release()
    }
    const report = await execution
    await close()
    expect(report.errorCode).toBe('run_cancelled')
    const status = await migrator.query(
      'SELECT status FROM api.pipeline_runs WHERE id=$1',
      [run.id],
    )
    expect(status.rows[0].status).toBe('cancelled')
  })
  it('executes and replays an authenticated incoming webhook against the real database', async () => {
    const token = 'a'.repeat(43)
    const admin = new PgClient({ connectionString: superuserTestUrl() })
    await admin.connect()
    await admin.query(
      'INSERT INTO internal.pipeline_webhook_triggers(definition_id,workspace_id,created_by_user_id,secret_hash) VALUES($1,$2,$3,$4)',
      [
        pipelineDefinitionId,
        WS,
        OWNER,
        createHash('sha256').update(token).digest('hex'),
      ],
    )
    await admin.end()
    const webhookDeps = {
      getSession: async () => null,
      connect: async () => {
        const conn = new PgClient({ connectionString: superuserTestUrl() })
        await conn.connect()
        clients.push(conn)
        return execConnection(conn)()
      },
      execute: async (user: string, id: string) => {
        const { deps, close } = await makeExecDeps(user)
        try {
          return await runPipelineExecution(user, id, deps)
        } finally {
          await close()
        }
      },
    }
    const request = () =>
      new Request(
        `http://localhost/api/pipelines/webhook/${pipelineDefinitionId}`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'idempotency-key': 'webhook-db-proof',
          },
          body: JSON.stringify({
            parameters: { factor: 3 },
            inputVersions: { measurements: inputDatasetVersionId },
          }),
        },
      )
    const first = await handlePipelineWebhook(
      request(),
      pipelineDefinitionId,
      webhookDeps,
    )
    expect(first.status).toBe(200)
    const result = await first.json()
    expect(result.status).toBe('succeeded')
    const repeated = await handlePipelineWebhook(
      request(),
      pipelineDefinitionId,
      webhookDeps,
    )
    expect(await repeated.json()).toEqual(result)
  })

  it('separates deliberate manual invocations while rejecting changed inputs for the same invocation', async () => {
    const owner = await actor(OWNER, WS)
    const invoke = (occurrence: string, factor = 2) =>
      rpc<{ id: string }>(owner, 'start_pipeline_run', {
        p_workspace_id: WS,
        p_definition_version_id: pipelineVersionId,
        p_trigger_kind: 'manual',
        p_parameters: { factor },
        p_input_versions: { measurements: inputDatasetVersionId },
        p_retry_of_run_id: null,
        p_trigger_occurrence_id: occurrence,
      })
    const key = `manual:${crypto.randomUUID()}`
    const one = await invoke(key)
    const two = await invoke(`manual:${crypto.randomUUID()}`)
    expect(one.id).not.toBe(two.id)
    await expect(invoke(key, 4)).rejects.toMatchObject({ code: 'SB034' })
  })
})
