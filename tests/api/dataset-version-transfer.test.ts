import { createHash, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { text } from 'node:stream/consumers'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Client } from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { z } from 'zod'
import { syncDatasetSnapshots } from '../../scripts/sync-dataset-snapshots'
import * as schema from '#/db/schema'
import {
  createCredential,
  exchangeCredential,
  mintApiClientToken,
} from '#/lib/api-credentials'
import type { Scope } from '#/lib/api-credentials'
import { resolveExternalToken } from '#/lib/external-token'
import { handleProxyRequest } from '#/lib/postgrest-proxy'

const workspace = randomUUID()
const otherWorkspace = randomUUID()
const owner = 'snapshot-transfer-owner'
const firstRow = '00000000-0000-4000-8000-000000000001'
const integer = randomUUID()
const decimal = randomUUID()
const many = randomUUID()
const nullable = randomUUID()
const secret = process.env.PGRST_JWT_SECRET ?? ''
let admin: Client
let dataset: string
let version: string
let schemaId: string
let schemaVersion: string
let token: string
let credentialId: string

const hash = (bytes: string) =>
  createHash('sha256').update(bytes, 'utf8').digest('hex')
const aggregate = (metadata: string, rows: Array<{ sha256: string }>) =>
  hash(metadata + '\n' + rows.map((row) => row.sha256 + '\n').join(''))

async function serviceToken(scopes: Scope[], workspaceId = workspace) {
  const credential = await createCredential(drizzle(admin, { schema }), {
    workspaceId,
    createdByUserId: owner,
    name: 'Snapshot reader',
    scopes,
  })
  return {
    id: credential.id,
    token: await mintApiClientToken(secret, {
      workspaceId,
      credentialId: credential.id,
      scopes,
    }),
  }
}

async function read(bearer: string, offset = 0, limit = 1000) {
  return proxy(
    new Request(
      'http://sheetbase.test/api/db/rpc/query_dataset_version_transfer',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${bearer}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          p_dataset_version_id: version,
          p_limit: limit,
          p_offset: offset,
        }),
      },
    ),
    'rpc/query_dataset_version_transfer',
  )
}

function proxy(request: Request, path: string) {
  return handleProxyRequest(request, path, {
    getSession: async () => null,
    getWorkspaceForUser: async () => null,
    mintToken: async () => {
      throw new Error('Machine transfer must not mint a session')
    },
    resolveExternalToken: (value, method, path) =>
      resolveExternalToken(
        drizzle(admin, { schema }),
        value,
        secret,
        method,
        path,
      ),
    upstreamBaseUrl: process.env.POSTGREST_URL ?? '',
  })
}

