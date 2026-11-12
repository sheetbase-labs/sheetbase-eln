/**
 * A plugin step in the middle of a pipeline, against real PostgreSQL and the
 * runner's own Python worker: SQL -> plugin step -> SQL. The plugin turns the
 * table before it into a new one, the step after reads that as `previous`, and
 * a plugin that is gone or offers something else stops the run with a plain
 * message and writes nothing.
 */
import type { Client } from 'pg'
import { Client as PgClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  resumePipelineRun,
  runPipelineExecution,
} from '#/lib/pipeline-execute.server'
import type { PipelineExecuteDeps } from '#/lib/pipeline-execute.server'
import { buildPluginPackage } from '#/lib/extensions/package'
import type { ExtensionRuntimeDeps } from '#/lib/extensions/runtime.server'
import {
  localPython,
  pythonAvailable,
  readExample,
} from '#/lib/extensions/testing/local-python'
import { prepareTestDatabase, setActorJwt, testDatabaseName } from './helpers'
import { publishPipelineVersion } from './support/publish-pipeline'

const WS = '0e020000-0000-4000-8000-000000000301'
const OWNER = 'pipeline-plugin-step-owner'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

let schemaVersionId = ''
let inputDatasetId = ''
let inputDatasetVersionId = ''
let definitionId = ''

const files = readExample('bench-extras')
const pkg = buildPluginPackage(files)
let plugin: Record<string, unknown> = structuredClone(pkg.manifest) as never
let installed = true

const pluginDeps: ExtensionRuntimeDeps = {
  loadInstall: async () =>
    installed
      ? {
          id: 'e1',
          key: 'bench-extras',
          name: 'Bench extras',
          status: 'enabled',
          manifest: plugin,
          disabledPoints: [],
        }
      : null,
  loadPackage: async () => files,
  executePython: localPython,
  audit: async () => undefined,
  now: () => Date.now(),
}

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
      executePython: localPython,
      plugins: pluginDeps,
    },
    close: async () => conn.end(),
  }
}

