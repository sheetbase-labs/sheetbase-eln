/**
 * The web call step, against real PostgreSQL: a connection an administrator
 * approved, a call that signs in with a secret by name, and the rows it brings
 * back feeding the SQL step after it. The network is a fake; what is checked is
 * what the run keeps (the recording and the manifest), that nothing secret
 * lands in either, that a run asking again from the top (a pause) and a
 * Reproduce read the recording instead of asking, and who may manage
 * connections.
 */
import type { Client } from 'pg'
import { Client as PgClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  reproducePipelineRun,
  resumePipelineRun,
  runPipelineExecution,
  tryPipelineDraft,
} from '#/lib/pipeline-execute.server'
import type { PipelineExecuteDeps } from '#/lib/pipeline-execute.server'
import type { WebCallDeps } from '#/lib/pipeline-web-call.server'
import { prepareTestDatabase, setActorJwt, testDatabaseName } from './helpers'
import { publishPipelineVersion } from './support/publish-pipeline'

const WS = '0e020000-0000-4000-8000-000000000302'
const OWNER = 'pipeline-web-call-owner'
const SCIENTIST = 'pipeline-web-call-scientist'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

let schemaVersionId = ''
let inputDatasetId = ''
let inputDatasetVersionId = ''
let definitionId = ''

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
  create_pipeline_connection: [
    'uuid',
    'text',
    'text',
    'text',
    'text',
    'text',
    'text',
  ],
  update_pipeline_connection: [
    'uuid',
    'uuid',
    'text',
    'text',
    'text',
    'text',
    'text',
    'text',
  ],
  delete_pipeline_connection: ['uuid', 'uuid'],
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