beforeAll(async () => {
  admin = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL })
  await admin.connect()
  await admin.query(
    `insert into internal."user"(id,name,email,"emailVerified") values($1,$1,'transfer@test.invalid',true)`,
    [owner],
  )
  await admin.query(
    `insert into api.workspaces(id,slug,name) values($1,'transfer','Transfer'),($2,'other-transfer','Other')`,
    [workspace, otherWorkspace],
  )
  await admin.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values($1,$3,'owner'),($2,$3,'owner')`,
    [workspace, otherWorkspace, owner],
  )
  await admin.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({
      role: 'authenticated',
      sub: owner,
      workspace_id: workspace,
    }),
  ])
  const definition = await admin.query(
    `select api.create_dataset_schema_definition($1,'transfer','Transfer',null,$2::jsonb) result`,
    [
      workspace,
      JSON.stringify([
        {
          fieldId: integer,
          key: 'integer',
          label: 'Same label',
          logicalType: 'integer',
          nullable: true,
        },
        {
          fieldId: decimal,
          key: 'decimal',
          label: 'Same label',
          logicalType: 'decimal',
          nullable: true,
          quantity: { kind: 'quantity', dimension: 'mass', storageUnit: 'g' },
        },
        {
          fieldId: many,
          key: 'many',
          label: 'Many',
          logicalType: 'decimal',
          cardinality: 'many',
          nullable: true,
        },
        {
          fieldId: nullable,
          key: 'nullable',
          label: 'Nullable',
          logicalType: 'text',
          nullable: true,
        },
      ]),
    ],
  )
  schemaVersion = definition.rows[0].result.schema_version_id
  schemaId = definition.rows[0].result.schema_definition_id
  await admin.query(`select api.publish_dataset_schema_version($1)`, [
    schemaVersion,
  ])
  dataset = (
    await admin.query(
      `insert into api.datasets(workspace_id,schema_version_id,name) values($1,$2,'Transfer') returning id`,
      [workspace, schemaVersion],
    )
  ).rows[0].id
  // Build numeric JSON in PostgreSQL: JavaScript never parses fixture numbers.
  const commit = await admin.query(
    `select api.commit_dataset_row_batch($1,1,jsonb_build_array(jsonb_build_object(
    'operation','create','rowId',$2::uuid,'values',jsonb_build_object(
      $3::text,9007199254740993::bigint,$4::text,12345678901234567890.12345678901234567890::numeric,
      $5::text,jsonb_build_array(0.123456789012345678901::numeric,9.8::numeric)))),'transfer-first') result`,
    [dataset, firstRow, integer, decimal, many],
  )
  expect(commit.rows[0].result.ok).toBe(true)
  const more = await admin.query(
    `select api.commit_dataset_row_batch($1,2,(select jsonb_agg(jsonb_build_object('operation','create',
    'rowId',('f0000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'values','{}'::jsonb)) from generate_series(1,1000)n),'transfer-rest') result`,
    [dataset],
  )
  expect(more.rows[0].result.ok).toBe(true)
  await admin.query(
    `select api.flag_dataset_value($1,$2,$3,'missing_unit','Independent QC review')`,
    [dataset, firstRow, decimal],
  )
  const revision = (
    await admin.query('select revision from api.datasets where id=$1', [
      dataset,
    ])
  ).rows[0].revision
  version = (
    await admin.query(
      `select (api.snapshot_dataset($1,$2,'Transfer snapshot')).id`,
      [dataset, revision],
    )
  ).rows[0].id
  const reader = await serviceToken(['datasets:read', 'schema:read'])
  token = reader.token
  credentialId = reader.id
})

afterAll(async () => {
  await admin?.end()
})

it('transfers complete immutable rows with exact values, QC and reproducible checksums through a scoped service proxy', async () => {
  const firstResponse = await read(token)
  expect(firstResponse.status, await firstResponse.clone().text()).toBe(200)
  const first = await firstResponse.json()
  const lastResponse = await read(token, 1000)
  expect(lastResponse.status).toBe(200)
  const last = await lastResponse.json()
  expect(first).toMatchObject({
    totalCount: 1001,
    hasMore: true,
    snapshotChecksum: null,
  })
  expect(last).toMatchObject({
    totalCount: 1001,
    hasMore: false,
    metadataChecksum: first.metadataChecksum,
  })
  expect(first.rows).toHaveLength(1000)
  expect(last.rows).toHaveLength(1)
  expect(hash(first.metadataJson)).toBe(first.metadataChecksum)
  const metadata = JSON.parse(first.metadataJson)
  expect(metadata).toMatchObject({
    workspaceId: workspace,
    datasetId: dataset,
    datasetVersionId: version,
    schemaId,
    schemaVersionId: schemaVersion,
    totalCount: '1001',
  })
  expect(
    metadata.fields.find(
      (field: { field_id: string }) => field.field_id === decimal,
    ),
  ).toMatchObject({
    label: 'Same label',
    cardinality: 'one',
    quantity: { storageUnit: 'g' },
  })
  const row = JSON.parse(first.rows[0].canonicalJson)
  expect(row).toMatchObject({
    rowId: firstRow,
    revision: '1',
    values: {
      [integer]: '9007199254740993',
      [decimal]: '12345678901234567890.12345678901234567890',
      [many]: ['0.123456789012345678901', '9.8'],
      [nullable]: null,
    },
  })
  expect(row.flags).toEqual([
    expect.objectContaining({
      field_id: decimal,
      kind: 'missing_unit',
      reason: 'Independent QC review',
    }),
  ])
  expect(JSON.parse(last.rows[0].canonicalJson).values[many]).toEqual([])
  for (const page of [first, last]) {
    for (const entry of page.rows)
      expect(hash(entry.canonicalJson)).toBe(entry.sha256)
    expect(aggregate(page.metadataChecksum, page.rows)).toBe(page.pageChecksum)
  }
  expect(aggregate(first.metadataChecksum, [...first.rows, ...last.rows])).toBe(
    last.snapshotChecksum,
  )

  // A new published schema and a live rebind must not reinterpret old bytes.
  const next = (
    await admin.query(
      `insert into api.dataset_schema_versions(schema_id,version) values($1,2) returning id`,
      [schemaId],
    )
  ).rows[0].id
  await admin.query(
    `insert into api.dataset_schema_version_fields(schema_version_id,field_id,key,label,logical_type,nullable,quantity,cardinality,display_order)
    select $1,field_id,key,'Renamed '||label,logical_type,nullable,quantity,cardinality,display_order from api.dataset_schema_version_fields where schema_version_id=$2`,
    [next, schemaVersion],
  )
  await admin.query(`select api.publish_dataset_schema_version($1)`, [next])
  const revision = (
    await admin.query(`select revision from api.datasets where id=$1`, [
      dataset,
    ])
  ).rows[0].revision
  await admin.query(`select api.apply_dataset_model_upgrade($1,$2,$3)`, [
    dataset,
    next,
    revision,
  ])
  expect(await (await read(token)).json()).toEqual(first)
})

it('reconciles 1001 exact rows over HTTP and verifies the local snapshot before skipping a repeat', async () => {
  const credential = await createCredential(drizzle(admin, { schema }), {
    workspaceId: workspace,
    createdByUserId: owner,
    name: 'Snapshot consumer',
    scopes: ['datasets:read', 'schema:read'],
  })
  const requests: string[] = []
  const server = createServer((incoming, outgoing) => {
    void (async () => {
      const url = new URL(incoming.url ?? '/', 'http://127.0.0.1')
      requests.push(url.pathname)
      const headers = new Headers()
      for (const [key, value] of Object.entries(incoming.headers)) {
        if (value !== undefined)
          headers.set(key, Array.isArray(value) ? value.join(',') : value)
      }
      const body = await text(incoming)
      let response: Response
      if (url.pathname === '/api/token' && incoming.method === 'POST') {
        const input = z
          .object({ credential: z.string(), scopes: z.array(z.string()) })
          .parse(JSON.parse(body))
        response = Response.json({
          token: await exchangeCredential(
            drizzle(admin, { schema }),
            input.credential,
            input.scopes,
            {
              mintToken: (claims) => mintApiClientToken(secret, claims),
            },
          ),
        })
      } else if (url.pathname.startsWith('/api/db/')) {
        response = await proxy(
          new Request(url, {
            method: incoming.method,
            headers,
            ...(body ? { body } : {}),
          }),
          url.pathname.slice('/api/db/'.length),
        )
      } else {
        response = new Response('Not found', { status: 404 })
      }
      outgoing.writeHead(response.status, Object.fromEntries(response.headers))
      outgoing.end(Buffer.from(await response.arrayBuffer()))
    })().catch((error: unknown) => {
      outgoing.writeHead(500)
      outgoing.end(
        error instanceof Error ? error.message : 'HTTP adapter failed',
      )
    })
  })
  const outputDirectory = await mkdtemp(join(tmpdir(), 'snapshot-transfer-'))
  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No HTTP port')
    const options = {
      baseUrl: `http://127.0.0.1:${address.port}`,
      credential: credential.secret,
      workspaceId: workspace,
      outputDirectory,
    }
    expect(await syncDatasetSnapshots(options)).toEqual({
      published: 1,
      existing: 0,
      unavailable: [],
    })
    expect(
      requests.filter(
        (path) => path === '/api/db/rpc/query_dataset_version_transfer',
      ),
    ).toHaveLength(2)
    expect(requests).toContain('/api/token')
    expect(requests).toContain('/api/db/dataset_versions')

    const destination = join(outputDirectory, workspace, dataset, version)
    const rows = (await readFile(join(destination, 'rows.ndjson'), 'utf8'))
      .trimEnd()
      .split('\n')
    const first = await (await read(token)).json()
    const last = await (await read(token, 1000)).json()
    expect(rows).toHaveLength(1001)
    expect(rows).toEqual(
      [...first.rows, ...last.rows].map(
        (row: { canonicalJson: string }) => row.canonicalJson,
      ),
    )
    expect(JSON.parse(rows[0]).values).toEqual({
      [integer]: '9007199254740993',
      [decimal]: '12345678901234567890.12345678901234567890',
      [many]: ['0.123456789012345678901', '9.8'],
      [nullable]: null,
    })
    expect(await readFile(join(destination, 'metadata.json'), 'utf8')).toBe(
      first.metadataJson,
    )
    expect(
      JSON.parse(await readFile(join(destination, 'manifest.json'), 'utf8')),
    ).toEqual({
      format: 'sheetbase.dataset-version-transfer/1',
      sourceUrl: options.baseUrl,
      totalCount: 1001,
      metadataChecksum: first.metadataChecksum,
      snapshotChecksum: last.snapshotChecksum,
    })
    requests.length = 0
    expect(await syncDatasetSnapshots(options)).toEqual({
      published: 0,
      existing: 1,
      unavailable: [],
    })
    expect(requests).toContain('/api/db/dataset_versions')
    expect(requests).not.toContain('/api/db/rpc/query_dataset_version_transfer')
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
    await rm(outputDirectory, { recursive: true, force: true })
  }
})

it('fails closed for scope, workspace, window and revoked credentials', async () => {
  const noSchema = await serviceToken(['datasets:read'])
  expect((await read(noSchema.token)).status).toBe(403)
  const foreign = await serviceToken(
    ['datasets:read', 'schema:read'],
    otherWorkspace,
  )
  expect((await read(foreign.token)).status).toBe(403)
  expect((await read(token, 0, 1001)).status).toBe(400)
  expect((await read(token, 1002)).status).toBe(400)
  await admin.query(
    `update internal.api_credentials set revoked_at=now() where id=$1`,
    [credentialId],
  )
  expect((await read(token)).status).toBe(403)
})

it('rejects a pruned snapshot instead of reporting a successful empty transfer', async () => {
  const reader = await serviceToken(['datasets:read', 'schema:read'])
  await admin.query(
    `insert into api.dataset_version_prunes(dataset_version_id,pruned_row_count) values($1,1001)`,
    [version],
  )
  const response = await read(reader.token)
  expect(response.status).toBe(400)
  expect(await response.json()).toMatchObject({
    error: {
      category: 'validation_error',
      message: 'Dataset Version rows were removed by retention',
    },
  })
  const ordinaryRows = await proxy(
    new Request('http://sheetbase.test/api/db/rpc/query_dataset_version_rows', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${reader.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ p_dataset_version_id: version }),
    }),
    'rpc/query_dataset_version_rows',
  )
  expect(ordinaryRows.status).toBe(400)
  expect(await ordinaryRows.json()).toMatchObject({
    error: { message: 'Dataset Version rows were removed by retention' },
  })
})