async function createPublishedSchema(owner: Client): Promise<string> {
  const definition = await rpc<{
    schema_definition_id: string
    schema_version_id: string
  }>(owner, 'create_dataset_schema_definition', {
    p_workspace_id: WS,
    p_key: 'plugin_step_measurement',
    p_name: 'Plugin step measurement',
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
  await publishPipelineVersion(owner, WS, version.id)
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

function config(
  steps: Array<Record<string, unknown>>,
): Record<string, unknown> {
  return {
    configVersion: 2,
    mode: 'standard',
    description: 'subtract the blank, then tidy',
    parameters: [{ name: 'factor', type: 'decimal', required: true }],
    inputs: [{ name: 'measurements', required: true }],
    steps: [
      {
        name: 'analysis',
        kind: 'sql',
        statement: 'SELECT batch AS label, value FROM measurements',
      },
      ...steps,
    ],
    output: {
      mode: 'create',
      schemaVersionId,
      datasetName: 'Blank-corrected measurements',
      datasetLabel: 'plugin step output',
      fieldMapping: null,
    },
  }
}

const subtractBlank = (over: Record<string, unknown> = {}) => ({
  name: 'subtract_blank',
  kind: 'plugin',
  plugin: {
    operation: 'plugin.bench-extras.subtract-blank',
    arguments: {
      readings: { $ref: 'previous' },
      value_column: 'value',
      label_column: 'label',
      blank_label: 'blank',
    },
    ...over,
  },
})

const tidy = {
  name: 'tidy',
  kind: 'sql',
  statement:
    "SELECT label AS batch, corrected AS value, corrected * {{factor}} AS scaled FROM previous WHERE label <> 'blank' ORDER BY label",
}

async function run(steps: Array<Record<string, unknown>>) {
  const owner = await ownerActor()
  const versionId = await publishVersion(owner, 'v', config(steps))
  const runId = await startRun(versionId, 10)
  const { deps, close } = await makeExecDeps(OWNER)
  const report = await runPipelineExecution(OWNER, runId, deps)
  await close()
  const logs = await migrator.query<{ stage: string; message: string }>(
    `select stage, message from api.pipeline_run_logs where run_id = $1 order by sequence`,
    [runId],
  )
  return { report, runId, logs: logs.rows }
}
async function outputScaled(outputDatasetVersionId: string): Promise<number[]> {
  const { rows } = await migrator.query<{ numeric_value: string }>(
    // A create output reuses its Dataset, so a Dataset Version also holds the
    // rows of earlier runs; this run's rows are the ones no earlier version had.
    `select v.numeric_value
       from api.dataset_version_values v
       join api.dataset_schema_version_fields f on f.field_id = v.field_id
      where v.dataset_version_id = $1 and f.key = 'scaled'
        and v.row_id not in (
          select vr.row_id
            from api.dataset_version_rows vr
            join api.dataset_versions dv on dv.id = vr.dataset_version_id
           where dv.dataset_id = (select dataset_id from api.dataset_versions where id = $1)
             and dv.created_at < (select created_at from api.dataset_versions where id = $1)
        )
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
    `insert into api.workspaces(id, slug, name) values($1, 'pipeline-plugin-step', 'Pipeline plugin step')`,
    [WS],
  )
  await migrator.query(
    `insert into internal."user"(id, name, email) values ($1, 'Step Owner', 'plugin-step-owner@pipeline.test')`,
    [OWNER],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id, user_id, role) values ($1, $2, 'owner')`,
    [WS, OWNER],
  )
  const owner = await ownerActor()
  schemaVersionId = await createPublishedSchema(owner)
  const created = await owner.query<{ id: string }>(
    `insert into api.datasets(workspace_id, schema_version_id, name, created_by_user_id)
     values ($1, $2, $3, $4) returning id`,
    [WS, schemaVersionId, 'Raw plate readings', OWNER],
  )
  inputDatasetId = created.rows[0].id
  await commitRows(
    owner,
    [
      {
        rowId: '11111111-1111-4111-8111-111111111111',
        batch: 'blank',
        value: 2,
      },
      { rowId: '22222222-2222-4222-8222-222222222222', batch: 'A', value: 10 },
      { rowId: '33333333-3333-4333-8333-333333333333', batch: 'B', value: 6 },
    ],
    1,
    'plugin-step-rows-1',
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
    { p_workspace_id: WS, p_key: 'plugin_step', p_name: 'Plugin step' },
  )
  definitionId = definition.id
})

afterAll(async () => {
  for (const client of clients) await client.end().catch(() => {})
  await migrator?.end()
})

describe.skipIf(!pythonAvailable)('a plugin step between two steps', () => {
  it('feeds the step after it and writes the corrected rows', async () => {
    installed = true
    const { report, logs } = await run([subtractBlank(), tidy])
    expect(report.ok, JSON.stringify(report)).toBe(true)
    expect(report.run?.status).toBe('succeeded')
    const output = await migrator.query<{ dataset_version_id: string }>(
      `select dataset_version_id from api.pipeline_run_outputs where run_id = $1`,
      [report.run?.id],
    )
    expect(await outputScaled(output.rows[0].dataset_version_id)).toEqual([
      40, 80,
    ])
    expect(logs.map((l) => l.stage)).toContain('plugin')
  })

  it('stops with the plugin’s own words when it refuses, and writes nothing', async () => {
    installed = true
    const { report } = await run([
      subtractBlank({
        arguments: {
          readings: { $ref: 'previous' },
          value_column: 'value',
          label_column: 'nope',
        },
      }),
      tidy,
    ])
    expect(report.ok).toBe(false)
    expect(report.errorMessage).toContain('Plugin step subtract_blank')
    expect(report.errorMessage).toContain('nope')
  })

  it('stops when the plugin has been removed', async () => {
    installed = false
    const { report } = await run([subtractBlank(), tidy])
    installed = true
    expect(report.ok).toBe(false)
    expect(report.errorMessage).toContain('no longer installed')
  })

  it('refuses a name that is not a plugin step', async () => {
    installed = true
    const { report } = await run([
      subtractBlank({ operation: 'plugin.bench-extras.master-mix' }),
      tidy,
    ])
    expect(report.ok).toBe(false)
    expect(report.errorMessage).toContain('gives back a table')
  })

  it('pauses after the plugin’s table is ready, shows it, and resumes on confirm', async () => {
    installed = true
    const { report, runId } = await run([
      subtractBlank(),
      {
        name: 'check_blank',
        kind: 'ask',
        ask: {
          fields: [
            { key: 'unit', label: 'Unit', type: 'text', required: true },
          ],
          askedUserIds: [OWNER],
          noAnswer: 'reask',
          expiresHours: 24,
        },
      },
      tidy,
    ])
    expect(report.ok, JSON.stringify(report)).toBe(true)
    expect(report.run?.status).toBe('waiting')
    // The person is shown what the plugin made: the three corrected rows.
    const prompt = await migrator.query<{
      form_schema: { proposal: { rows: Array<{ corrected: number }> } }
    }>(`select form_schema from api.pipeline_run_prompts where run_id = $1`, [
      runId,
    ])
    expect(
      prompt.rows[0].form_schema.proposal.rows.map((r) => r.corrected).sort(),
    ).toEqual([0, 4, 8])
    const { deps, close } = await makeExecDeps(OWNER)
    const resumed = await resumePipelineRun(
      OWNER,
      runId,
      { decision: 'confirm', values: { unit: 'AU' } },
      deps,
    )
    await close()
    expect(resumed.ok, JSON.stringify(resumed)).toBe(true)
    expect(resumed.run?.status).toBe('succeeded')
    const output = await migrator.query<{ dataset_version_id: string }>(
      `select dataset_version_id from api.pipeline_run_outputs where run_id = $1`,
      [runId],
    )
    expect(await outputScaled(output.rows[0].dataset_version_id)).toEqual([
      40, 80,
    ])
  })
})
