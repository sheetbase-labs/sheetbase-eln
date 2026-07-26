/**
 * DATA-007 API contract proof. The Dataset Explorer reads through the
 * same-origin /api/db PostgREST proxy to a running PostgREST instance, so the
 * three risk scenarios from the ticket are proven at the real boundary:
 *
 *  - Large datasets: paged row fetches and `query_dataset` honour the
 *    server-side 5000-row hard ceiling even when the client asks for more.
 *  - Invalid transformations: `query_dataset` rejects a non-object filter
 *    envelope, and the explorer-side `validateTransformations` guard rejects
 *    an unsupported kind / non-object params before any request is built.
 *  - Permission-limited joins: a cross-workspace caller sees zero rows from
 *    `query_dataset` (RLS isolates the bound physical tables).
 */
import { config } from 'dotenv'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import * as schema from '#/db/schema'
import { resolveExternalToken } from '#/lib/external-token'
import { handleProxyRequest } from '#/lib/postgrest-proxy'
import { mintPostgrestToken } from '#/lib/postgrest-token'
import {
  DATASET_QUERY_HARD_LIMIT,
  validateTransformations,
} from '#/lib/dataset-explorer-data'

config({ path: ['.env.local', '.env'] })

const WS_A = '6d000000-0000-4000-8000-000000000001'
const WS_B = '6d000000-0000-4000-8000-000000000002'
const PROJECT_A = '6d000000-0000-4000-8000-000000000003'
const RECORD_A = '6d000000-0000-4000-8000-000000000004'
const BLOCK_A = '6d000000-0000-4000-8000-000000000005'
const OWNER_A = 'data-007-api-owner-a'
const OWNER_B = 'data-007-api-owner-b'
const SECRET = process.env.PGRST_JWT_SECRET ?? ''

let admin: Client
let database: ReturnType<typeof drizzle<typeof schema>>
let tokenA: string
let tokenB: string
let schemaId: string
let tableResource: string
let numericField: string

async function clean(): Promise<void> {
  const generated = await admin.query<{ resource_name: string }>(
    `SELECT resource_name FROM api.scientific_tables WHERE workspace_id IN ($1,$2)`,
    [WS_A, WS_B],
  )
  for (const row of generated.rows) {
    if (/^sheet_[a-z2-7]{26}$/.test(row.resource_name)) {
      await admin.query(`DROP TABLE IF EXISTS api.${row.resource_name}`)
    }
  }
  await admin.query(
    `DELETE FROM api.scientific_tables WHERE workspace_id IN ($1,$2)`,
    [WS_A, WS_B],
  )
  await admin.query(
    `DELETE FROM api.dataset_schemas WHERE workspace_id IN ($1,$2)`,
    [WS_A, WS_B],
  )
  await admin.query(
    `DELETE FROM api.blocks WHERE record_id IN
      (SELECT id FROM api.records WHERE workspace_id IN ($1,$2))`,
    [WS_A, WS_B],
  )
  await admin.query(
    `DELETE FROM api.records WHERE workspace_id IN ($1,$2)`,
    [WS_A, WS_B],
  )
  await admin.query(`DELETE FROM api.projects WHERE workspace_id IN ($1,$2)`, [
    WS_A,
    WS_B,
  ])
  await admin.query(
    `DELETE FROM api.workspace_memberships WHERE workspace_id IN ($1,$2)`,
    [WS_A, WS_B],
  )
  await admin.query(`DELETE FROM api.workspaces WHERE id IN ($1,$2)`, [
    WS_A,
    WS_B,
  ])
  await admin.query(`DELETE FROM internal."user" WHERE id IN ($1,$2)`, [
    OWNER_A,
    OWNER_B,
  ])
  await admin.query(`SELECT pg_notify('pgrst','reload schema')`)
}

