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
import type { Client } from 'pg'
import { Client as PgClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { runPipelineExecution } from '#/lib/pipeline-execute.server'
import type { PipelineExecuteDeps } from '#/lib/pipeline-execute.server'
import { sweepPipelines } from '#/lib/pipeline-scheduler.server'
import type {
  PipelineSchedulerDeps,
  SchedulerConnection,
} from '#/lib/pipeline-scheduler.server'
import { prepareTestDatabase, setActorJwt, TEST_DATABASE } from './helpers'

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
  url.pathname = `/${TEST_DATABASE}`
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
          transform: { language: 'python', statement: 'x' },
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
    expect(report.run).toBeNull()
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
        eventType: 'dataset_version_created',
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
          eventType: 'dataset_version_created',
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
        eventType: 'dataset_version_created',
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
          eventType: 'dataset_version_created',
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
        eventType: 'dataset_version_created',
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
})
