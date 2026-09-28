/**
 * SCI-001 API contract proof: authenticated CRUD, lifecycle RPC, filters,
 * archive behaviour, invalid properties, cross-workspace isolation, and
 * actor/event parity — all through the same-origin /api/db proxy against the
 * running PostgREST service.
 */
import { config } from 'dotenv'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import * as schema from '#/db/schema'
import { resolveExternalToken } from '#/lib/external-token'
import { mintPostgrestToken } from '#/lib/postgrest-token'
import { handleProxyRequest } from '#/lib/postgrest-proxy'

config({ path: ['.env.local', '.env'] })

const WS_A = '6a000000-0000-4000-8000-000000000001'
const WS_B = '6a000000-0000-4000-8000-000000000002'
const PROJ_A = '6a000000-0000-4000-8000-000000000003'
const PROJ_B = '6a000000-0000-4000-8000-000000000004'
const OWNER_A = 'sci-api-owner-a'
const OWNER_B = 'sci-api-owner-b'
const SECRET = process.env.PGRST_JWT_SECRET ?? ''

let admin: Client
let database: ReturnType<typeof drizzle<typeof schema>>

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
  await admin.query(
    `DELETE FROM api.record_field_definitions WHERE workspace_id IN ($1,$2)`,
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
        session: { id: 'sci-api-session' },
      }),
      getWorkspaceForUser: async () => ({ id: wsId }),
      mintToken: (input) => mintPostgrestToken(SECRET, input),
      resolveExternalToken: () => Promise.resolve(null),
      upstreamBaseUrl: process.env.POSTGREST_URL ?? 'http://localhost:3001',
    },
  )
}

function json(res: Response): Promise<any> {
  return res.json()
}

beforeAll(async () => {
  if (!SECRET) throw new Error('PGRST_JWT_SECRET is required for API tests.')
  admin = new Client({ connectionString: process.env.DATABASE_URL })
  await admin.connect()
  database = drizzle(process.env.DATABASE_URL ?? '', { schema })
  await clean()
  await admin.query(
    `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES
      ($1,'SCI API Owner A','sci-api-a@test.invalid',true),
      ($2,'SCI API Owner B','sci-api-b@test.invalid',true)`,
    [OWNER_A, OWNER_B],
  )
  await admin.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES
      ($1,'sci-api-a','SCI API A'),($2,'sci-api-b','SCI API B')`,
    [WS_A, WS_B],
  )
  await admin.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES
      ($1,$3,'owner'),($2,$4,'owner')`,
    [WS_A, WS_B, OWNER_A, OWNER_B],
  )
  await admin.query(
    `INSERT INTO api.projects(id,workspace_id,key,title) VALUES
      ($1,$2,'sciapi','SCI API A'),($3,$4,'scib','SCI API B')`,
    [PROJ_A, WS_A, PROJ_B, WS_B],
  )
})

afterAll(async () => {
  if (admin) {
    await clean()
    await admin.end()
  }
  await database?.$client.end()
})

