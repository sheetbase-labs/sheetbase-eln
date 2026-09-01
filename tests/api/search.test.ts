/**
 * SCI-008 API contract proof: the search RPC is reachable through the
 * same-origin /api/db proxy, respects authentication, workspace isolation,
 * filters, pagination, archived-result behaviour, and does not leak
 * restricted fields (no storage keys, checksums, full block payloads or
 * property values).
 */
import { config } from 'dotenv'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { mintPostgrestToken } from '#/lib/postgrest-token'
import { handleProxyRequest } from '#/lib/postgrest-proxy'

config({ path: ['.env.local', '.env'] })

const WS_A = '6a000000-0000-4000-8000-0000000a0001'
const WS_B = '6a000000-0000-4000-8000-0000000a0002'
const PROJ_A = '6a000000-0000-4000-8000-0000000a0003'
const PROJ_B = '6a000000-0000-4000-8000-0000000a0004'
const OWNER_A = 'sci008-api-owner-a'
const OWNER_B = 'sci008-api-owner-b'
const SECRET = process.env.PGRST_JWT_SECRET ?? ''

let admin: Client

async function clean(): Promise<void> {
  await admin.query(
    `DELETE FROM api.record_links WHERE source_record_id IN (
      SELECT id FROM api.records WHERE workspace_id IN ($1,$2))`,
    [WS_A, WS_B],
  )
  await admin.query(`DELETE FROM api.records WHERE workspace_id IN ($1,$2)`, [
    WS_A,
    WS_B,
  ])
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
}

function proxy(
  path: string,
  userId: string,
  wsId: string,
  init: RequestInit = {},
) {
  const headers = new Headers(init.headers)
  const resourcePath = path.split('?')[0]
  return handleProxyRequest(
    new Request(`http://sheetbase.test/api/db/${path}`, { ...init, headers }),
    resourcePath,
    {
      getSession: async () => ({
        user: { id: userId },
        session: { id: 'sci008-api-session' },
      }),
      getWorkspaceForUser: async () => ({ id: wsId }),
      mintToken: (input) => mintPostgrestToken(SECRET, input),
      resolveExternalToken: () => Promise.resolve(null),
      upstreamBaseUrl: process.env.POSTGREST_URL ?? 'http://localhost:3001',
    },
  )
}

async function searchRpc(
  userId: string,
  wsId: string,
  args: Record<string, unknown>,
): Promise<{ status: number; body: any }> {
  const res = await proxy('rpc/search', userId, wsId, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(args),
  })
  return { status: res.status, body: await res.json() }
}

async function createRecord(
  userId: string,
  wsId: string,
  kind: string,
  title: string,
  status = 'draft',
): Promise<any> {
  const res = await proxy('rpc/create_record', userId, wsId, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      p_project_id: kind === 'sample' || kind === 'reagent' ? PROJ_A : PROJ_A,
      p_kind: kind,
      p_title: title,
      p_status: status,
    }),
  })
  return res.json()
}

beforeAll(async () => {
  if (!SECRET) throw new Error('PGRST_JWT_SECRET is required for API tests.')
  admin = new Client({ connectionString: process.env.DATABASE_URL })
  await admin.connect()
  await clean()
  await admin.query(
    `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES
      ($1,'SCI008 API A','sci008-a@test.invalid',true),
      ($2,'SCI008 API B','sci008-b@test.invalid',true)`,
    [OWNER_A, OWNER_B],
  )
  await admin.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES
      ($1,'sci008-api-a','SCI008 API A'),($2,'sci008-api-b','SCI008 API B')`,
    [WS_A, WS_B],
  )
  await admin.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES
      ($1,$3,'owner'),($2,$4,'owner')`,
    [WS_A, WS_B, OWNER_A, OWNER_B],
  )
  await admin.query(
    `INSERT INTO api.projects(id,workspace_id,key,title) VALUES
      ($1,$2,'sci008a','SCI008 API A'),($3,$4,'sci008b','SCI008 API B')`,
    [PROJ_A, WS_A, PROJ_B, WS_B],
  )
})

afterAll(async () => {
  if (admin) {
    await clean()
    await admin.end()
  }
})

