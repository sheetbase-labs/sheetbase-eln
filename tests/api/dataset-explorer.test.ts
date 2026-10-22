/**
 * DATA-007 API contract proof through the same-origin PostgREST proxy:
 * canonical Dataset metadata, bounded row pages, validated filters and
 * cross-workspace isolation. No retired scientific-table APIs are used.
 */
import { randomUUID } from 'node:crypto'
import { config } from 'dotenv'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { handleProxyRequest } from '#/lib/postgrest-proxy'
import { mintPostgrestToken } from '#/lib/postgrest-token'
import { validateTransformations } from '#/lib/dataset-explorer-data'

config({ path: ['.env.local', '.env'] })

const WS_A = '6d000000-0000-4000-8000-000000000001'
const WS_B = '6d000000-0000-4000-8000-000000000002'
const OWNER_A = 'data-007-api-owner-a'
const OWNER_B = 'data-007-api-owner-b'
const NUMERIC_FIELD = '6d000000-0000-4000-8000-000000000007'
const SECRET = process.env.PGRST_JWT_SECRET ?? ''
const GUARDED_TABLES = [
  'datasets',
  'dataset_versions',
  'dataset_version_rows',
  'dataset_version_values',
  'dataset_schema_definitions',
  'dataset_schema_versions',
  'dataset_schema_version_fields',
]
let admin: Client
let datasetId: string

function proxy(
  path: string,
  userId: string,
  workspaceId: string,
  init: RequestInit = {},
) {
  return handleProxyRequest(
    new Request(`http://sheetbase.test/api/db/${path}`, init),
    path.split('?')[0],
    {
      getSession: async () => ({
        user: { id: userId },
        session: { id: 'data-007-session' },
      }),
      getWorkspaceForUser: async () => ({ id: workspaceId }),
      mintToken: (input) => mintPostgrestToken(SECRET, input),
      upstreamBaseUrl: process.env.POSTGREST_URL ?? 'http://localhost:3001',
    },
  )
}

function rpc(
  name: string,
  body: Record<string, unknown>,
  userId = OWNER_A,
  workspaceId = WS_A,
) {
  return proxy(`rpc/${name}`, userId, workspaceId, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  })
}

beforeAll(async () => {
  if (!SECRET) throw new Error('PGRST_JWT_SECRET is required for API tests.')
  admin = new Client({ connectionString: process.env.DATABASE_URL })
  await admin.connect()
  for (const [id, name, email] of [
    [OWNER_A, 'Owner A', 'data-007-a@test.invalid'],
    [OWNER_B, 'Owner B', 'data-007-b@test.invalid'],
  ] as const)
    await admin.query(
      `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES ($1,$2,$3,true)`,
      [id, name, email],
    )
  await admin.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES ($1,'data-007-a','DATA-007 A'),($2,'data-007-b','DATA-007 B')`,
    [WS_A, WS_B],
  )
  await admin.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES ($1,$2,'owner'),($3,$4,'owner')`,
    [WS_A, OWNER_A, WS_B, OWNER_B],
  )
  const project = await rpc('create_project', {
    p_title: 'Dataset explorer project',
  })
  expect(project.status).toBe(200)
  const projectId: string = (await project.json()).id
  const created = await rpc('create_dataset_schema_definition', {
    p_workspace_id: WS_A,
    p_key: 'stability_result',
    p_name: 'Stability Result',
    p_description: 'DATA-007 contract dataset',
    p_fields: [
      {
        field_id: NUMERIC_FIELD,
        key: 'titer',
        label: 'Titer',
        logical_type: 'decimal',
        nullable: true,
      },
    ],
  })
  expect(created.status).toBe(200)
  const schemaVersionId = (await created.json()).schema_version_id
  const published = await rpc('publish_dataset_schema_version', {
    p_schema_version_id: schemaVersionId,
  })
  expect(published.status).toBe(200)
  const dataset = await proxy('datasets', OWNER_A, WS_A, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      prefer: 'return=representation',
    },
    body: JSON.stringify({
      workspace_id: WS_A,
      primary_project_id: projectId,
      schema_version_id: schemaVersionId,
      name: 'Stability A',
    }),
  })
  expect(dataset.status).toBe(201)
  datasetId = (await dataset.json())[0].id
  const committed = await rpc('commit_dataset_row_batch', {
    p_dataset_id: datasetId,
    p_expected_dataset_revision: 1,
    p_rows: [3.5, 1, 2].map((value) => ({
      operation: 'create',
      rowId: randomUUID(),
      values: { [NUMERIC_FIELD]: value },
    })),
    p_idempotency_key: 'dataset-explorer-fixture',
  })
  expect(committed.status).toBe(200)
  expect(await committed.json()).toMatchObject({
    ok: true,
    datasetId,
    datasetRevision: 2,
  })
})