describe('SCI-001 scientific records REST contract', () => {
  it('creates a sample through the create_record RPC with stable identifier', async () => {
    const res = await proxy('rpc/create_record', OWNER_A, WS_A, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        p_project_id: PROJ_A,
        p_kind: 'sample',
        p_title: 'Virus stock API',
        p_status: 'available',
      }),
    })
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.identifier).toMatch(/^SMP-\d{4}$/)
    expect(body.kind).toBe('sample')
    expect(body.status).toBe('available')
    expect(body.created_by_user_id).toBe(OWNER_A)
  })

  it('lists samples filtered by kind through the records resource', async () => {
    // Create a second sample so the filter has something to distinguish.
    await proxy('rpc/create_record', OWNER_A, WS_A, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        p_project_id: PROJ_A,
        p_kind: 'sample',
        p_title: 'Virus stock API 2',
        p_status: 'available',
      }),
    })
    const res = await proxy(
      'records?kind=eq.sample&order=identifier.asc',
      OWNER_A,
      WS_A,
    )
    expect(res.status).toBe(200)
    const rows = await json(res)
    expect(rows.length).toBeGreaterThanOrEqual(2)
    expect(rows.every((r: any) => r.kind === 'sample')).toBe(true)
  })

  it('updates a sample title through authenticated PATCH', async () => {
    const created = await proxy('rpc/create_record', OWNER_A, WS_A, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        p_project_id: PROJ_A,
        p_kind: 'sample',
        p_title: 'Rename me',
        p_status: 'available',
      }),
    })
    const record = await json(created)
    const patched = await proxy(`records?id=eq.${record.id}`, OWNER_A, WS_A, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        prefer: 'return=representation',
      },
      body: JSON.stringify({ title: 'Renamed sample' }),
    })
    expect(patched.status).toBe(200)
    const rows = await json(patched)
    expect(rows[0].title).toBe('Renamed sample')
  })

  it('transitions a sample through the lifecycle RPC', async () => {
    const created = await proxy('rpc/create_record', OWNER_A, WS_A, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        p_project_id: PROJ_A,
        p_kind: 'sample',
        p_title: 'Transition me',
        p_status: 'available',
      }),
    })
    const record = await json(created)
    const res = await proxy('rpc/transition_record_status', OWNER_A, WS_A, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        p_record_id: record.id,
        p_target_status: 'reserved',
        p_expected_metadata_version: record.metadata_version,
      }),
    })
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.status).toBe('reserved')
    expect(body.metadata_version).toBe(record.metadata_version + 1)
    expect(body.updated_by_user_id).toBe(OWNER_A)
  })

  it('rejects an invalid lifecycle transition with invalid_transition (422)', async () => {
    const created = await proxy('rpc/create_record', OWNER_A, WS_A, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        p_project_id: PROJ_A,
        p_kind: 'sample',
        p_title: 'No transition',
        p_status: 'consumed',
      }),
    })
    const record = await json(created)
    const res = await proxy('rpc/transition_record_status', OWNER_A, WS_A, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        p_record_id: record.id,
        p_target_status: 'available',
        p_expected_metadata_version: record.metadata_version,
      }),
    })
    expect(res.status).toBe(422)
    const body = await json(res)
    expect(body.error.category).toBe('invalid_transition')
  })

  it('rejects an unknown legacy property (SB070)', async () => {
    const res = await proxy('rpc/create_record', OWNER_A, WS_A, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        p_project_id: PROJ_A,
        p_kind: 'sample',
        p_title: 'Bad props',
        p_status: 'available',
        p_properties: { approved: 'yes' },
      }),
    })
    expect(res.status).toBe(400)
    const body = await json(res)
    expect(body.error.category).toBe('validation_error')
    expect(body.error.message).toContain('unknown legacy property')
  })

  it('isolates records across workspaces (cross-workspace read returns nothing)', async () => {
    // Create a record in workspace B.
    await proxy('rpc/create_record', OWNER_B, WS_B, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        p_project_id: PROJ_B,
        p_kind: 'sample',
        p_title: 'Workspace B secret',
        p_status: 'available',
      }),
    })
    // Owner A cannot see workspace B's records.
    const res = await proxy('records?kind=eq.sample', OWNER_A, WS_A)
    const rows = await json(res)
    expect(rows.every((r: any) => r.title !== 'Workspace B secret')).toBe(true)
  })

  it('archives a record and keeps it readable', async () => {
    const created = await proxy('rpc/create_record', OWNER_A, WS_A, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        p_project_id: PROJ_A,
        p_kind: 'sample',
        p_title: 'Archive me',
        p_status: 'available',
      }),
    })
    const record = await json(created)
    const archived = await proxy(`records?id=eq.${record.id}`, OWNER_A, WS_A, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        prefer: 'return=representation',
      },
      body: JSON.stringify({ archived_at: new Date().toISOString() }),
    })
    expect(archived.status).toBe(200)
    // Archived record is still readable.
    const res = await proxy(`records?id=eq.${record.id}`, OWNER_A, WS_A)
    const rows = await json(res)
    expect(rows).toHaveLength(1)
    expect(rows[0].archived_at).not.toBeNull()
  })

  it('rejects lifecycle transitions on archived records (frozen)', async () => {
    const created = await proxy('rpc/create_record', OWNER_A, WS_A, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        p_project_id: PROJ_A,
        p_kind: 'sample',
        p_title: 'Frozen archived',
        p_status: 'available',
      }),
    })
    const record = await json(created)
    await proxy(`records?id=eq.${record.id}`, OWNER_A, WS_A, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        prefer: 'return=representation',
      },
      body: JSON.stringify({ archived_at: new Date().toISOString() }),
    })
    const res = await proxy('rpc/transition_record_status', OWNER_A, WS_A, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        p_record_id: record.id,
        p_target_status: 'reserved',
        p_expected_metadata_version: record.metadata_version,
      }),
    })
    expect(res.status).toBe(422)
    const body = await json(res)
    expect(body.error.category).toBe('invalid_transition')
  })

  it('emits a durable change event attributed to the acting user', async () => {
    const created = await proxy('rpc/create_record', OWNER_A, WS_A, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        p_project_id: PROJ_A,
        p_kind: 'reagent',
        p_title: 'Event proof reagent',
        p_status: 'available',
      }),
    })
    const record = await json(created)
    const events = await admin.query(
      `SELECT * FROM api.change_events
        WHERE entity_type = 'record' AND entity_uuid = $1
        ORDER BY created_at DESC LIMIT 1`,
      [record.id],
    )
    expect(events.rows).toHaveLength(1)
    expect(events.rows[0].actor_user_id).toBe(OWNER_A)
    expect(events.rows[0].operation).toBe('create')
  })
})
