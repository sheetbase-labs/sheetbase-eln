/**
 * PLAT-05 — connector benchmarks (S3 + PostgreSQL source imports).
 *
 * Measures the real enterprise connector adapters against local deterministic
 * fixtures: an in-process S3-compatible HTTP backend (real SDK + SigV4) and an
 * isolated source PostgreSQL database in the local cluster. No external or
 * paid dependency.
 *
 * Each import runs the governed connector execution path (start run → bounded
 * source read → parse → map → validate → canonical commit → complete) and
 * reports per-stage timings read back from the run's durable stage logs.
 */
import './lib/loadenv'
import { Client } from 'pg'
import type { Server } from 'node:http'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'

import { s3Adapter } from '#/lib/connectors/enterprise/s3.server'
import { postgresAdapter } from '#/lib/connectors/enterprise/postgres.server'
import {
  sealSecret,
  deriveConnectorSecretKey,
} from '#/lib/connector-secrets.server'
import { datasetFieldsFromColumns } from '#/lib/import-mapping'
import type { DataClient } from '#/lib/data-client'
import type { ScientificColumnWire } from '#/lib/scientific-sheet-data'
import type { ConnectorAdapterContext } from '#/lib/connectors/enterprise/adapter'
import type { ConnectorWire } from '#/lib/connectors/types'

import {
  actorClient,
  adminClient,
  assertPerfEnvironment,
  environmentSnapshot,
  recordScenario,
  statsFor,
  writeReport,
} from './lib/common'
import type { ScenarioReport } from './lib/common'
import { FIXTURE } from './fixtures'

const SOURCE_DB = 'sheetbase_perf_source'
const SOURCE_ROLE = 'perf_source'

interface ConnectorState {
  admin: Client
  actor: Client
  env: ReturnType<typeof assertPerfEnvironment>
  projectId: string
  schemaVersionId: string
  fields: ReturnType<typeof datasetFieldsFromColumns>
}

/** Import-target schema fields shared by both connectors. */
const IMPORT_FIELDS: Array<{
  key: string
  label: string
  logicalType: string
  nullable: boolean
}> = [
  { key: 'sample', label: 'Sample', logicalType: 'text', nullable: false },
  { key: 'value', label: 'Value', logicalType: 'decimal', nullable: true },
  {
    key: 'observed_on',
    label: 'Observed on',
    logicalType: 'timestamp',
    nullable: true,
  },
  { key: 'batch', label: 'Batch', logicalType: 'text', nullable: true },
]

// ---------------------------------------------------------------------------
// Governed RPC surface over the actor connection (same pattern as INT-03).
// ---------------------------------------------------------------------------
function pgDataClient(owner: Client): DataClient {
  return {
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === 'validate_dataset_row_batch') {
        return (
          await owner.query(
            `select api.validate_dataset_row_batch($1,$2,$3::jsonb) result`,
            [
              args.p_dataset_id,
              args.p_expected_dataset_revision,
              JSON.stringify(args.p_rows),
            ],
          )
        ).rows[0].result
      }
      if (name === 'commit_dataset_row_batch') {
        return (
          await owner.query(
            `select api.commit_dataset_row_batch($1,$2,$3::jsonb,$4) result`,
            [
              args.p_dataset_id,
              args.p_expected_dataset_revision,
              JSON.stringify(args.p_rows),
              args.p_idempotency_key,
            ],
          )
        ).rows[0].result
      }
      const values = Object.values(args).map((value) =>
        value !== null && typeof value === 'object' && !Array.isArray(value)
          ? JSON.stringify(value)
          : value,
      )
      const placeholders = Object.values(args)
        .map((value, index) =>
          value !== null && typeof value === 'object'
            ? `$${index + 1}::jsonb`
            : `$${index + 1}`,
        )
        .join(',')
      return (
        await owner.query(`select * from api.${name}(${placeholders})`, values)
      ).rows[0]
    },
    list: async <T>(resource: string, query: string): Promise<T[]> => {
      if (resource !== 'connector_runs') {
        throw new Error(`unexpected list resource ${resource}`)
      }
      const params = new URLSearchParams(query.replace(/^\?/, ''))
      const conditions: string[] = []
      const values: unknown[] = []
      for (const column of [
        'connector_id',
        'request_digest',
        'selector_digest',
        'status',
      ] as const) {
        const raw = params.get(column)
        if (raw !== null) {
          values.push(raw.replace(/^eq\./, ''))
          conditions.push(`${column} = $${values.length}`)
        }
      }
      const limit = params.get('limit') ?? '1'
      const result = await owner.query(
        `select id, attempt, request_digest, selector_digest, status, retry_of_run_id, result, error_code, error_message,
                trigger_kind, workspace_id, started_at, finished_at
         from api.connector_runs
         ${conditions.length ? `where ${conditions.join(' and ')}` : ''}
         order by started_at desc limit ${Number(limit)}`,
        values,
      )
      return result.rows as T[]
    },
    insert: async <T>(
      resource: string,
      row: Record<string, unknown>,
    ): Promise<T> => {
      if (resource !== 'datasets') {
        throw new Error(`unexpected insert resource ${resource}`)
      }
      const result = await owner.query(
        `insert into api.datasets(workspace_id,schema_version_id,name,description,primary_project_id)
         values($1,$2,$3,$4,$5) returning id, name, revision`,
        [
          row.workspace_id,
          row.schema_version_id,
          row.name,
          row.description ?? null,
          row.primary_project_id ?? null,
        ],
      )
      return result.rows[0] as T
    },
    count: async () => 0,
    patch: async () => [],
    remove: async () => [],
  } as unknown as DataClient
}