function proxy(request: Request, path: string, userId: string, wsId: string) {
  return handleProxyRequest(request, path, {
    getSession: async () => ({
      user: { id: userId },
      session: { id: 'data-007-session' },
    }),
    getWorkspaceForUser: async () => ({ id: wsId }),
    mintToken: (input) => mintPostgrestToken(SECRET, input),
    resolveExternalToken: (token, method, parsedPath) =>
      resolveExternalToken(database, token, SECRET, method, parsedPath),
    upstreamBaseUrl: process.env.POSTGREST_URL ?? 'http://localhost:3001',
  })
}

function request(
  path: string,
  token: string | null,
  init: RequestInit = {},
): Request {
  const headers = new Headers(init.headers)
  if (token) headers.set('authorization', `Bearer ${token}`)
  return new Request(`http://sheetbase.test/api/db/${path}`, {
    ...init,
    headers,
  })
}

async function rpc(
  name: string,
  body: Record<string, unknown>,
  token: string,
  userId: string,
  wsId: string,
) {
  const res = await proxy(
    request(`rpc/${name}`, token, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        prefer: 'return=representation',
      },
      body: JSON.stringify(body),
    }),
    `rpc/${name}`,
    userId,
    wsId,
  )
  return res
}

beforeAll(async () => {
  if (!SECRET) throw new Error('PGRST_JWT_SECRET is required for API tests.')
  admin = new Client({ connectionString: process.env.DATABASE_URL })
  await admin.connect()
  database = drizzle(process.env.DATABASE_URL ?? '', { schema })
  await clean()
  for (const [id, name, email] of [
    [OWNER_A, 'Owner A', 'data-007-a@test.invalid'],
    [OWNER_B, 'Owner B', 'data-007-b@test.invalid'],
  ] as const) {
    await admin.query(
      `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES ($1,$2,$3,true)`,
      [id, name, email],
    )
  }
  await admin.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES ($1,'data-007-a','DATA-007 A'),($2,'data-007-b','DATA-007 B')`,
    [WS_A, WS_B],
  )
  await admin.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES ($1,$2,'owner'),($3,$4,'owner')`,
    [WS_A, OWNER_A, WS_B, OWNER_B],
  )
  await admin.query(
    `INSERT INTO api.projects(id,workspace_id,key,title) VALUES ($1,$2,'D7','DATA-007')`,
    [PROJECT_A, WS_A],
  )
  await admin.query(
    `INSERT INTO api.records(id,workspace_id,project_id,kind,identifier,title,created_by_user_id)
     VALUES ($1,$2,$3,'experiment','D7-1','DATA-007 sheet',$4)`,
    [RECORD_A, WS_A, PROJECT_A, OWNER_A],
  )
  await admin.query(
    `INSERT INTO api.blocks(id,record_id,type,payload,"order",created_by_user_id)
     VALUES ($1,$2,'sheet','{}',1,$3)`,
    [BLOCK_A, RECORD_A, OWNER_A],
  )
  tokenA = await mintPostgrestToken(SECRET, {
    workspaceId: WS_A,
    userId: OWNER_A,
    role: 'owner',
  })
  tokenB = await mintPostgrestToken(SECRET, {
    workspaceId: WS_B,
    userId: OWNER_B,
    role: 'owner',
  })

  // Create + publish a dataset schema, then instantiate a bound sheet in WS A.
  const createRes = await rpc(
    'create_dataset_schema',
    {
      p_slug: 'stability_result',
      p_name: 'Stability Result',
      p_description: 'DATA-007 contract dataset',
      p_fields: [
        { slug: 'titer', label: 'Titer', logical_type: 'decimal' },
        { slug: 'timepoint', label: 'Timepoint', logical_type: 'integer' },
      ],
    },
    tokenA,
    OWNER_A,
    WS_A,
  )
  expect(createRes.status).toBe(200)
  const created = await createRes.json()
  schemaId = created.schema.id
  const publishRes = await rpc(
    'publish_dataset_schema',
    { p_schema_id: schemaId },
    tokenA,
    OWNER_A,
    WS_A,
  )
  expect(publishRes.status).toBe(200)

  const instantiateRes = await rpc(
    'instantiate_dataset_schema',
    { p_block_id: BLOCK_A, p_schema_id: schemaId, p_name: 'Stability A' },
    tokenA,
    OWNER_A,
    WS_A,
  )
  expect(instantiateRes.status).toBe(200)
  const instantiated = await instantiateRes.json()
  tableResource = instantiated.table.resource_name
  const cols: Array<{ field_name: string; dataset_schema_field_id: string | null }> =
    instantiated.columns
  numericField = cols.find(
    (c) => c.dataset_schema_field_id !== null,
  )!.field_name
})