afterAll(async () => {
  if (admin) {
    try {
      const guards = await admin.query<{ enabled: boolean }>(
        `SELECT bool_and(tgenabled='O') enabled FROM pg_trigger
         WHERE tgrelid IN (SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='api' AND c.relname=ANY($1::text[])) AND NOT tgisinternal`,
        [GUARDED_TABLES],
      )
      expect(guards.rows[0].enabled).toBe(true)
    } finally {
      await admin.end()
    }
  }
})

describe('DATA-007 Dataset Explorer contract', () => {
  it('lists only RLS-visible canonical datasets', async () => {
    const owner = await proxy('datasets?select=id,name', OWNER_A, WS_A)
    expect(owner.status).toBe(200)
    expect(await owner.json()).toEqual([{ id: datasetId, name: 'Stability A' }])
    const other = await proxy('datasets?select=id,name', OWNER_B, WS_B)
    expect(other.status).toBe(200)
    expect(await other.json()).toEqual([])
  })

  it('pages canonical rows with an authoritative total and stable sorting', async () => {
    const query = { sort: { fieldId: NUMERIC_FIELD, direction: 'asc' } }
    const first = await rpc('query_dataset_rows', {
      p_dataset_id: datasetId,
      p_query: query,
      p_limit: 2,
      p_offset: 0,
    })
    expect(first.status).toBe(200)
    expect(await first.json()).toMatchObject({
      totalCount: 3,
      limit: 2,
      offset: 0,
      hasMore: true,
      rows: [
        { values: { [NUMERIC_FIELD]: 1 } },
        { values: { [NUMERIC_FIELD]: 2 } },
      ],
    })
    const last = await rpc('query_dataset_rows', {
      p_dataset_id: datasetId,
      p_query: query,
      p_limit: 2,
      p_offset: 2,
    })
    expect(last.status).toBe(200)
    expect(await last.json()).toMatchObject({
      totalCount: 3,
      hasMore: false,
      rows: [{ values: { [NUMERIC_FIELD]: 3.5 } }],
    })
    const filtered = await rpc('query_dataset_rows', {
      p_dataset_id: datasetId,
      p_query: {
        ...query,
        filters: [{ fieldId: NUMERIC_FIELD, operator: 'gt', value: 1 }],
      },
      p_limit: 1,
      p_offset: 0,
    })
    expect(filtered.status).toBe(200)
    expect(await filtered.json()).toMatchObject({
      totalCount: 2,
      hasMore: true,
      rows: [{ values: { [NUMERIC_FIELD]: 2 } }],
    })
  })

  it('accepts the 1000-row query ceiling and rejects oversized requests', async () => {
    const allowed = await rpc('query_dataset_rows', {
      p_dataset_id: datasetId,
      p_query: {},
      p_limit: 1000,
      p_offset: 0,
    })
    expect(allowed.status).toBe(200)
    expect(await allowed.json()).toMatchObject({
      limit: 1000,
      totalCount: 3,
      hasMore: false,
    })
    for (const limit of [1001, 99999]) {
      const denied = await rpc('query_dataset_rows', {
        p_dataset_id: datasetId,
        p_query: {},
        p_limit: limit,
        p_offset: 0,
      })
      expect(denied.status).toBe(400)
      expect((await denied.json()).error.category).toBe('validation_error')
    }
  })

  it('rejects an invalid non-object filter envelope', async () => {
    const res = await rpc('query_dataset_rows', {
      p_dataset_id: datasetId,
      p_query: { filters: 'not-an-array' },
      p_limit: 10,
      p_offset: 0,
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error.category).toBe('validation_error')
  })

  it('denies a cross-workspace canonical row query', async () => {
    const res = await rpc(
      'query_dataset_rows',
      { p_dataset_id: datasetId, p_query: {}, p_limit: 100, p_offset: 0 },
      OWNER_B,
      WS_B,
    )
    expect(res.status).toBe(403)
    expect((await res.json()).error.category).toBe('permission_denied')
  })

  it('rejects invalid transformation specs before any request is built', () => {
    expect(
      validateTransformations([
        { kind: 'unknown' as unknown as 'aggregate', params: {} },
      ]).ok,
    ).toBe(false)
    expect(
      validateTransformations([
        { kind: 'aggregate', params: {} },
        { kind: 'bin', params: {} },
        { kind: 'normalise', params: {} },
        { kind: 'aggregate', params: {} },
        { kind: 'bin', params: {} },
      ]).ok,
    ).toBe(false)
  })
})