async function readFileObject(
  admin: Client,
  workspaceId: string,
  recordId: string,
): Promise<{
  id: string
  storage_key: string
  status: string
  version: number
} | null> {
  const rows = (
    await admin.query(
      `select id, storage_key, status, version from api.file_objects
        where record_id=$1 and workspace_id=$2 limit 1`,
      [recordId, workspaceId],
    )
  ).rows
  return rows[0] ?? null
}

async function adapterContext(input: {
  state: ConnectorState
  connectorId: string
  secrets: Record<string, string>
  limits: Record<string, number>
}): Promise<ConnectorAdapterContext> {
  const { state } = input
  const rows = (
    await state.admin.query(
      `select config from api.connectors where id=$1 and workspace_id=$2`,
      [input.connectorId, FIXTURE.workspace],
    )
  ).rows
  const config = (rows[0]?.config ?? {}) as Record<string, unknown>
  const connector: ConnectorWire = {
    id: input.connectorId,
    workspace_id: FIXTURE.workspace,
    key: 'perf',
    name: 'PLAT-05 perf connector',
    connector_type: 'storage',
    direction: 'inbound',
    status: 'active',
    parser_id: null,
    config,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  return {
    client: pgDataClient(state.actor),
    workspaceId: FIXTURE.workspace,
    connector,
    limits: {
      previewRows: input.limits.previewRows,
      importRows: input.limits.importRows,
      maxObjectBytes: input.limits.maxObjectBytes,
    },
    secrets: input.secrets,
    token: '',
    readFileObject: (ws, recordId) => readFileObject(state.admin, ws, recordId),
  }
}

function secretKey(): Buffer {
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret) throw new Error('BETTER_AUTH_SECRET is required')
  return deriveConnectorSecretKey(secret)
}

async function sealAndStore(
  admin: Client,
  connectorId: string,
  name: string,
  value: string,
): Promise<void> {
  const sealed = sealSecret(value, secretKey())
  await admin.query(
    `insert into internal.connector_secrets(workspace_id,connector_id,secret_name,ciphertext)
     values($1,$2,$3,$4)`,
    [FIXTURE.workspace, connectorId, name, Buffer.from(sealed, 'utf8')],
  )
}

