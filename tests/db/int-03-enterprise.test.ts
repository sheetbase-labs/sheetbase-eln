/**
 * INT-03 — Enterprise / data-platform connector proof (S3 + PostgreSQL).
 *
 * Proves the INT-01 framework carries enterprise connectors end-to-end:
 *
 *  S3 (against an in-process S3-compatible HTTP backend — real SDK, real
 *  SigV4 requests):
 *    - connection test; invalid credentials fail safely;
 *    - bounded discovery with pagination + prefix filtering;
 *    - import retains raw object bytes through the canonical file platform
 *      (fileRecordId + sha256), lands rows only via validate/commit batch
 *      RPCs, and stamps bucket/key/version/etag provenance into the run;
 *    - changed content under the same key is a NEW request identity;
 *    - identical content replays the prior successful run;
 *    - failed import leaves the Dataset untouched; retry is a linked attempt;
 *    - oversized objects fail with row_limit_exceeded;
 *    - secret plaintext never appears in run results or stage logs.
 *
 *  PostgreSQL (against an isolated source database in the test cluster):
 *    - connection test; unreachable source fails safely;
 *    - schema/table/view/column discovery, system schemas hidden;
 *    - identifier quoting rejects non-plain names (no SQL injection surface);
 *    - no arbitrary SQL or write path exists on the adapter;
 *    - bounded preview and import row cap (row_limit_exceeded);
 *    - import lands rows via canonical RPCs with full source provenance;
 *    - a changed source (new rows) produces a NEW request identity.
 */
import { Client } from 'pg'
import type { Server } from 'node:http'
import { createServer } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import '#/lib/connectors/enterprise/s3.server'
import { s3Adapter } from '#/lib/connectors/enterprise/s3.server'
import { postgresAdapter } from '#/lib/connectors/enterprise/postgres.server'
import { sealSecret } from '#/lib/connector-secrets.server'
import { deriveConnectorSecretKey } from '#/lib/connector-secrets.server'
import type { DataClient } from '#/lib/data-client'
import { datasetFieldsFromColumns } from '#/lib/import-mapping'
import type { ImportTargetField } from '#/lib/import-mapping'
import type { ScientificColumnWire } from '#/lib/scientific-sheet-data'

import { prepareTestDatabase } from './helpers'