describe('SCI-008 search RPC contract', () => {
  it('returns results for an authenticated query', async () => {
    await createRecord(
      OWNER_A,
      WS_A,
      'experiment',
      'API search contract experiment',
    )
    const { status, body } = await searchRpc(OWNER_A, WS_A, {
      p_query: 'contract experiment',
    })
    expect(status).toBe(200)
    const rows = Array.isArray(body) ? body : [body]
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0]).toHaveProperty('result_type')
    expect(rows[0]).toHaveProperty('deep_link')
    expect(rows[0]).toHaveProperty('matched_context')
  })

  it('returns browse results for an empty query', async () => {
    const { status, body } = await searchRpc(OWNER_A, WS_A, {
      p_query: '',
      p_limit: 5,
    })
    expect(status).toBe(200)
    const rows = Array.isArray(body) ? body : [body]
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0].matched_field).toBe('title')
  })

  it('filters by kind', async () => {
    await createRecord(
      OWNER_A,
      WS_A,
      'sample',
      'API filter sample',
      'available',
    )
    const { body } = await searchRpc(OWNER_A, WS_A, {
      p_query: '',
      p_kind: 'sample',
    })
    const rows = Array.isArray(body) ? body : [body]
    expect(rows.every((r: any) => r.kind === 'sample')).toBe(true)
  })

  it('filters by status', async () => {
    const { body } = await searchRpc(OWNER_A, WS_A, {
      p_query: '',
      p_status: 'available',
    })
    const rows = Array.isArray(body) ? body : [body]
    expect(rows.every((r: any) => r.status === 'available')).toBe(true)
  })

  it('filters by project', async () => {
    const { body } = await searchRpc(OWNER_A, WS_A, {
      p_query: '',
      p_project_id: PROJ_A,
    })
    const rows = Array.isArray(body) ? body : [body]
    expect(rows.every((r: any) => r.project_id === PROJ_A)).toBe(true)
  })

  it('filters by owner', async () => {
    const { body } = await searchRpc(OWNER_A, WS_A, {
      p_query: '',
      p_owner_id: OWNER_A,
    })
    const rows = Array.isArray(body) ? body : [body]
    expect(rows.every((r: any) => r.created_by_user_id === OWNER_A)).toBe(true)
  })

  it('combines multiple filters', async () => {
    const { body } = await searchRpc(OWNER_A, WS_A, {
      p_query: '',
      p_kind: 'sample',
      p_status: 'available',
      p_project_id: PROJ_A,
    })
    const rows = Array.isArray(body) ? body : [body]
    expect(
      rows.every(
        (r: any) =>
          r.kind === 'sample' &&
          r.status === 'available' &&
          r.project_id === PROJ_A,
      ),
    ).toBe(true)
  })

  it('paginates with limit and offset', async () => {
    const { body: body1 } = await searchRpc(OWNER_A, WS_A, {
      p_query: '',
      p_limit: 2,
      p_offset: 0,
    })
    const { body: body2 } = await searchRpc(OWNER_A, WS_A, {
      p_query: '',
      p_limit: 2,
      p_offset: 2,
    })
    const page1 = Array.isArray(body1) ? body1 : [body1]
    const page2 = Array.isArray(body2) ? body2 : [body2]
    expect(page1).toHaveLength(2)
    const ids1 = new Set(page1.map((r: any) => r.record_id))
    expect(page2.every((r: any) => !ids1.has(r.record_id))).toBe(true)
  })

  it('does not return cross-workspace records', async () => {
    await createRecord(
      OWNER_B,
      WS_B,
      'experiment',
      'Cross workspace unique term wxyz',
    )
    const { body } = await searchRpc(OWNER_A, WS_A, {
      p_query: 'wxyz',
    })
    const rows = Array.isArray(body) ? body : [body]
    expect(rows).toHaveLength(0)
  })

  it('includes archived records with archived = true', async () => {
    const record = await createRecord(
      OWNER_A,
      WS_A,
      'sample',
      'Archived API search sample',
      'available',
    )
    await admin.query(
      `UPDATE api.records SET archived_at = now() WHERE id = $1`,
      [record.id],
    )
    const { body } = await searchRpc(OWNER_A, WS_A, {
      p_query: 'archived api search',
    })
    const rows = Array.isArray(body) ? body : [body]
    const hit = rows.find((r: any) => r.record_id === record.id)
    expect(hit).toBeDefined()
    expect(hit.archived).toBe(true)
  })

  it('does not leak restricted fields (no storage_key, checksum, payload, properties values)', async () => {
    // Create a file record with file_objects metadata.
    const {
      rows: [fileRec],
    } = await admin.query(
      `INSERT INTO api.records (workspace_id, project_id, kind, identifier, title, status, created_by_user_id)
       VALUES ($1, $2, 'file', 'FILE-API-0001', 'Restricted field test file', 'active', $3) RETURNING *`,
      [WS_A, PROJ_A, OWNER_A],
    )
    const hash = fileRec.id.replace(/-/g, '').padEnd(32, '0').slice(0, 32)
    await admin.query(
      `INSERT INTO api.file_objects (workspace_id, record_id, storage_key, display_name, media_type, byte_size, status, storage_backend, created_by_user_id, updated_by_user_id)
       VALUES ($1, $2, $3, 'restricted test file', 'text/plain', 100, 'active', 'local', $4, $4)`,
      [WS_A, fileRec.id, `${WS_A}/${fileRec.id}/${hash}`, OWNER_A],
    )
    const { body } = await searchRpc(OWNER_A, WS_A, {
      p_query: 'restricted test file',
    })
    const rows = Array.isArray(body) ? body : [body]
    const hit = rows.find((r: any) => r.record_id === fileRec.id)
    expect(hit).toBeDefined()
    // Result columns are metadata + matched context only.
    expect(hit).not.toHaveProperty('storage_key')
    expect(hit).not.toHaveProperty('checksum')
    expect(hit).not.toHaveProperty('payload')
    expect(hit).not.toHaveProperty('properties')
    expect(hit).not.toHaveProperty('byte_size')
    // The matched context is a short snippet, not full content.
    expect(hit.matched_context.length).toBeLessThan(500)
  })

  it('returns a typed result with stable deep link', async () => {
    const { body } = await searchRpc(OWNER_A, WS_A, {
      p_query: 'contract experiment',
    })
    const rows = Array.isArray(body) ? body : [body]
    const experiment = rows.find((r: any) => r.kind === 'experiment')
    expect(experiment).toBeDefined()
    expect(experiment.deep_link).toBe(`/records/${experiment.record_id}`)
    expect(experiment.result_type).toBe('record')
  })

  it('rejects unauthenticated requests', async () => {
    // No session → proxy returns 401 before reaching PostgREST.
    const res = await handleProxyRequest(
      new Request('http://sheetbase.test/api/db/rpc/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ p_query: 'test' }),
      }),
      'rpc/search',
      {
        getSession: async () => null,
        getWorkspaceForUser: async () => null,
        mintToken: () =>
          mintPostgrestToken(SECRET, {
            userId: '',
            workspaceId: '',
            sessionId: '',
          }),
        resolveExternalToken: () => Promise.resolve(null),
        upstreamBaseUrl: process.env.POSTGREST_URL ?? 'http://localhost:3001',
      },
    )
    expect(res.status).toBe(401)
  })
})