async function setup(
  env: ReturnType<typeof assertPerfEnvironment>,
): Promise<ConnectorState> {
  const admin = await adminClient(env.migrationDatabaseUrl)
  const actor = await actorClient(
    env.pgrstDatabaseUrl,
    FIXTURE.user,
    FIXTURE.workspace,
  )
  // Project for S3 byte retention.
  const project = (
    await actor.query(
      `insert into api.projects(workspace_id,key,title)
       values($1,$2,'PLAT-05 connector retention')
       on conflict (workspace_id, key) do update set title = excluded.title
       returning id`,
      [FIXTURE.workspace, `plat05-perf-${randomUUID().slice(0, 8)}`],
    )
  ).rows[0]
  // Import-target schema version + fields.
  const schema = (
    await actor.query(
      `insert into api.dataset_schema_definitions(workspace_id,key,name,created_by_user_id)
       values($1,$2,'PLAT-05 connector import',$3) returning id`,
      [
        FIXTURE.workspace,
        `plat05_connector_${randomUUID().slice(0, 8)}`,
        FIXTURE.user,
      ],
    )
  ).rows[0]
  const version = (
    await actor.query(
      `insert into api.dataset_schema_versions(schema_id,version,lifecycle,created_by_user_id)
       values($1,1,'draft',$2) returning id`,
      [schema.id, FIXTURE.user],
    )
  ).rows[0]
  await actor.query(
    `insert into api.dataset_schema_version_fields(
       schema_version_id,field_id,key,label,logical_type,nullable,display_order
     )
     select $1, gen_random_uuid(), item->>'key', item->>'label', item->>'logicalType',
       (item->>'nullable')::boolean, ordinality::integer
     from jsonb_array_elements($2::jsonb) with ordinality source(item, ordinality)`,
    [version.id, JSON.stringify(IMPORT_FIELDS)],
  )
  await actor.query(
    `update api.dataset_schema_versions set lifecycle='active',published_at=now() where id=$1`,
    [version.id],
  )
  const fields = (
    await admin.query<{
      field_id: string
      key: string
      label: string
      logical_type: string
      nullable: boolean
      display_order: number
    }>(
      `select field_id, key, label, logical_type, nullable, display_order
         from api.dataset_schema_version_fields where schema_version_id=$1 order by display_order`,
      [version.id],
    )
  ).rows
  const columns: ScientificColumnWire[] = fields.map((field) => ({
    id: field.field_id,
    field_name: field.key,
    label: field.label,
    display_order: field.display_order,
    logical_type: field.logical_type as ScientificColumnWire['logical_type'],
    nullable: field.nullable,
    unit: null,
    validation: {},
    width: null,
    options: [],
  }))
  return {
    admin,
    actor,
    env,
    projectId: project.id,
    schemaVersionId: version.id,
    fields: datasetFieldsFromColumns(columns),
  }
}

// ---------------------------------------------------------------------------
// Stage timings from the durable run logs.
// ---------------------------------------------------------------------------
async function stageDurations(
  admin: Client,
  runId: string,
): Promise<{ stages: Record<string, number>; totalMs: number } | null> {
  const run = (
    await admin.query<{ started_at: string; finished_at: string | null }>(
      `select started_at, finished_at from api.connector_runs where id=$1`,
      [runId],
    )
  ).rows[0]
  if (!run.finished_at) return null
  const logs = (
    await admin.query<{ stage: string; at: number; sequence: number }>(
      `select stage, extract(epoch from at)::float8 * 1000 as at, sequence
         from api.connector_run_logs where run_id=$1 order by sequence`,
      [runId],
    )
  ).rows
  const at = (stage: string) =>
    logs.find((log) => log.stage === stage)?.at ?? null
  const start = (
    await admin.query<{ t: number }>(
      `select extract(epoch from started_at)::float8 * 1000 as t
         from api.connector_runs where id=$1`,
      [runId],
    )
  ).rows[0].t
  const end = (
    await admin.query<{ t: number }>(
      `select extract(epoch from finished_at)::float8 * 1000 as t
         from api.connector_runs where id=$1`,
      [runId],
    )
  ).rows[0].t
  const sourceAt = at('source')
  const parseAt = at('parse')
  const mapAt = at('map')
  const commitAt = at('commit')
  const stages: Record<string, number> = {}
  if (sourceAt !== null && parseAt !== null)
    stages.sourceReadMs = Math.max(0, parseAt - sourceAt)
  if (mapAt !== null && commitAt !== null)
    stages.mappingValidationMs = Math.max(0, commitAt - mapAt)
  if (commitAt !== null) stages.commitMs = Math.max(0, end - commitAt)
  stages.totalMs = Math.max(0, end - start)
  return { stages, totalMs: stages.totalMs }
}

// ---------------------------------------------------------------------------
// In-process S3-compatible backend (real SDK traffic, SigV4 included).
// ---------------------------------------------------------------------------
const S3_OBJECTS: Record<string, { body: Buffer; contentType: string }> = {}