const required = (name: string): string => {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required for database tests.`)
  return value
}

const WS_A = '0e030000-0000-4000-8000-000000000001'
const OWNER_A = 'int03-owner-a'
const SOURCE_DB = 'sheetbase_int03_source'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function actor(userId: string, workspaceId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({
      role: 'authenticated',
      sub: userId,
      workspace_id: workspaceId,
    }),
  ])
  return client
}

// ---------------------------------------------------------------------------
// Governed RPC surface over raw SQL (same pattern as int-connectors proof).
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
      if (name === 'commit_dataset_row_batch_atomic') {
        return (
          await owner.query(
            `select api.commit_dataset_row_batch_atomic($1,$2,$3::jsonb,$4) result`,
            [
              args.p_dataset_id,
              args.p_expected_dataset_revision,
              JSON.stringify(args.p_rows),
              args.p_idempotency_key,
            ],
          )
        ).rows[0].result
      }
      if (name === 'ensure_parser' || name === 'commit_dataset_import') {
        const entries = Object.entries(args)
        const parameters = entries
          .map(
            ([key, value], i) =>
              `${key} => $${i + 1}${value !== null && typeof value === 'object' ? '::jsonb' : ''}`,
          )
          .join(', ')
        const values = entries.map(([, value]) =>
          value !== null && typeof value === 'object'
            ? JSON.stringify(value)
            : value,
        )
        return (
          await owner.query(`SELECT api.${name}(${parameters}) result`, values)
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
      // Generic enough for the connector library's run lookups: equality
      // filters over connector_id / request_digest / selector_digest /
      // status, newest first, optional limit.
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
  workspaceId: string,
  recordId: string,
): Promise<{
  id: string
  storage_key: string
  status: string
  version: number
} | null> {
  const rows = (
    await migrator.query(
      `select id, storage_key, status, version from api.file_objects
        where record_id=$1 and workspace_id=$2 limit 1`,
      [recordId, workspaceId],
    )
  ).rows
  return rows[0] ?? null
}

/** Retained file objects in the workspace — replay must not grow this. */
async function countWorkspaceFiles(): Promise<number> {
  const rows = await migrator.query(
    `select count(*)::int n from api.file_objects where workspace_id=$1`,
    [WS_A],
  )
  return rows.rows[0].n as number
}

// ---------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------
function secretKey(): Buffer {
  return deriveConnectorSecretKey(required('BETTER_AUTH_SECRET'))
}

async function sealAndStore(
  connectorId: string,
  name: string,
  value: string,
): Promise<string> {
  const sealed = sealSecret(value, secretKey())
  await migrator.query(
    `insert into internal.connector_secrets(workspace_id,connector_id,secret_name,ciphertext)
     values($1,$2,$3,$4)`,
    [WS_A, connectorId, name, Buffer.from(sealed, 'utf8')],
  )
  return sealed
}

async function openStored(connectorId: string, name: string): Promise<string> {
  const rows = (
    await migrator.query(
      `select ciphertext from internal.connector_secrets
        where connector_id=$1 and secret_name=$2`,
      [connectorId, name],
    )
  ).rows
  // Same decryption path loadConnectorSecrets uses server-side.
  const { openSecret } = await import('#/lib/connector-secrets.server')
  return openSecret(
    Buffer.from(rows[0].ciphertext).toString('utf8'),
    secretKey(),
  )
}

async function createProjectFixture(owner: Client): Promise<string> {
  const project = (
    await owner.query(
      `insert into api.projects(workspace_id,key,title)
       values($1,$2,'INT-03 retention') returning id`,
      [WS_A, `int03-${crypto.randomUUID().slice(0, 8)}`],
    )
  ).rows[0]
  return project.id as string
}

async function createDatasetFixture(owner: Client) {
  const key = `int03_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`
  const schema = (
    await owner.query(
      `insert into api.dataset_schema_definitions(workspace_id,key,name)
       values($1,$2,'INT-03 fixture') returning id`,
      [WS_A, key],
    )
  ).rows[0]
  const version = (
    await owner.query(
      `insert into api.dataset_schema_versions(schema_id,version) values($1,1) returning id`,
      [schema.id],
    )
  ).rows[0]
  const fields = (
    await owner.query(
      `insert into api.dataset_schema_version_fields(schema_version_id,field_id,key,label,logical_type,nullable,display_order)
       values
       ($1,gen_random_uuid(),'sample','Sample','text',false,1),
       ($1,gen_random_uuid(),'value','Value','decimal',true,2)
       returning field_id,key,label,logical_type,nullable,display_order`,
      [version.id],
    )
  ).rows
  await owner.query(
    `update api.dataset_schema_versions set lifecycle='active',published_at=now() where id=$1`,
    [version.id],
  )
  const dataset = (
    await owner.query(
      `insert into api.datasets(workspace_id,schema_version_id,name)
       values($1,$2,'INT-03 fixture') returning id,revision,schema_version_id`,
      [WS_A, version.id],
    )
  ).rows[0]
  const columns: ScientificColumnWire[] = fields.map((field) => ({
    id: field.field_id,
    field_name: field.key,
    label: field.label,
    display_order: field.display_order,
    logical_type: field.logical_type,
    nullable: field.nullable,
    unit: null,
    validation: {},
    width: null,
    options: [],
  }))
  return {
    datasetId: dataset.id as string,
    revision: Number(dataset.revision),
    schemaVersionId: dataset.schema_version_id as string,
    fields: datasetFieldsFromColumns(columns) as ImportTargetField[],
  }
}

async function createValidatedDatasetFixture(owner: Client) {
  const key = `plat05_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`
  const schema = (
    await owner.query(
      `insert into api.dataset_schema_definitions(workspace_id,key,name)
       values($1,$2,'PLAT-05 atomic fixture') returning id`,
      [WS_A, key],
    )
  ).rows[0]
  const version = (
    await owner.query(
      `insert into api.dataset_schema_versions(schema_id,version) values($1,1) returning id`,
      [schema.id],
    )
  ).rows[0]
  const fields = (
    await owner.query(
      `insert into api.dataset_schema_version_fields(schema_version_id,field_id,key,label,logical_type,nullable,validation,display_order)
       values
       ($1,gen_random_uuid(),'sample','Sample','text',false,'{}'::jsonb,1),
       ($1,gen_random_uuid(),'value','Value','decimal',true,'{"min":0}'::jsonb,2)
       returning field_id,key,label,logical_type,nullable,display_order`,
      [version.id],
    )
  ).rows
  await owner.query(
    `update api.dataset_schema_versions set lifecycle='active',published_at=now() where id=$1`,
    [version.id],
  )
  const dataset = (
    await owner.query(
      `insert into api.datasets(workspace_id,schema_version_id,name)
       values($1,$2,'PLAT-05 atomic fixture') returning id,revision,schema_version_id`,
      [WS_A, version.id],
    )
  ).rows[0]
  const columns: ScientificColumnWire[] = fields.map((field) => ({
    id: field.field_id,
    field_name: field.key,
    label: field.label,
    display_order: field.display_order,
    logical_type: field.logical_type,
    nullable: field.nullable,
    unit: null,
    validation: {},
    width: null,
    options: [],
  }))
  return {
    datasetId: dataset.id as string,
    revision: Number(dataset.revision),
    schemaVersionId: dataset.schema_version_id as string,
    fields: datasetFieldsFromColumns(columns) as ImportTargetField[],
  }
}

function adapterContext(input: {
  connectorId: string
  config?: Record<string, unknown>
  secrets: Record<string, string>
  owner: Client
}) {
  return input.owner
    .query(
      `select config from api.connectors where id=$1 and workspace_id=$2`,
      [input.connectorId, WS_A],
    )
    .then(({ rows }) => {
      const registered = (rows[0]?.config ?? {}) as Record<string, unknown>
      const config = { ...registered, ...input.config }
      return {
        client: pgDataClient(input.owner),
        workspaceId: WS_A,
        connector: {
          id: input.connectorId,
          workspace_id: WS_A,
          key: 'int-03',
          name: 'INT-03',
          connector_type: 'storage',
          direction: 'inbound',
          status: 'active',
          parser_id: null,
          config,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        limits: {
          previewRows: Number(config['preview_rows'] ?? 100),
          importRows: Number(config['import_rows'] ?? 1000),
          maxObjectBytes: Number(config['max_object_bytes'] ?? 1024 * 1024),
        },
        secrets: input.secrets,
        token: '',
        readFileObject: readFileObject,
      }
    })
}

// ---------------------------------------------------------------------------
// In-process S3-compatible backend (real SDK traffic, SigV4 included).
// ---------------------------------------------------------------------------
const S3_OBJECTS: Record<string, { body: Buffer; contentType: string }> = {}

function startS3Server(): Promise<Server> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    const path = url.pathname.replace(/\/+$/, '') || '/'
    const auth = request.headers['authorization'] ?? ''
    const respond = (
      status: number,
      body: string,
      type = 'application/xml',
    ) => {
      response.writeHead(status, { 'content-type': type })
      response.end(body)
    }
    // Fail closed for rejected credentials so the auth failure is a real
    // HTTP 403 from an S3-compatible surface, not a local shortcut.
    if (auth.includes('Credential=invalid')) {
      respond(
        403,
        `<?xml version="1.0"?><Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>`,
      )
      return
    }
    if (request.method === 'HEAD' && path === '/test-bucket') {
      response.writeHead(200).end()
      return
    }
    if (request.method === 'GET' && path === '/test-bucket') {
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
          `<Name>test-bucket</Name><Prefix>${prefix}</Prefix><IsTruncated>${truncated}</IsTruncated>` +
          (nextToken
            ? `<NextContinuationToken>${nextToken}</NextContinuationToken>`
            : '') +
          contents +
          `</ListBucketResult>`,
      )
      return
    }
    const objectKey = path.replace(/^\/test-bucket\//, '')
    if (
      request.method === 'GET' &&
      objectKey &&
      S3_OBJECTS[decodeURIComponent(objectKey)]
    ) {
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
// Source database for the PostgreSQL connector.
// ---------------------------------------------------------------------------
async function createSourceDatabase(): Promise<{
  connectionString: string
  username: string
  password: string
  port: number
}> {
  const baseUrl = new URL(required('DATABASE_URL'))
  baseUrl.hostname = 'localhost'
  baseUrl.port = process.env['POSTGRES_PORT'] ?? '5432'
  const admin = new Client({ connectionString: baseUrl.toString() })
  await admin.connect()
  try {
    // Privileges inside the source database depend on the role, so the
    // database is dropped before the role on every fresh run.
    await admin.query(`DROP DATABASE IF EXISTS ${SOURCE_DB} WITH (FORCE)`)
    await admin.query(
      `select pg_terminate_backend(pid) from pg_stat_activity where usename='int03_source'`,
    )
    await admin.query(`DROP ROLE IF EXISTS int03_source`)
    await admin.query(
      `CREATE ROLE int03_source LOGIN PASSWORD 'int03-source-pass'`,
    )
    await admin.query(`CREATE DATABASE ${SOURCE_DB}`)
  } finally {
    await admin.end()
  }
  const sourceUrl = new URL(baseUrl.toString())
  sourceUrl.pathname = `/${SOURCE_DB}`
  // Dedicated login for the connector so credentials are real (proving auth
  // failure + secret isolation) instead of trust-auth blanks.
  const source = new Client({ connectionString: sourceUrl.toString() })
  await source.connect()
  await source.query(`
    create table int03_measurements (
      sample text primary key,
      value numeric not null
    );
    insert into int03_measurements values ('s1', 1.5), ('s2', 2.5);
    create view int03_view as select sample, value from int03_measurements;
    grant usage on schema public to int03_source;
    grant select on all tables in schema public to int03_source;
  `)
  await source.end()
  const connectorUrl = new URL(sourceUrl.toString())
  connectorUrl.username = 'int03_source'
  connectorUrl.password = 'int03-source-pass'
  return {
    connectionString: connectorUrl.toString(),
    /** Admin connection for fixture mutations the connector must not do. */
    adminConnectionString: sourceUrl.toString(),
    username: 'int03_source',
    password: 'int03-source-pass',
    port: Number(baseUrl.port),
  }
}

// ---------------------------------------------------------------------------
let s3Server: Server | null = null
let s3Endpoint = ''
let sourceDb: Awaited<ReturnType<typeof createSourceDatabase>>
let projectId: string

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `insert into api.workspaces(id,slug,name,status) values($1,'int03','INT-03','active')
     on conflict (id) do nothing`,
    [WS_A],
  )
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values($1,'Owner','int03-owner@test','f')
     on conflict (id) do nothing`,
    [OWNER_A],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role)
     values($1,$2,'owner') on conflict do nothing`,
    [WS_A, OWNER_A],
  )
  const owner = await actor(OWNER_A, WS_A)
  projectId = await createProjectFixture(owner)
  s3Server = await startS3Server()
  const address = s3Server.address()
  s3Endpoint = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
  sourceDb = await createSourceDatabase()
})

afterAll(async () => {
  await migrator.end()
  for (const client of clients) await client.end().catch(() => {})
  if (s3Server)
    await new Promise<void>((resolve) => s3Server.close(() => resolve()))
})

// ---------------------------------------------------------------------------
describe('INT-03B S3 connector', () => {
  async function setupConnector(configOverrides: Record<string, unknown> = {}) {
    const owner = await actor(OWNER_A, WS_A)
    const connector = (
      await owner.query(
        `select * from api.register_connector($1,$2,$3,$4,$5,$6,$7)`,
        [
          WS_A,
          `s3-${crypto.randomUUID().slice(0, 8)}`,
          'S3 source',
          'storage',
          'inbound',
          JSON.stringify({
            adapter: 's3',
            endpoint: s3Endpoint,
            bucket: 'test-bucket',
            prefix: 'data/',
            forcePathStyle: true,
            ...configOverrides,
          }),
          null,
        ],
      )
    ).rows[0]
    const secrets = {
      access_key_id: 'AKIA-TEST',
      secret_access_key: 'shhh-very-secret-value',
    }
    await sealAndStore(connector.id, 'access_key_id', secrets.access_key_id)
    await sealAndStore(
      connector.id,
      'secret_access_key',
      secrets.secret_access_key,
    )
    return { owner, connectorId: connector.id as string, secrets }
  }

  it('seals secrets and decrypts through the same server path', async () => {
    const { connectorId } = await setupConnector()
    const decrypted = await openStored(connectorId, 'secret_access_key')
    expect(decrypted).toBe('shhh-very-secret-value')
  })

  it('passes a governed connection test against the bucket', async () => {
    const { owner, connectorId, secrets } = await setupConnector()
    const context = await adapterContext({
      connectorId,
      config: {},
      secrets,
      owner,
    })
    const source = s3Adapter.parseConfig(context.connector.config)
    const result = await s3Adapter.testConnection(context, source)
    expect(result.detail).toMatchObject({
      bucket: 'test-bucket',
      prefix: 'data/',
    })
  })

  it('fails safely with invalid credentials (403 from the store)', async () => {
    const { owner, connectorId } = await setupConnector()
    const context = await adapterContext({
      connectorId,
      config: {},
      secrets: { access_key_id: 'invalid', secret_access_key: 'invalid' },
      owner,
    })
    const source = s3Adapter.parseConfig(context.connector.config)
    await expect(
      s3Adapter.testConnection(context, source),
    ).rejects.toMatchObject({
      code: 'source_forbidden',
    })
  })

  it('discovers objects with pagination and prefix filtering', async () => {
    for (let index = 0; index < 3; index++) {
      S3_OBJECTS[`data/batch-${index}.csv`] = {
        body: Buffer.from(`Sample,Value\ns${index},1\n`),
        contentType: 'text/csv',
      }
    }
    S3_OBJECTS['other/ignored.csv'] = {
      body: Buffer.from('x'),
      contentType: 'text/csv',
    }
    const { owner, connectorId, secrets } = await setupConnector()
    const context = await adapterContext({
      connectorId,
      config: {},
      secrets,
      owner,
    })
    const source = s3Adapter.parseConfig(context.connector.config)
    const page = (await s3Adapter.discover(context, source, {
      maxKeys: 2,
    })) as {
      objects: Array<{ key: string; byteSize: number; etag: string | null }>
      continuationToken: string | null
    }
    expect(page.objects).toHaveLength(2)
    expect(page.objects.every((object) => object.key.startsWith('data/'))).toBe(
      true,
    )
    expect(page.continuationToken).not.toBeNull()
    const nextPage = (await s3Adapter.discover(context, source, {
      maxKeys: 2,
      continuationToken: page.continuationToken,
    })) as typeof page
    expect(nextPage.objects).toHaveLength(1)
    expect(nextPage.continuationToken).toBeNull()
    expect(nextPage.objects[0].etag).toMatch(/^etag-/)
  })

  it('imports an object: retention, canonical rows, provenance', async () => {
    const csv = 'Sample,Value\ns1,10.5\ns2,20.5\n'
    S3_OBJECTS['data/run-42.csv'] = {
      body: Buffer.from(csv),
      contentType: 'text/csv',
    }
    const { owner, connectorId, secrets } = await setupConnector()
    const fixture = await createDatasetFixture(owner)
    const context = await adapterContext({
      connectorId,
      config: {},
      secrets,
      owner,
    })
    const source = s3Adapter.parseConfig(context.connector.config)
    const result = await s3Adapter.ingest(context, source, {
      source: { key: 'data/run-42.csv' },
      projectId,
      target: {
        datasetId: fixture.datasetId,
        expectedRevision: fixture.revision,
        schemaVersionId: fixture.schemaVersionId,
        fields: fixture.fields,
      },
    })
    expect(result.alreadyCompleted).toBe(false)
    expect(result.rowCount).toBe(2)

    // Canonical rows really landed.
    const stored = await owner.query(
      `select count(*)::int n from api.dataset_rows where dataset_id=$1`,
      [fixture.datasetId],
    )
    expect(stored.rows[0].n).toBe(2)

    // Provenance: run result carries retained file identity + source.
    const runRow = await owner.query(
      `select result, status from api.connector_runs where id=$1`,
      [result.runId],
    )
    expect(runRow.rows[0].status).toBe('succeeded')
    const provenance = runRow.rows[0].result
    expect(provenance.kind).toBe('s3_import')
    expect(provenance.source).toMatchObject({
      kind: 's3_object',
      bucket: 'test-bucket',
      key: 'data/run-42.csv',
    })
    expect(provenance.fileSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(provenance.parser).toBe('sheetbase.delimited@1')

    // The retained file exists in the canonical file platform with the same
    // sha256 receipt — the external object is not the only evidence.
    const fileObject = await readFileObject(WS_A, provenance.fileRecordId)
    expect(fileObject).not.toBeNull()
    expect(fileObject?.status).toBe('active')

    // Secret plaintext appears nowhere in the durable record.
    const runText = JSON.stringify(provenance)
    const logs = await owner.query(
      `select message, detail::text detail from api.connector_run_logs where run_id=$1`,
      [result.runId],
    )
    const logsText = logs.rows
      .map(
        (row: { message: string; detail: string }) =>
          `${row.message} ${row.detail}`,
      )
      .join(' ')
    expect(runText + logsText).not.toContain('shhh-very-secret-value')
    expect(runText + logsText).not.toContain('AKIA-TEST')
  })

  it('treats changed content under the same key as a new request', async () => {
    const { owner, connectorId, secrets } = await setupConnector()
    const fixture = await createDatasetFixture(owner)
    const context = await adapterContext({
      connectorId,
      config: {},
      secrets,
      owner,
    })
    const source = s3Adapter.parseConfig(context.connector.config)

    S3_OBJECTS['data/changing.csv'] = {
      body: Buffer.from('Sample,Value\ns1,1\n'),
      contentType: 'text/csv',
    }
    const first = await s3Adapter.ingest(context, source, {
      source: { key: 'data/changing.csv' },
      projectId,
      target: {
        datasetId: fixture.datasetId,
        expectedRevision: fixture.revision,
        schemaVersionId: fixture.schemaVersionId,
        fields: fixture.fields,
      },
    })
    const fileCountAfterFirst = await countWorkspaceFiles()

    // Same content again: replay of the stored result — the attempt succeeds
    // WITHOUT retaining a duplicate file or committing duplicate rows.
    const refreshed = await owner.query(
      `select revision from api.datasets where id=$1`,
      [fixture.datasetId],
    )
    const replay = await s3Adapter.ingest(context, source, {
      source: { key: 'data/changing.csv' },
      projectId,
      target: {
        datasetId: fixture.datasetId,
        expectedRevision: Number(refreshed.rows[0].revision),
        schemaVersionId: fixture.schemaVersionId,
        fields: fixture.fields,
      },
    })
    expect(replay.alreadyCompleted).toBe(true)
    expect(replay.rowCount).toBe(1)
    const replayRun = await owner.query(
      `select result from api.connector_runs where id=$1`,
      [replay.runId],
    )
    expect(replayRun.rows[0].result.replayOfRunId).toBe(first.runId)
    expect(await countWorkspaceFiles()).toBe(fileCountAfterFirst)
    const rowsAfterReplay = await owner.query(
      `select count(*)::int n from api.dataset_rows where dataset_id=$1`,
      [fixture.datasetId],
    )
    expect(rowsAfterReplay.rows[0].n).toBe(1)

    // Changed bytes, same key: a genuinely new logical request that imports.
    S3_OBJECTS['data/changing.csv'] = {
      body: Buffer.from('Sample,Value\ns1,2\n'),
      contentType: 'text/csv',
    }
    const changed = await s3Adapter.ingest(context, source, {
      source: { key: 'data/changing.csv' },
      projectId,
      target: {
        datasetId: fixture.datasetId,
        expectedRevision: Number(refreshed.rows[0].revision),
        schemaVersionId: fixture.schemaVersionId,
        fields: fixture.fields,
      },
    })
    expect(changed.alreadyCompleted).toBe(false)
    expect(changed.runId).not.toBe(first.runId)
    expect(changed.rowCount).toBe(1)
    expect(await countWorkspaceFiles()).toBe(fileCountAfterFirst + 1)
  })

  it('fails a schema-invalid import without touching the Dataset, then retries linked', async () => {
    // 'Sample' is required by the Schema but missing from the object: a
    // deterministic failure under the same request identity.
    S3_OBJECTS['data/bad.csv'] = {
      body: Buffer.from('Value\n12\n'),
      contentType: 'text/csv',
    }
    const { owner, connectorId, secrets } = await setupConnector()
    const fixture = await createDatasetFixture(owner)
    const context = await adapterContext({ connectorId, secrets, owner })
    const source = s3Adapter.parseConfig(context.connector.config)
    const request = {
      source: { key: 'data/bad.csv' },
      projectId,
      target: {
        datasetId: fixture.datasetId,
        expectedRevision: fixture.revision,
        schemaVersionId: fixture.schemaVersionId,
        fields: fixture.fields,
      },
    }
    await expect(s3Adapter.ingest(context, source, request)).rejects.toThrow(
      /required|mapping/i,
    )
    const failed = await owner.query(
      `select id, attempt, status, error_code from api.connector_runs
        where connector_id=$1 order by started_at desc limit 1`,
      [connectorId],
    )
    expect(failed.rows[0].status).toBe('failed')
    expect(failed.rows[0].attempt).toBe(1)

    const stored = await owner.query(
      `select count(*)::int n from api.dataset_rows where dataset_id=$1`,
      [fixture.datasetId],
    )
    expect(stored.rows[0].n).toBe(0)

    // Re-submitting the same failed request retries as a linked attempt.
    await expect(s3Adapter.ingest(context, source, request)).rejects.toThrow(
      /required|mapping/i,
    )
    const retryRows = await owner.query(
      `select attempt, retry_of_run_id, error_code from api.connector_runs
        where connector_id=$1 and attempt=2`,
      [connectorId],
    )
    expect(retryRows.rows).toHaveLength(1)
    expect(retryRows.rows[0].retry_of_run_id).toBe(failed.rows[0].id)
    expect(Number(stored.rows[0].n)).toBe(0)
  })

  it('enforces the object byte cap with a bounded error AND a failed run', async () => {
    S3_OBJECTS['data/big.csv'] = {
      body: Buffer.alloc(2048, 'a'),
      contentType: 'text/csv',
    }
    const { owner, connectorId, secrets } = await setupConnector({
      max_object_bytes: 1024,
    })
    const context = await adapterContext({
      connectorId,
      config: { max_object_bytes: 1024 },
      secrets,
      owner,
    })
    const source = s3Adapter.parseConfig(context.connector.config)
    await expect(
      s3Adapter.ingest(context, source, {
        source: { key: 'data/big.csv' },
        projectId,
        target: {
          datasetId: null,
          newDatasetName: 'never created',
          schemaVersionId: null as never,
          fields: [],
        },
      }),
    ).rejects.toMatchObject({ code: 'row_limit_exceeded' })
    // The cap failure is recorded as a FAILED RUN, not a bare HTTP error.
    const failed = await owner.query(
      `select status, error_code from api.connector_runs
        where connector_id=$1 order by started_at desc limit 1`,
      [connectorId],
    )
    expect(failed.rows[0].status).toBe('failed')
    expect(failed.rows[0].error_code).toBe('row_limit_exceeded')
  })

  it('stops reading at the configured cap (streaming abort regression)', async () => {
    // Direct regression for the bounded reader: a source that keeps sending
    // bytes is cut off at the cap — the reader must not buffer the world.
    let served = 0
    const CHUNK = 64 * 1024
    async function* endless(): AsyncGenerator<Uint8Array> {
      while (true) {
        served += CHUNK
        yield new Uint8Array(CHUNK)
      }
    }
    const { readBoundedBytes } =
      await import('#/lib/connectors/enterprise/s3.server')
    await expect(
      readBoundedBytes(endless() as never, 1024 * 1024, 'import'),
    ).rejects.toMatchObject({ code: 'row_limit_exceeded' })
    // Stopped within cap + one chunk, not after an unbounded read.
    expect(served).toBeLessThanOrEqual(1024 * 1024 + CHUNK)
  })

  it('records source failures (unreachable store) as failed runs', async () => {
    const { owner, connectorId, secrets } = await setupConnector({
      endpoint: 'http://127.0.0.1:59998',
    })
    const context = await adapterContext({ connectorId, secrets, owner })
    const source = s3Adapter.parseConfig(context.connector.config)
    await expect(
      s3Adapter.ingest(context, source, {
        source: { key: 'data/whatever.csv' },
        projectId,
        target: {
          datasetId: null,
          newDatasetName: 'never created',
          schemaVersionId: null as never,
          fields: [],
        },
      }),
    ).rejects.toMatchObject({ code: 'connection_failed' })
    const failed = await owner.query(
      `select status, error_code from api.connector_runs
        where connector_id=$1 order by started_at desc limit 1`,
      [connectorId],
    )
    expect(failed.rows[0].status).toBe('failed')
    expect(failed.rows[0].error_code).toBe('connection_failed')
  })
})

describe('INT-03C PostgreSQL connector', () => {
  async function setupConnector(configOverrides: Record<string, unknown> = {}) {
    const owner = await actor(OWNER_A, WS_A)
    const connector = (
      await owner.query(
        `select * from api.register_connector($1,$2,$3,$4,$5,$6,$7)`,
        [
          WS_A,
          `pg-${crypto.randomUUID().slice(0, 8)}`,
          'External warehouse',
          'database',
          'inbound',
          JSON.stringify({
            adapter: 'postgres',
            host: '127.0.0.1',
            port: sourceDb.port,
            database: SOURCE_DB,
            sslMode: 'disable',
            ...configOverrides,
          }),
          null,
        ],
      )
    ).rows[0]
    const secrets = {
      username: sourceDb.username,
      password: sourceDb.password,
    }
    await sealAndStore(connector.id, 'username', secrets.username)
    await sealAndStore(connector.id, 'password', secrets.password)
    return { owner, connectorId: connector.id as string, secrets }
  }

  it('passes a governed connection test and hides system schemas', async () => {
    const { owner, connectorId, secrets } = await setupConnector()
    const context = await adapterContext({
      connectorId,
      config: {},
      secrets,
      owner,
    })
    const source = postgresAdapter.parseConfig(context.connector.config)
    const test = await postgresAdapter.testConnection(context, source)
    expect(test.detail).toMatchObject({ database: SOURCE_DB })
    const discovery = (await postgresAdapter.discover(context, source, {})) as {
      schemas: string[]
    }
    expect(discovery.schemas).toContain('public')
    expect(discovery.schemas).not.toContain('pg_catalog')
    expect(discovery.schemas).not.toContain('information_schema')
  })

  it('discovers tables, views and columns with types + nullability', async () => {
    const { owner, connectorId, secrets } = await setupConnector()
    const context = await adapterContext({
      connectorId,
      config: {},
      secrets,
      owner,
    })
    const source = postgresAdapter.parseConfig(context.connector.config)
    const discovery = (await postgresAdapter.discover(context, source, {
      schema: 'public',
    })) as {
      tables: Array<{
        name: string
        kind: string
        columns: Array<{ name: string; dataType: string; nullable: boolean }>
      }>
    }
    const table = discovery.tables.find(
      (entry) => entry.name === 'int03_measurements',
    )
    expect(table).toBeDefined()
    expect(table?.kind).toBe('table')
    expect(table?.columns.map((column) => column.name)).toEqual([
      'sample',
      'value',
    ])
    expect(table?.columns[1].nullable).toBe(false)
    const view = discovery.tables.find((entry) => entry.name === 'int03_view')
    expect(view?.kind).toBe('view')
  })

  it('respects allowedSchemas when configured', async () => {
    const { owner, connectorId, secrets } = await setupConnector({
      allowedSchemas: ['int03_custom'],
    })
    const context = await adapterContext({
      connectorId,
      config: {},
      secrets,
      owner,
    })
    const source = postgresAdapter.parseConfig(context.connector.config)
    const discovery = (await postgresAdapter.discover(context, source, {})) as {
      schemas: string[]
    }
    expect(discovery.schemas).toEqual([])
  })

  it('previews a bounded selection with explicit columns', async () => {
    const { owner, connectorId, secrets } = await setupConnector()
    const context = await adapterContext({
      connectorId,
      config: { preview_rows: 1 },
      secrets,
      owner,
    })
    const source = postgresAdapter.parseConfig(context.connector.config)
    const preview = (await postgresAdapter.preview(context, source, {
      schema: 'public',
      table: 'int03_measurements',
    })) as { columns: string[]; rows: unknown[]; truncated: boolean }
    expect(preview.columns).toEqual(['sample', 'value'])
    expect(preview.rows).toHaveLength(1)
    expect(preview.truncated).toBe(true)
  })

  it('refuses non-plain identifiers (no SQL injection surface)', async () => {
    const { owner, connectorId, secrets } = await setupConnector()
    const context = await adapterContext({
      connectorId,
      config: {},
      secrets,
      owner,
    })
    const source = postgresAdapter.parseConfig(context.connector.config)
    await expect(
      postgresAdapter.preview(context, source, {
        schema: 'public',
        table: 'int03_measurements; DROP TABLE int03_measurements; --',
      }),
    ).rejects.toMatchObject({ code: 'query_failed' })
    // The source table still exists.
    const src = new Client({ connectionString: sourceDb.adminConnectionString })
    await src.connect()
    const check = await src.query(
      `select to_regclass('public.int03_measurements') is not null as exists`,
    )
    await src.end()
    expect(check.rows[0].exists).toBe(true)
  })

  it('imports through canonical validation/commit with full provenance', async () => {
    const { owner, connectorId, secrets } = await setupConnector()
    const fixture = await createDatasetFixture(owner)
    const context = await adapterContext({
      connectorId,
      config: {},
      secrets,
      owner,
    })
    const source = postgresAdapter.parseConfig(context.connector.config)
    const result = await postgresAdapter.ingest(context, source, {
      source: { schema: 'public', table: 'int03_measurements' },
      target: {
        datasetId: fixture.datasetId,
        expectedRevision: fixture.revision,
        schemaVersionId: fixture.schemaVersionId,
        fields: fixture.fields,
      },
    })
    expect(result.rowCount).toBe(2)
    const stored = await owner.query(
      `select count(*)::int n from api.dataset_rows where dataset_id=$1`,
      [fixture.datasetId],
    )
    expect(stored.rows[0].n).toBe(2)
    const runRow = await owner.query(
      `select result from api.connector_runs where id=$1`,
      [result.runId],
    )
    const provenance = runRow.rows[0].result
    expect(provenance.kind).toBe('postgres_import')
    expect(provenance.source).toMatchObject({
      kind: 'postgres_table',
      host: '127.0.0.1',
      database: SOURCE_DB,
      schema: 'public',
      table: 'int03_measurements',
      columns: ['sample', 'value'],
    })
    expect(provenance.source.contentSha256).toMatch(/^[0-9a-f]{64}$/)
    if (sourceDb.password) {
      expect(JSON.stringify(provenance)).not.toContain(sourceDb.password)
    }

    // Identical source content: replay of the stored result — no new rows.
    const rowsBefore = await owner.query(
      `select count(*)::int n from api.dataset_rows where dataset_id=$1`,
      [fixture.datasetId],
    )
    const replay = await postgresAdapter.ingest(context, source, {
      source: { schema: 'public', table: 'int03_measurements' },
      target: {
        datasetId: fixture.datasetId,
        expectedRevision: Number(
          (
            await owner.query(`select revision from api.datasets where id=$1`, [
              fixture.datasetId,
            ])
          ).rows[0].revision,
        ),
        schemaVersionId: fixture.schemaVersionId,
        fields: fixture.fields,
      },
    })
    expect(replay.alreadyCompleted).toBe(true)
    expect(replay.rowCount).toBe(2)
    const replayRun = await owner.query(
      `select result from api.connector_runs where id=$1`,
      [replay.runId],
    )
    expect(replayRun.rows[0].result.replayOfRunId).toBe(result.runId)
    const rowsAfter = await owner.query(
      `select count(*)::int n from api.dataset_rows where dataset_id=$1`,
      [fixture.datasetId],
    )
    expect(rowsAfter.rows[0].n).toBe(rowsBefore.rows[0].n)
  })

  it('fails with row_limit_exceeded when the source exceeds the import cap', async () => {
    const { owner, connectorId, secrets } = await setupConnector({
      import_rows: 1,
    })
    const fixture = await createDatasetFixture(owner)
    const context = await adapterContext({
      connectorId,
      config: { import_rows: 1 },
      secrets,
      owner,
    })
    const source = postgresAdapter.parseConfig(context.connector.config)
    await expect(
      postgresAdapter.ingest(context, source, {
        source: { schema: 'public', table: 'int03_measurements' },
        target: {
          datasetId: fixture.datasetId,
          expectedRevision: fixture.revision,
          schemaVersionId: fixture.schemaVersionId,
          fields: fixture.fields,
        },
      }),
    ).rejects.toMatchObject({ code: 'row_limit_exceeded' })
    const stored = await owner.query(
      `select count(*)::int n from api.dataset_rows where dataset_id=$1`,
      [fixture.datasetId],
    )
    expect(stored.rows[0].n).toBe(0)
  })

  it('is atomic: a failure in a later chunk leaves the Dataset untouched, and a corrected retry succeeds (PLAT-05)', async () => {
    // A 1500-row source against a target whose `value` field enforces
    // `min: 0`. Row 1001 (the first row of chunk 2) has value −5: it passes
    // mapping/coercion but fails the canonical Dataset validation, so the
    // atomic import must fail in chunk 2 without committing chunk 1.
    const adminSource = new Client({
      connectionString: sourceDb.adminConnectionString,
    })
    await adminSource.connect()
    await adminSource.query(`
      drop table if exists plat05_atomic_measurements;
      create table plat05_atomic_measurements (
        sample text primary key,
        value text not null
      );
      insert into plat05_atomic_measurements(sample, value)
      select 'A-' || lpad(i::text, 8, '0'),
             case when i = 1001 then '-5' else (i * 1.5)::text end
        from generate_series(1, 1500) i;
      grant select on plat05_atomic_measurements to int03_source;
    `)
    await adminSource.end()

    // Custom target schema: `value` decimal with min 0 (DB-side validation).
    const { owner, connectorId, secrets } = await setupConnector({
      import_rows: 5000,
    })
    const fixture = await createValidatedDatasetFixture(owner)
    const context = await adapterContext({
      connectorId,
      config: { import_rows: 5000 },
      secrets,
      owner,
    })
    const source = postgresAdapter.parseConfig(context.connector.config)
    const request = {
      source: { schema: 'public', table: 'plat05_atomic_measurements' },
      target: {
        datasetId: fixture.datasetId,
        expectedRevision: fixture.revision,
        schemaVersionId: fixture.schemaVersionId,
        fields: fixture.fields,
      },
    }
    // Chunk 2 fails canonical validation → the whole atomic import fails and
    // nothing is written (no partial scientific import).
    await expect(
      postgresAdapter.ingest(context, source, request),
    ).rejects.toMatchObject({ code: 'validation_failed' })

    // Dataset rows and revision are exactly as before the import.
    const untouched = await owner.query(
      `select count(*)::int n, min(revision)::int min_r, max(revision)::int max_r
         from api.dataset_rows where dataset_id=$1`,
      [fixture.datasetId],
    )
    expect(untouched.rows[0].n).toBe(0)
    expect(untouched.rows[0].min_r).toBe(null)
    expect(untouched.rows[0].max_r).toBe(null)
    const datasetState = await owner.query(
      `select revision from api.datasets where id=$1`,
      [fixture.datasetId],
    )
    expect(Number(datasetState.rows[0].revision)).toBe(fixture.revision)
    const failedRun = await owner.query(
      `select count(*)::int n from api.connector_runs
        where connector_id=$1 and status='failed'`,
      [connectorId],
    )
    expect(failedRun.rows[0].n).toBeGreaterThanOrEqual(1)

    // Correct the offending row and retry: the import succeeds deterministically.
    const fixSource = new Client({
      connectionString: sourceDb.adminConnectionString,
    })
    await fixSource.connect()
    await fixSource.query(
      `update plat05_atomic_measurements set value = '1501.5' where sample = 'A-00001001'`,
    )
    await fixSource.end()
    const retried = await postgresAdapter.ingest(context, source, request)
    expect(retried.rowCount).toBe(1500)
    const stored = await owner.query(
      `select count(*)::int n from api.dataset_rows where dataset_id=$1`,
      [fixture.datasetId],
    )
    expect(stored.rows[0].n).toBe(1500)
    const revision = await owner.query(
      `select revision from api.datasets where id=$1`,
      [fixture.datasetId],
    )
    expect(Number(revision.rows[0].revision)).toBe(fixture.revision + 2)
  })

  it('produces a new request identity when the source changes', async () => {
    const { owner, connectorId, secrets } = await setupConnector()
    const fixture = await createDatasetFixture(owner)
    const context = await adapterContext({
      connectorId,
      config: {},
      secrets,
      owner,
    })
    const source = postgresAdapter.parseConfig(context.connector.config)
    const target = {
      datasetId: fixture.datasetId,
      expectedRevision: fixture.revision,
      schemaVersionId: fixture.schemaVersionId,
      fields: fixture.fields,
    }
    const first = await postgresAdapter.ingest(context, source, {
      source: { schema: 'public', table: 'int03_view' },
      target,
    })
    // Change the source the view reads from, re-read revision, import again.
    const src = new Client({ connectionString: sourceDb.adminConnectionString })
    await src.connect()
    await src.query(`insert into int03_measurements values ('s3', 3.5)`)
    await src.end()
    const refreshed = await owner.query(
      `select revision from api.datasets where id=$1`,
      [fixture.datasetId],
    )
    const second = await postgresAdapter.ingest(context, source, {
      source: { schema: 'public', table: 'int03_view' },
      target: {
        ...target,
        expectedRevision: Number(refreshed.rows[0].revision),
      },
    })
    expect(second.alreadyCompleted).toBe(false)
    expect(second.runId).not.toBe(first.runId)
    expect(second.rowCount).toBe(3)
  })

  it('fails safely when the source database is unreachable', async () => {
    const { owner, connectorId, secrets } = await setupConnector({
      port: 59999,
    })
    const context = await adapterContext({
      connectorId,
      config: { port: 59999 },
      secrets,
      owner,
    })
    const source = postgresAdapter.parseConfig(context.connector.config)
    await expect(
      postgresAdapter.testConnection(context, source),
    ).rejects.toMatchObject({
      code: 'connection_failed',
    })
  })

  it('records query failures (unreachable source) as failed runs', async () => {
    const { owner, connectorId, secrets } = await setupConnector({
      port: 59999,
    })
    const context = await adapterContext({
      connectorId,
      config: { port: 59999 },
      secrets,
      owner,
    })
    const source = postgresAdapter.parseConfig(context.connector.config)
    await expect(
      postgresAdapter.ingest(context, source, {
        source: { schema: 'public', table: 'int03_measurements' },
        target: {
          datasetId: null,
          newDatasetName: 'never created',
          schemaVersionId: null as never,
          fields: [],
        },
      }),
    ).rejects.toMatchObject({ code: 'connection_failed' })
    const failed = await owner.query(
      `select status, error_code from api.connector_runs
        where connector_id=$1 order by started_at desc limit 1`,
      [connectorId],
    )
    expect(failed.rows[0].status).toBe('failed')
    expect(failed.rows[0].error_code).toBe('connection_failed')
  })

  it('enforces allowedSchemas on direct crafted preview/import selectors', async () => {
    // The source contains a schema the connector does NOT expose.
    const src = new Client({ connectionString: sourceDb.adminConnectionString })
    await src.connect()
    await src.query(`
      drop schema if exists int03_secret cascade;
      create schema int03_secret;
      create table int03_secret.sensitive (k text, v text);
    `)
    await src.end()
    const { owner, connectorId, secrets } = await setupConnector({
      allowedSchemas: ['public'],
    })
    const context = await adapterContext({ connectorId, secrets, owner })
    const source = postgresAdapter.parseConfig(context.connector.config)
    // Discovery correctly hides it…
    const discovery = (await postgresAdapter.discover(context, source, {})) as {
      schemas: string[]
    }
    expect(discovery.schemas).not.toContain('int03_secret')
    // …but a crafted selector straight to preview is ALSO refused.
    await expect(
      postgresAdapter.preview(context, source, {
        schema: 'int03_secret',
        table: 'sensitive',
      }),
    ).rejects.toMatchObject({ code: 'source_forbidden' })
    // …and a crafted import selector is refused too.
    await expect(
      postgresAdapter.ingest(context, source, {
        source: { schema: 'int03_secret', table: 'sensitive' },
        target: {
          datasetId: null,
          newDatasetName: 'never created',
          schemaVersionId: null as never,
          fields: [],
        },
      }),
    ).rejects.toMatchObject({ code: 'source_forbidden' })
  })

  it('enforces allowedTables on discovery, preview and import', async () => {
    const { owner, connectorId, secrets } = await setupConnector({
      allowedTables: ['public.int03_measurements'],
    })
    const context = await adapterContext({ connectorId, secrets, owner })
    const source = postgresAdapter.parseConfig(context.connector.config)

    // Discovery only lists the allowlisted table.
    const discovery = (await postgresAdapter.discover(context, source, {
      schema: 'public',
    })) as { tables: Array<{ name: string }> }
    expect(discovery.tables.map((table) => table.name)).toEqual([
      'int03_measurements',
    ])

    // A crafted preview selector for a non-allowlisted table is refused.
    await expect(
      postgresAdapter.preview(context, source, {
        schema: 'public',
        table: 'int03_view',
      }),
    ).rejects.toMatchObject({ code: 'source_forbidden' })
    // …and so is a crafted import selector.
    await expect(
      postgresAdapter.ingest(context, source, {
        source: { schema: 'public', table: 'int03_view' },
        target: {
          datasetId: null,
          newDatasetName: 'never created',
          schemaVersionId: null as never,
          fields: [],
        },
      }),
    ).rejects.toMatchObject({ code: 'source_forbidden' })
  })
})