async function makeExecDeps(
  actorId: string,
  webCalls: WebCallDeps = webDeps(),
): Promise<{
  deps: PipelineExecuteDeps
  close: () => Promise<void>
}> {
  const conn = new PgClient({ connectionString: superuserTestUrl() })
  await conn.connect()
  return {
    deps: {
      getSession: async () => ({ user: { id: actorId } }),
      connect: execConnection(conn),
      webCalls,
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
    p_key: 'web_call_measurement',
    p_name: 'Web call measurement',
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

const SECRET = 'tok-very-secret-123'

interface Call {
  url: string
  method: string
  headers: Record<string, string>
  body: string | undefined
}

const goodAnswer = (): Response =>
  new Response(
    JSON.stringify({
      items: [
        { batch: 'A', value: 4 },
        { batch: 'B', value: 6 },
      ],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )

/** The fake network: what was asked, and what it answers next. */
const network = {
  calls: [] as Call[],
  answer: goodAnswer,
}

function webDeps(): WebCallDeps {
  return {
    loadConnection: async (_workspace, key) =>
      key === 'lims'
        ? {
            id: 'c1',
            key: 'lims',
            name: 'LIMS',
            baseUrl: 'https://lims.example.com/api',
            status: 'active',
            authHeader: 'Authorization',
            authScheme: 'Bearer',
          }
        : null,
    loadSecret: async (_w, _c, name) =>
      name === 'LIMS_READ_TOKEN' ? SECRET : null,
    fetch: (async (url: URL | string, init?: RequestInit) => {
      network.calls.push({
        url: String(url),
        method: String(init?.method),
        headers: Object.fromEntries(
          Object.entries((init?.headers ?? {}) as Record<string, string>),
        ),
        body: typeof init?.body === 'string' ? init.body : undefined,
      })
      return network.answer()
    }) as typeof fetch,
    sleep: async () => undefined,
    resolveHost: async () => ['93.184.216.34'],
    checkHostPolicy: () => undefined,
  }
}

const get = {
  name: 'titres',
  kind: 'web_call',
  note: 'Feed titres from LIMS, read only',
  webCall: {
    connection: 'lims',
    method: 'GET',
    path: '/batches?project={parameters.project}',
    secret: 'LIMS_READ_TOKEN',
    itemsPath: 'items',
  },
}

const post = {
  name: 'titres',
  kind: 'web_call',
  webCall: {
    connection: 'lims',
    method: 'POST',
    path: '/search',
    body: { project: '{parameters.project}' },
    itemsPath: 'items',
  },
}

const tidy = {
  name: 'tidy',
  kind: 'sql',
  statement:
    'SELECT batch, value, value * 10 AS scaled FROM previous ORDER BY batch',
}

const ask = {
  name: 'check',
  kind: 'ask',
  ask: {
    fields: [{ key: 'unit', label: 'Unit', type: 'text', required: true }],
    askedUserIds: [OWNER],
    noAnswer: 'reask',
    expiresHours: 24,
  },
}

function config(
  steps: Array<Record<string, unknown>>,
): Record<string, unknown> {
  return {
    configVersion: 2,
    mode: 'standard',
    description: 'ask LIMS, then tidy',
    parameters: [
      { name: 'project', type: 'text', required: true },
      { name: 'factor', type: 'decimal', required: false },
    ],
    inputs: [{ name: 'measurements', required: true }],
    steps,
    output: {
      mode: 'create',
      schemaVersionId,
      datasetName: 'LIMS titres',
      datasetLabel: 'web call output',
      fieldMapping: null,
    },
  }
}

async function startRun(versionId: string): Promise<string> {
  const run = await rpc<{ id: string; status: string }>(
    await ownerActor(),
    'start_pipeline_run',
    {
      p_workspace_id: WS,
      p_definition_version_id: versionId,
      p_trigger_kind: 'manual',
      p_parameters: { project: 'AAV9-PT' },
      p_input_versions: { measurements: inputDatasetVersionId },
    },
  )
  expect(run.status).toBe('running')
  return run.id
}

async function run(steps: Array<Record<string, unknown>>) {
  const owner = await ownerActor()
  const versionId = await publishVersion(owner, 'v', config(steps))
  const runId = await startRun(versionId)
  const { deps, close } = await makeExecDeps(OWNER)
  const report = await runPipelineExecution(OWNER, runId, deps)
  await close()
  const logs = await migrator.query<{
    stage: string
    message: string
    detail: unknown
  }>(
    `select stage, message, detail from api.pipeline_run_logs where run_id = $1 order by sequence`,
    [runId],
  )
  return { report, runId, logs: logs.rows }
}

async function stored(runId: string) {
  const { rows } = await migrator.query<{
    step_name: string
    method: string
    url: string
    status: number
    body: string
  }>(
    `select step_name, method, url, status, body
       from internal.pipeline_run_web_responses where run_id = $1`,
    [runId],
  )
  return rows
}

async function countRecordings(): Promise<number> {
  const { rows } = await migrator.query<{ n: string }>(
    'select count(*)::text as n from internal.pipeline_run_web_responses',
  )
  return Number(rows[0].n)
}

async function manifestOf(runId: string) {
  const { rows } = await migrator.query<{ manifest: Record<string, unknown> }>(
    `select manifest from api.pipeline_run_manifests where run_id = $1`,
    [runId],
  )
  return rows[0].manifest
}

beforeAll(async () => {
  const prepared = await prepareTestDatabase()
  migrator = prepared.migrator
  asRole = prepared.asRole
  await migrator.query(
    `insert into api.workspaces(id, slug, name) values($1, 'pipeline-web-call', 'Pipeline web call')`,
    [WS],
  )
  for (const [id, name, role] of [
    [OWNER, 'Web Owner', 'owner'],
    [SCIENTIST, 'Web Scientist', 'scientist'],
  ]) {
    await migrator.query(
      `insert into internal."user"(id, name, email) values ($1, $2, $3)`,
      [id, name, `${id}@pipeline.test`],
    )
    await migrator.query(
      `insert into api.workspace_memberships(workspace_id, user_id, role) values ($1, $2, $3)`,
      [WS, id, role],
    )
  }
  const owner = await ownerActor()
  schemaVersionId = await createPublishedSchema(owner)
  const created = await owner.query<{ id: string }>(
    `insert into api.datasets(workspace_id, schema_version_id, name, created_by_user_id)
     values ($1, $2, $3, $4) returning id`,
    [WS, schemaVersionId, 'Seed rows', OWNER],
  )
  inputDatasetId = created.rows[0].id
  await commitRows(
    owner,
    [
      {
        rowId: '11111111-1111-4111-8111-111111111111',
        batch: 'seed',
        value: 1,
      },
    ],
    1,
    'web-call-rows-1',
  )
  const snapshot = await rpc<{ id: string }>(owner, 'snapshot_dataset', {
    p_dataset_id: inputDatasetId,
    p_expected_dataset_revision: await datasetRevision(),
    p_label: 'seed',
  })
  inputDatasetVersionId = snapshot.id
  const definition = await rpc<{ id: string }>(
    owner,
    'create_pipeline_definition',
    { p_workspace_id: WS, p_key: 'web_call', p_name: 'Web call' },
  )
  definitionId = definition.id
})

afterAll(async () => {
  for (const client of clients) await client.end().catch(() => {})
  await migrator?.end()
})

describe('a web call step between two steps', () => {
  it('feeds the step after it, signs in with the named secret and records what it was told', async () => {
    network.calls = []
    const { report, runId, logs } = await run([get, tidy])
    expect(report.ok, JSON.stringify(report)).toBe(true)
    expect(report.run?.status).toBe('succeeded')

    expect(network.calls).toHaveLength(1)
    expect(network.calls[0].url).toBe(
      'https://lims.example.com/api/batches?project=AAV9-PT',
    )
    expect(network.calls[0].headers.authorization).toBe(`Bearer ${SECRET}`)

    const kept = await stored(runId)
    expect(kept).toHaveLength(1)
    expect(kept[0]).toMatchObject({
      step_name: 'titres',
      method: 'GET',
      status: 200,
    })
    expect(JSON.parse(kept[0].body).items).toHaveLength(2)

    // The log says where the call went, not what it asked, and never the secret.
    const log = logs.find((l) => l.stage === 'web_call')
    expect(log?.message).toBe('Web call step 1 completed.')
    expect(JSON.stringify(log?.detail)).not.toContain('project')
    expect(JSON.stringify(logs)).not.toContain(SECRET)

    const manifest = await manifestOf(runId)
    expect(JSON.stringify(manifest)).not.toContain(SECRET)
    expect(manifest.responses).toEqual([
      expect.objectContaining({
        step: 'titres',
        method: 'GET',
        url: 'https://lims.example.com/api/batches',
        status: 200,
        requestDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
        bodyDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    ])
    // The manifest holds digests, not the answer.
    expect(JSON.stringify(manifest)).not.toContain('"titre"')
    expect(
      (manifest.steps as Array<{ name: string; language: string }>)[0],
    ).toMatchObject({ name: 'titres', language: 'web_call' })
  })

  it('reads the recording when the run asks again from the top after a pause', async () => {
    network.calls = []
    const { report, runId } = await run([get, ask, tidy])
    expect(report.ok, JSON.stringify(report)).toBe(true)
    expect(report.run?.status).toBe('waiting')
    expect(network.calls).toHaveLength(1)
    // Recorded at the pause, so resuming has it.
    expect(await stored(runId)).toHaveLength(1)

    const { deps, close } = await makeExecDeps(OWNER, {
      ...webDeps(),
      fetch: (async () => {
        throw new Error('must not ask again')
      }) as typeof fetch,
    })
    const resumed = await resumePipelineRun(
      OWNER,
      runId,
      { decision: 'confirm', values: { unit: 'AU' } },
      deps,
    )
    await close()
    expect(resumed.ok, JSON.stringify(resumed)).toBe(true)
    expect(resumed.run?.status).toBe('succeeded')
    expect(await stored(runId)).toHaveLength(1)
    expect((await manifestOf(runId)).responses).toHaveLength(1)
  })

  it('reproduces from the recording without asking', async () => {
    const { runId } = await run([get, tidy])
    network.calls = []
    const { deps, close } = await makeExecDeps(OWNER, {
      ...webDeps(),
      fetch: (async () => {
        throw new Error('a reproduction must not ask')
      }) as typeof fetch,
    })
    const report = await reproducePipelineRun(OWNER, { runId }, deps)
    await close()
    expect(report.ok, JSON.stringify(report)).toBe(true)
    expect(report.reproduction?.status).toBe('matches')
    expect(network.calls).toHaveLength(0)
  })

  it('a try sends a GET and keeps nothing; a POST waits for a recording', async () => {
    const trial = (steps: Array<Record<string, unknown>>) =>
      makeExecDeps(OWNER).then(async ({ deps, close }) => {
        const report = await tryPipelineDraft(
          OWNER,
          {
            workspaceId: WS,
            configuration: config(steps),
            inputVersions: { measurements: inputDatasetVersionId },
            parameters: { project: 'AAV9-PT' },
          },
          deps,
        )
        await close()
        return report
      })

    const before = await countRecordings()
    network.calls = []
    const got = await trial([get, tidy])
    expect(got.ok, JSON.stringify(got)).toBe(true)
    expect(network.calls).toHaveLength(1)
    expect(await countRecordings()).toBe(before)

    network.calls = []
    const refused = await trial([post, tidy])
    expect(refused.ok).toBe(false)
    expect(refused.errorMessage).toContain('A try does not send a POST')
    expect(network.calls).toHaveLength(0)

    // Once a run has sent that POST and recorded the answer, a try can use it.
    const sent = await run([post, tidy])
    expect(sent.report.ok, JSON.stringify(sent.report)).toBe(true)
    expect(network.calls).toHaveLength(1)
    expect(network.calls[0].body).toBe('{"project":"AAV9-PT"}')
    network.calls = []
    const tried = await trial([post, tidy])
    expect(tried.ok, JSON.stringify(tried)).toBe(true)
    expect(network.calls).toHaveLength(0)
  })

  it('stops with a plain message when the other system fails, and writes nothing', async () => {
    network.calls = []
    network.answer = () => new Response('down', { status: 503 })
    const { report, runId } = await run([get, tidy])
    network.answer = goodAnswer
    expect(report.ok).toBe(false)
    expect(report.errorMessage).toContain(
      'Web call step titres: LIMS answered 503.',
    )
    // The first call and three retries.
    expect(network.calls).toHaveLength(4)
    expect(await stored(runId)).toHaveLength(0)
    expect(JSON.stringify(report)).not.toContain(SECRET)
  })

  it('stops when the connection has no such secret', async () => {
    network.answer = goodAnswer
    const { report } = await run([
      { ...get, webCall: { ...get.webCall, secret: 'OTHER' } },
      tidy,
    ])
    expect(report.ok).toBe(false)
    expect(report.errorMessage).toContain('has no secret called “OTHER”')
  })
})

describe('the version check', () => {
  const owner = () => ownerActor()

  const save = async (steps: Array<Record<string, unknown>>) =>
    (await owner()).query(
      'select api.create_pipeline_definition_version($1, $2, $3::jsonb)',
      [WS, definitionId, JSON.stringify(config(steps))],
    )

  it('refuses a call without a connection, with another method or a path that does not start with /', async () => {
    for (const webCall of [
      { ...get.webCall, connection: 'Not A Key' },
      { ...get.webCall, method: 'DELETE' },
      { ...get.webCall, path: 'batches' },
      { ...get.webCall, secret: 'has space' },
      { ...get.webCall, method: 'GET', body: { a: 1 } },
    ])
      await expect(save([{ ...get, webCall }, tidy])).rejects.toThrow()
  })

  it('accepts the call, so a version holding one can be saved', async () => {
    await expect(save([get, tidy])).resolves.toBeDefined()
  })
})

describe('connections', () => {
  const create = (
    client: Client,
    key: string,
    url = 'https://lims.example.com/api',
  ) =>
    rpc<{ id: string; key: string; base_url: string; secret_names: string[] }>(
      client,
      'create_pipeline_connection',
      {
        p_workspace_id: WS,
        p_key: key,
        p_name: key.toUpperCase(),
        p_base_url: url,
      },
    )

  it('an owner makes one, and everyone in the workspace can read it, never its secrets', async () => {
    const made = await create(await ownerActor(), 'lims')
    expect(made.base_url).toBe('https://lims.example.com/api')
    expect(made.secret_names).toEqual([])
    const reader = await actor(SCIENTIST, WS)
    const { rows } = await reader.query(
      'select key, base_url, secret_names from api.pipeline_connections',
    )
    expect(rows).toHaveLength(1)
    await expect(
      reader.query('select * from internal.pipeline_connection_secrets'),
    ).rejects.toThrow()
  })

  it('a scientist may not manage connections', async () => {
    await expect(create(await actor(SCIENTIST, WS), 'other')).rejects.toThrow(
      /permission|capability|42501|SB/i,
    )
  })

  it('refuses an address that is not https or carries a password', async () => {
    const owner = await ownerActor()
    await expect(
      create(owner, 'plain', 'http://lims.example.com'),
    ).rejects.toThrow()
    await expect(
      create(owner, 'creds', 'https://user:pw@lims.example.com'),
    ).rejects.toThrow()
    await expect(
      create(owner, 'query', 'https://lims.example.com/api?key=1'),
    ).rejects.toThrow()
  })

  it('says so in the change events a webhook can follow', async () => {
    const { rows } = await migrator.query<{ operation: string }>(
      `select operation from api.change_events
        where workspace_id = $1 and entity_type = 'pipeline_connection' order by sequence`,
      [WS],
    )
    expect(rows.map((r) => r.operation)).toContain('create')
  })

  it('will not delete a connection a published pipeline calls, but switches off', async () => {
    const owner = await ownerActor()
    const { rows } = await owner.query<{ id: string }>(
      `select id from api.pipeline_connections where key = 'lims'`,
    )
    const id = rows[0].id
    await publishVersion(owner, 'calls-lims', config([get, tidy]))
    await expect(
      rpc(owner, 'delete_pipeline_connection', {
        p_workspace_id: WS,
        p_connection_id: id,
      }),
    ).rejects.toThrow(/published pipeline calls this connection/)
    const off = await rpc<{ status: string }>(
      owner,
      'update_pipeline_connection',
      {
        p_workspace_id: WS,
        p_connection_id: id,
        p_name: null,
        p_base_url: null,
        p_description: null,
        p_status: 'off',
      },
    )
    expect(off.status).toBe('off')
  })
})