function startS3Server(): Promise<Server> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    const path = url.pathname.replace(/\/+$/, '') || '/'
    const respond = (
      status: number,
      body: string,
      type = 'application/xml',
    ) => {
      response.writeHead(status, { 'content-type': type })
      response.end(body)
    }
    if (request.method === 'HEAD' && path === '/perf-bucket') {
      response.writeHead(200).end()
      return
    }
    if (request.method === 'GET' && path === '/perf-bucket') {
      const prefix = url.searchParams.get('prefix') ?? ''
      const maxKeys = Number(url.searchParams.get('max-keys') ?? '1000')
      const token = url.searchParams.get('continuation-token') ?? ''
      const keys = Object.keys(S3_OBJECTS)
        .filter((key) => key.startsWith(prefix))
        .sort()
      const start = token ? Number(Buffer.from(token, 'base64').toString()) : 0
      const slice = keys.slice(start, start + maxKeys)
      const truncated = start + maxKeys < keys.length
      const nextToken = truncated
        ? Buffer.from(String(start + maxKeys)).toString('base64')
        : ''
      const contents = slice
        .map(
          (key) =>
            `<Contents><Key>${key}</Key><Size>${S3_OBJECTS[key].body.length}</Size>` +
            `<LastModified>2026-01-01T00:00:00.000Z</LastModified>` +
            `<ETag>"etag-${key.replace(/[^a-z0-9]/gi, '')}"</ETag></Contents>`,
        )
        .join('')
      respond(
        200,
        `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">` +
          `<Name>perf-bucket</Name><Prefix>${prefix}</Prefix><IsTruncated>${truncated}</IsTruncated>` +
          (nextToken
            ? `<NextContinuationToken>${nextToken}</NextContinuationToken>`
            : '') +
          contents +
          `</ListBucketResult>`,
      )
      return
    }
    const objectKey = path.replace(/^\/perf-bucket\//, '')
    const decodedKey = decodeURIComponent(objectKey)
    if (request.method === 'GET' && Object.hasOwn(S3_OBJECTS, decodedKey)) {
      const object = S3_OBJECTS[decodeURIComponent(objectKey)]
      response.writeHead(200, {
        'content-type': object.contentType,
        etag: `"etag-${objectKey.replace(/[^a-z0-9]/gi, '')}"`,
      })
      response.end(object.body)
      return
    }
    respond(404, `<?xml version="1.0"?><Error><Code>NoSuchKey</Code></Error>`)
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

// ---------------------------------------------------------------------------
// PostgreSQL source database with deterministic fixtures.
// ---------------------------------------------------------------------------
async function createSourceDatabase(rows: number): Promise<string> {
  const baseUrl = new URL(assertPerfEnvironment().databaseUrl)
  const admin = new Client({ connectionString: baseUrl.toString() })
  await admin.connect()
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${SOURCE_DB} WITH (FORCE)`)
    await admin.query(
      `select pg_terminate_backend(pid) from pg_stat_activity where usename='${SOURCE_ROLE}'`,
    )
    await admin.query(`DROP ROLE IF EXISTS ${SOURCE_ROLE}`)
    await admin.query(
      `CREATE ROLE ${SOURCE_ROLE} LOGIN PASSWORD 'perf-source-pass'`,
    )
    await admin.query(`CREATE DATABASE ${SOURCE_DB}`)
  } finally {
    await admin.end()
  }
  const sourceUrl = new URL(baseUrl.toString())
  sourceUrl.pathname = `/${SOURCE_DB}`
  const source = new Client({ connectionString: sourceUrl.toString() })
  await source.connect()
  await source.query(`
    create table measurements (
      sample text primary key,
      value numeric not null,
      observed_on date,
      batch text
    );
    insert into measurements(sample, value, observed_on, batch)
    select 'S-' || lpad(i::text, 8, '0'),
           (i * 1.5)::numeric,
           date '2024-01-01' + (i % 365),
           'B-' || (i % 20)
    from generate_series(1, ${rows}) i;
    grant usage on schema public to ${SOURCE_ROLE};
    grant select on all tables in schema public to ${SOURCE_ROLE};
  `)
  await source.end()
  const connectorUrl = new URL(sourceUrl.toString())
  connectorUrl.username = SOURCE_ROLE
  connectorUrl.password = 'perf-source-pass'
  return connectorUrl.toString()
}

// ---------------------------------------------------------------------------
// Benchmark bodies.
// ---------------------------------------------------------------------------
async function benchmarkConnector(
  state: ConnectorState,
  scenarios: ScenarioReport[],
  kind: 'postgres' | 's3',
  rows: number,
  context: ConnectorAdapterContext,
): Promise<void> {
  const label = rows >= 1000 ? `${Math.round(rows / 1000)}k` : String(rows)
  const ingest = (request: unknown) =>
    kind === 'postgres'
      ? postgresAdapter.ingest(
          context,
          postgresAdapter.parseConfig(context.connector.config),
          request as never,
        )
      : s3Adapter.ingest(
          context,
          s3Adapter.parseConfig(context.connector.config),
          request as never,
        )
  const preview = (selector: unknown) =>
    kind === 'postgres'
      ? postgresAdapter.preview(
          context,
          postgresAdapter.parseConfig(context.connector.config),
          selector as never,
        )
      : s3Adapter.preview(
          context,
          s3Adapter.parseConfig(context.connector.config),
          selector as never,
        )

  // Preview (bounded source read).
  const previewSamples: number[] = []
  for (let i = 0; i < 3; i += 1) {
    const t0 = Date.now()
    await preview(
      kind === 'postgres'
        ? { schema: 'public', table: 'measurements' }
        : { key: `data/measurements-${label}.csv` },
    )
    previewSamples.push(Date.now() - t0)
  }
  scenarios.push(
    recordScenario({
      scenario: `connector-${kind}-preview-${label}`,
      rows,
      concurrency: 1,
      iterations: previewSamples.length,
      stats: statsFor(previewSamples),
      notes: { operation: 'preview', kind },
    }),
  )

  // Ingest (governed run) with per-stage timing from run logs. Each sample
  // targets a fresh output Dataset so every run is real work (an identical
  // request would replay the prior success by digest — measured separately).
  const samples: Array<{ total: number; stages: Record<string, number> }> = []
  const replaySamples: number[] = []
  let errors = 0
  for (let i = 0; i < 3; i += 1) {
    const target = {
      datasetId: null,
      expectedRevision: null,
      newDatasetName: `PLAT-05 ${kind} import ${label}-${i}`,
      schemaVersionId: state.schemaVersionId,
      fields: state.fields,
    }
    const request = {
      source:
        kind === 'postgres'
          ? { schema: 'public', table: 'measurements' }
          : { key: `data/measurements-${label}.csv` },
      projectId: state.projectId,
      target,
    }
    try {
      const t0 = Date.now()
      const result = await ingest(request)
      const totalMs = Date.now() - t0
      const timing = await stageDurations(state.admin, result.runId)
      if (!timing) throw new Error('connector run produced no timing logs')
      samples.push({ total: totalMs, stages: timing.stages })
    } catch {
      errors += 1
    }
  }
  // Dedupe/replay latency: the same request identity replays the prior success.
  try {
    const replayRequest = {
      source:
        kind === 'postgres'
          ? { schema: 'public', table: 'measurements' }
          : { key: `data/measurements-${label}.csv` },
      projectId: state.projectId,
      target: {
        datasetId: null,
        expectedRevision: null,
        newDatasetName: `PLAT-05 ${kind} import ${label}-0`,
        schemaVersionId: state.schemaVersionId,
        fields: state.fields,
      },
    }
    const t0 = Date.now()
    const result = await ingest(replayRequest)
    replaySamples.push(Date.now() - t0)
    if (!result.alreadyCompleted) errors += 1
  } catch {
    errors += 1
  }
  const pick = (key: string) => samples.map((s) => s.stages[key] ?? 0)
  for (const [stage, values] of Object.entries({
    source_read: pick('sourceReadMs'),
    mapping_validation: pick('mappingValidationMs'),
    canonical_commit: pick('commitMs'),
    total: pick('totalMs'),
  })) {
    scenarios.push(
      recordScenario({
        scenario: `connector-${kind}-ingest-${stage}-${label}`,
        rows,
        concurrency: 1,
        iterations: values.length,
        stats: statsFor(values, errors),
        notes: { operation: 'ingest', stage, kind },
      }),
    )
  }
  if (replaySamples.length > 0) {
    scenarios.push(
      recordScenario({
        scenario: `connector-${kind}-ingest-replay-${label}`,
        rows,
        concurrency: 1,
        iterations: replaySamples.length,
        stats: statsFor(replaySamples, errors),
        notes: { operation: 'ingest', stage: 'replay', kind },
      }),
    )
  }
}

async function postgresContext(
  state: ConnectorState,
): Promise<ConnectorAdapterContext> {
  const config = {
    adapter: 'postgres',
    host: 'localhost',
    port: Number(new URL(state.env.databaseUrl).port || 5432),
    database: SOURCE_DB,
    sslMode: 'disable',
    allowedSchemas: ['public'],
    import_rows: 100_000,
  }
  const connector = (
    await state.actor.query(
      `select * from api.register_connector($1,$2,$3,$4,$5,$6,$7)`,
      [
        FIXTURE.workspace,
        `perf-pg-${randomUUID().slice(0, 8)}`,
        'PLAT-05 postgres',
        'database',
        'inbound',
        JSON.stringify(config),
        null,
      ],
    )
  ).rows[0]
  await sealAndStore(state.admin, connector.id, 'username', SOURCE_ROLE)
  await sealAndStore(state.admin, connector.id, 'password', 'perf-source-pass')
  return adapterContext({
    state,
    connectorId: connector.id,
    secrets: {
      username: SOURCE_ROLE,
      password: 'perf-source-pass',
    },
    limits: {
      previewRows: 100,
      importRows: 100_000,
      maxObjectBytes: 100 * 1024 * 1024,
    },
  })
}

async function s3Context(
  state: ConnectorState,
  endpoint = 'http://127.0.0.1:59998',
): Promise<ConnectorAdapterContext> {
  const config = {
    adapter: 's3',
    endpoint,
    bucket: 'perf-bucket',
    prefix: 'data/',
    forcePathStyle: true,
    import_rows: 100_000,
  }
  const connector = (
    await state.actor.query(
      `select * from api.register_connector($1,$2,$3,$4,$5,$6,$7)`,
      [
        FIXTURE.workspace,
        `perf-s3-${randomUUID().slice(0, 8)}`,
        'PLAT-05 s3',
        'storage',
        'inbound',
        JSON.stringify(config),
        null,
      ],
    )
  ).rows[0]
  await sealAndStore(state.admin, connector.id, 'access_key_id', 'AKIA-TEST')
  await sealAndStore(
    state.admin,
    connector.id,
    'secret_access_key',
    'shhh-very-secret-value',
  )
  return adapterContext({
    state,
    connectorId: connector.id,
    secrets: {
      access_key_id: 'AKIA-TEST',
      secret_access_key: 'shhh-very-secret-value',
    },
    limits: {
      previewRows: 100,
      importRows: 100_000,
      maxObjectBytes: 100 * 1024 * 1024,
    },
  })
}

function csvFor(rows: number): string {
  const lines = ['sample,value,observed_on,batch']
  for (let i = 1; i <= rows; i += 1) {
    lines.push(
      `S-${String(i).padStart(8, '0')},${i * 1.5},2024-${String((i % 12) + 1).padStart(2, '0')}-01T00:00:00.000Z,B-${i % 20}`,
    )
  }
  return lines.join('\n')
}

async function cleanup(
  state: ConnectorState,
  s3Server: Server | null,
): Promise<void> {
  if (s3Server) await s3Server.close()
  const admin = state.admin
  await admin.query(
    `delete from api.connector_run_logs where run_id in
       (select id from api.connector_runs where workspace_id=$1)`,
    [FIXTURE.workspace],
  )
  await admin.query(`delete from api.connector_runs where workspace_id=$1`, [
    FIXTURE.workspace,
  ])
  await admin.query(
    `delete from internal.connector_secrets where connector_id in
       (select id from api.connectors where workspace_id=$1)`,
    [FIXTURE.workspace],
  )
  await admin.query(
    `delete from api.connectors where workspace_id=$1 and key like 'perf-%'`,
    [FIXTURE.workspace],
  )
  // Output Datasets + immutable versions created by the imports.
  await admin.query(`delete from api.file_objects where workspace_id=$1`, [
    FIXTURE.workspace,
  ])
  await admin.query(
    `delete from api.dataset_bulk_commits where workspace_id=$1
       and idempotency_key like 'connector-run-%'`,
    [FIXTURE.workspace],
  )
  await admin.query(
    `alter table api.dataset_versions disable trigger prevent_dataset_version_mutation`,
  )
  await admin.query(
    `alter table api.dataset_version_rows disable trigger prevent_dataset_version_row_mutation`,
  )
  await admin.query(
    `alter table api.dataset_version_values disable trigger prevent_dataset_version_value_mutation`,
  )
  try {
    await admin.query(
      `delete from api.dataset_version_values where dataset_version_id in
       (select id from api.dataset_versions where workspace_id=$1
          and label like 'pipeline output')`,
      [FIXTURE.workspace],
    )
    await admin.query(
      `delete from api.dataset_version_rows where dataset_version_id in
       (select id from api.dataset_versions where workspace_id=$1
          and label like 'pipeline output')`,
      [FIXTURE.workspace],
    )
    await admin.query(
      `delete from api.dataset_versions where workspace_id=$1
       and label like 'pipeline output'`,
      [FIXTURE.workspace],
    )
  } finally {
    await admin.query(
      `alter table api.dataset_version_values enable trigger prevent_dataset_version_value_mutation`,
    )
    await admin.query(
      `alter table api.dataset_version_rows enable trigger prevent_dataset_version_row_mutation`,
    )
    await admin.query(
      `alter table api.dataset_versions enable trigger prevent_dataset_version_mutation`,
    )
  }
  await admin.query(
    `delete from api.datasets where workspace_id=$1
       and name like 'PLAT-05 % import %'`,
    [FIXTURE.workspace],
  )
  const baseUrl = new URL(state.env.databaseUrl)
  const superuser = new Client({ connectionString: baseUrl.toString() })
  await superuser.connect()
  try {
    await superuser.query(`DROP DATABASE IF EXISTS ${SOURCE_DB} WITH (FORCE)`)
    await superuser.query(`DROP ROLE IF EXISTS ${SOURCE_ROLE}`)
  } finally {
    await superuser.end()
  }
  await state.actor.end().catch(() => {})
  await state.admin.end().catch(() => {})
}

export async function runConnectorBenchmarks(): Promise<ScenarioReport[]> {
  const env = assertPerfEnvironment()
  const state = await setup(env)
  console.log('connector: setup complete')
  const scenarios: ScenarioReport[] = []
  let s3Server: Server | null = null
  try {
    // Deterministic source fixtures. S3 objects stay within the delimited
    // parser's 1000-row import cap (the product limit); the PostgreSQL source
    // scales to 10k/50k rows.
    S3_OBJECTS['data/measurements-500.csv'] = {
      body: Buffer.from(csvFor(500)),
      contentType: 'text/csv',
    }
    S3_OBJECTS['data/measurements-1k.csv'] = {
      body: Buffer.from(csvFor(1000)),
      contentType: 'text/csv',
    }
    s3Server = await startS3Server()
    const address = s3Server.address()
    const endpoint = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
    console.log(`connector: s3 server at ${endpoint}`)

    const pgContext = await postgresContext(state)
    const s3ctx = await s3Context(state, endpoint)
    console.log('connector: contexts ready')

    for (const rows of [10_000, 50_000]) {
      await createSourceDatabase(rows)
      console.log(`connector: source db seeded at ${rows} rows`)
      await benchmarkConnector(state, scenarios, 'postgres', rows, pgContext)
      console.log(`connector: postgres ${rows} done`)
    }
    for (const rows of [500, 1000]) {
      await benchmarkConnector(state, scenarios, 's3', rows, s3ctx)
      console.log(`connector: s3 ${rows} done`)
    }
    const admin = state.admin
    const environment = await environmentSnapshot(admin)
    writeReport('connectors', scenarios, environment, {
      source:
        'postgres: sheetbase_perf_source.measurements / s3: in-process backend',
      fixtures: '10k and 50k deterministic rows',
    })
    return scenarios
  } finally {
    await cleanup(state, s3Server).catch(() => {})
  }
}

if (process.argv[1]?.endsWith('perf/connectors.ts')) {
  void runConnectorBenchmarks().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