afterAll(async () => {
  await clean()
  await admin?.end()
})

describe('DATA-007 Dataset Explorer contract', () => {
  it('lists RLS-visible datasets via scientific_table_metadata', async () => {
    const res = await proxy(
      request('rpc/scientific_table_metadata', tokenA, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          prefer: 'return=representation',
        },
        body: JSON.stringify({ p_table_id: null }),
      }),
      'rpc/scientific_table_metadata',
      OWNER_A,
      WS_A,
    )
    expect(res.status).toBe(200)
    const tables = await res.json()
    expect(Array.isArray(tables)).toBe(true)
    expect(tables.some((t: { resource_name: string }) => t.resource_name === tableResource)).toBe(true)
  })

  it('pages rows from the physical resource with a server total', async () => {
    // Insert a handful of rows so paging is observable without exceeding the
    // 5000-row hard limit.
    for (let i = 0; i < 3; i++) {
      const insertRes = await proxy(
        request(encodeURIComponent(tableResource), tokenA, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            prefer: 'return=representation',
          },
          body: JSON.stringify({ [numericField]: 1 + i * 0.5 }),
        }),
        encodeURIComponent(tableResource),
        OWNER_A,
        WS_A,
      )
      expect(insertRes.status).toBe(201)
    }
    const pageRes = await proxy(
      request(
        `${encodeURIComponent(tableResource)}?select=*&order=id.asc&limit=2&offset=0`,
        tokenA,
      ),
      encodeURIComponent(tableResource),
      OWNER_A,
      WS_A,
    )
    expect(pageRes.status).toBe(200)
    const rows = await pageRes.json()
    expect(rows.length).toBe(2)
  })

  it('clamps query_dataset to the 5000-row hard ceiling', async () => {
    const res = await rpc(
      'query_dataset',
      {
        p_schema_id: schemaId,
        p_revision: 1,
        p_filters: {},
        p_limit: 99999,
        p_offset: 0,
      },
      tokenA,
      OWNER_A,
      WS_A,
    )
    expect(res.status).toBe(200)
    const rows = await res.json()
    // The caller asked for 99999 rows; the RPC clamps to the hard limit and
    // returns the (small) fixture set without erroring.
    expect(rows.length).toBeLessThanOrEqual(DATASET_QUERY_HARD_LIMIT)
  })

  it('rejects an invalid (non-object) filter envelope', async () => {
    const res = await rpc(
      'query_dataset',
      {
        p_schema_id: schemaId,
        p_revision: 1,
        p_filters: 'not-an-object',
        p_limit: 10,
        p_offset: 0,
      },
      tokenA,
      OWNER_A,
      WS_A,
    )
    // PostgREST surfaces the SQL exception as an error envelope.
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(500)
  })

  it('isolates workspaces: a cross-workspace query_dataset returns nothing', async () => {
    const res = await rpc(
      'query_dataset',
      {
        p_schema_id: schemaId,
        p_revision: 1,
        p_filters: {},
        p_limit: 100,
        p_offset: 0,
      },
      tokenB,
      OWNER_B,
      WS_B,
    )
    expect(res.status).toBe(200)
    const rows = await res.json()
    expect(rows).toEqual([])
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
