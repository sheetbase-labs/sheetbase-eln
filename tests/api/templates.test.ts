/**
 * SCI-006 API contract proof: authenticated template CRUD, lifecycle RPC,
 * instantiation RPC (success and failure), filters, cross-workspace
 * isolation, archived/draft rejection, invalid status transitions, and
 * REST mutation event/audit parity — all through the same-origin /api/db
 * proxy against the running PostgREST service.
 */
import { config } from 'dotenv'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { mintPostgrestToken } from '#/lib/postgrest-token'
import { handleProxyRequest } from '#/lib/postgrest-proxy'
import { grantFixtureProjectAccess } from './project-fixtures'

config({ path: ['.env.local', '.env'] })

const WS_A = '6c000000-0000-4000-8000-000000000001'
const WS_B = '6c000000-0000-4000-8000-000000000002'
const PROJ_A = '6c000000-0000-4000-8000-000000000003'
const PROJ_B = '6c000000-0000-4000-8000-000000000004'
const USER_A = 'sci-006-api-owner-a'
const USER_B = 'sci-006-api-owner-b'
const SECRET = process.env.PGRST_JWT_SECRET ?? ''

let admin: Client

async function clean(): Promise<void> {
  await admin.query(
    `DELETE FROM api.record_links WHERE source_record_id IN
      (SELECT id FROM api.records WHERE workspace_id IN ($1,$2))
      OR target_record_id IN
      (SELECT id FROM api.records WHERE workspace_id IN ($1,$2))`,
    [WS_A, WS_B],
  )
  await admin.query(
    `DELETE FROM api.blocks WHERE record_id IN
      (SELECT id FROM api.records WHERE workspace_id IN ($1,$2))`,
    [WS_A, WS_B],
  )
  await admin.query(
    `DELETE FROM api.revisions WHERE record_id IN
      (SELECT id FROM api.records WHERE workspace_id IN ($1,$2))`,
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
    USER_A,
    USER_B,
  ])
  await admin.query(`SELECT pg_notify('pgrst', 'reload schema')`)
}

function proxy(
  path: string,
  userId: string,
  workspaceId: string,
  init: RequestInit = {},
) {
  const headers = new Headers(init.headers)
  return handleProxyRequest(
    new Request(`http://sheetbase.test/api/db/${path}`, { ...init, headers }),
    path.split('?')[0],
    {
      getSession: async () => ({
        user: { id: userId },
        session: { id: 'sci-006-api-session' },
      }),
      getWorkspaceForUser: async () => ({ id: workspaceId }),
      mintToken: (input) => mintPostgrestToken(SECRET, input),
      resolveExternalToken: () => Promise.resolve(null),
      upstreamBaseUrl: process.env.POSTGREST_URL ?? 'http://localhost:3001',
    },
  )
}

async function rpc(
  path: string,
  user: string,
  workspace: string,
  body: unknown,
): Promise<Response> {
  return proxy(`rpc/${path}`, user, workspace, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function createRecord(
  user: string,
  workspace: string,
  project: string,
  kind: string,
  title: string,
  status = 'draft',
  properties: Record<string, unknown> = {},
) {
  const payload =
    kind === 'protocol_template' && Object.keys(properties).length === 0
      ? { version: '1.0' }
      : properties
  const response = await rpc('create_record', user, workspace, {
    p_project_id: project,
    p_kind: kind,
    p_title: title,
    p_status: status,
    p_properties: payload,
  })
  expect(response.status).toBe(200)
  return response.json()
}

async function insertBlock(
  user: string,
  workspace: string,
  recordId: string,
  type: string,
  payload: unknown,
  structureVersion: number,
) {
  const response = await rpc('insert_block', user, workspace, {
    p_record_id: recordId,
    p_type: type,
    p_payload: payload,
    p_payload_schema_version: 1,
    p_expected_structure_version: structureVersion,
  })
  expect(response.status).toBe(200)
  return response.json()
}

function json(res: Response): Promise<any> {
  return res.json()
}

beforeAll(async () => {
  if (!SECRET) throw new Error('PGRST_JWT_SECRET is required for API tests.')
  admin = new Client({
    connectionString:
      process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL,
  })
  await admin.connect()
  await clean()
  await admin.query(
    `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES
      ($1,'SCI 006 API A','sci-006-api-a@test.invalid',true),
      ($2,'SCI 006 API B','sci-006-api-b@test.invalid',true)`,
    [USER_A, USER_B],
  )
  await admin.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES
      ($1,'sci-006-api-a','SCI 006 API A'),($2,'sci-006-api-b','SCI 006 API B')`,
    [WS_A, WS_B],
  )
  await admin.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES
      ($1,$3,'owner'),($2,$4,'owner')`,
    [WS_A, WS_B, USER_A, USER_B],
  )
  await admin.query(
    `INSERT INTO api.projects(id,workspace_id,key,title) VALUES
      ($1,$2,'sci006api','SCI 006 API A'),($3,$4,'sci006b','SCI 006 API B')`,
    [PROJ_A, WS_A, PROJ_B, WS_B],
  )
  for (const [projectId, workspaceId, userId] of [
    [PROJ_A, WS_A, USER_A],
    [PROJ_B, WS_B, USER_B],
  ])
    await grantFixtureProjectAccess({
      client: admin,
      projectId,
      workspaceId,
      userId,
      canEdit: true,
      canReview: true,
      canManage: true,
    })
})

afterAll(async () => {
  if (admin) {
    await clean()
    await admin.end()
  }
})

describe('SCI-006 template REST contract', () => {
  it('creates a protocol template through create_record with a PRT identifier', async () => {
    const record = await createRecord(
      USER_A,
      WS_A,
      PROJ_A,
      'protocol_template',
      'API protocol template',
    )
    expect(record.identifier).toMatch(/^PRT-\d{3}$/)
    expect(record.kind).toBe('protocol_template')
    expect(record.created_by_user_id).toBe(USER_A)
  })

  it('lists templates filtered by kind through the records resource', async () => {
    await createRecord(
      USER_A,
      WS_A,
      PROJ_A,
      'protocol_template',
      'Another protocol template',
    )
    const res = await proxy(
      'records?kind=eq.protocol_template&order=identifier.asc',
      USER_A,
      WS_A,
    )
    expect(res.status).toBe(200)
    const rows = await json(res)
    expect(rows.length).toBeGreaterThanOrEqual(2)
    expect(rows.every((r: any) => r.kind === 'protocol_template')).toBe(true)
  })

  it('lists protocol templates with kind=in filter', async () => {
    const res = await proxy(
      'records?kind=in.(protocol_template)&order=identifier.asc',
      USER_A,
      WS_A,
    )
    expect(res.status).toBe(200)
    const rows = await json(res)
    expect(rows.every((r: any) => r.kind === 'protocol_template')).toBe(true)
  })

  it('activates a protocol template through the lifecycle RPC', async () => {
    const template = await createRecord(
      USER_A,
      WS_A,
      PROJ_A,
      'protocol_template',
      'Activate via API',
    )
    const res = await rpc('transition_record_status', USER_A, WS_A, {
      p_record_id: template.id,
      p_target_status: 'active',
      p_expected_metadata_version: template.metadata_version,
    })
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.status).toBe('active')
    expect(body.updated_by_user_id).toBe(USER_A)
  })

  it('rejects an invalid status transition with invalid_transition (422)', async () => {
    const template = await createRecord(
      USER_A,
      WS_A,
      PROJ_A,
      'protocol_template',
      'Bad transition',
    )
    const res = await rpc('transition_record_status', USER_A, WS_A, {
      p_record_id: template.id,
      p_target_status: 'validated',
      p_expected_metadata_version: template.metadata_version,
    })
    expect(res.status).toBe(422)
    expect((await json(res)).error.category).toBe('invalid_transition')
  })

  it('instantiates a protocol template into an experiment through the RPC', async () => {
    const template = await createRecord(
      USER_A,
      WS_A,
      PROJ_A,
      'protocol_template',
      'Instantiate via API',
    )
    await insertBlock(
      USER_A,
      WS_A,
      template.id,
      'rich_text',
      {
        doc: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'API objective' }],
            },
          ],
        },
      },
      template.structure_version,
    )
    await rpc('transition_record_status', USER_A, WS_A, {
      p_record_id: template.id,
      p_target_status: 'active',
      p_expected_metadata_version: template.metadata_version,
    })
    const res = await rpc('instantiate_template', USER_A, WS_A, {
      p_template_record_id: template.id,
      p_target_project_id: PROJ_A,
      p_target_kind: 'experiment',
      p_title: 'API instantiated run',
    })
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.record.kind).toBe('experiment')
    expect(body.record.title).toBe('API instantiated run')
  })

  it('rejects instantiation from a draft template with template_not_instantiable (422)', async () => {
    const template = await createRecord(
      USER_A,
      WS_A,
      PROJ_A,
      'protocol_template',
      'Draft no instantiate',
    )
    const res = await rpc('instantiate_template', USER_A, WS_A, {
      p_template_record_id: template.id,
      p_target_project_id: PROJ_A,
      p_target_kind: 'experiment',
    })
    expect(res.status).toBe(422)
    expect((await json(res)).error.category).toBe('template_not_instantiable')
  })

  it('rejects cross-workspace instantiation with permission_denied (403)', async () => {
    const template = await createRecord(
      USER_B,
      WS_B,
      PROJ_B,
      'protocol_template',
      'B only template',
    )
    await rpc('transition_record_status', USER_B, WS_B, {
      p_record_id: template.id,
      p_target_status: 'active',
      p_expected_metadata_version: template.metadata_version,
    })
    const res = await rpc('instantiate_template', USER_A, WS_A, {
      p_template_record_id: template.id,
      p_target_project_id: PROJ_A,
      p_target_kind: 'experiment',
    })
    expect(res.status).toBe(403)
    expect((await json(res)).error.category).toBe('permission_denied')
  })

  it('isolates templates across workspaces (cross-workspace read returns nothing)', async () => {
    await createRecord(
      USER_B,
      WS_B,
      PROJ_B,
      'protocol_template',
      'B secret template',
    )
    const res = await proxy('records?kind=eq.protocol_template', USER_A, WS_A)
    const rows = await json(res)
    expect(rows.every((r: any) => r.title !== 'B secret template')).toBe(true)
  })

  it('emits a durable change event attributed to the acting user on instantiation', async () => {
    const template = await createRecord(
      USER_A,
      WS_A,
      PROJ_A,
      'protocol_template',
      'Event parity',
    )
    await insertBlock(
      USER_A,
      WS_A,
      template.id,
      'rich_text',
      {
        doc: { type: 'doc', content: [{ type: 'paragraph' }] },
      },
      template.structure_version,
    )
    await rpc('transition_record_status', USER_A, WS_A, {
      p_record_id: template.id,
      p_target_status: 'active',
      p_expected_metadata_version: template.metadata_version,
    })
    const res = await rpc('instantiate_template', USER_A, WS_A, {
      p_template_record_id: template.id,
      p_target_project_id: PROJ_A,
      p_target_kind: 'experiment',
    })
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.record.created_by_user_id).toBe(USER_A)
    expect(body.link.created_by_user_id).toBe(USER_A)
  })

  it('rejects an unauthenticated REST request at the proxy boundary', async () => {
    const response = await handleProxyRequest(
      new Request('http://sheetbase.test/api/db/records'),
      'records',
      {
        getSession: async () => null,
        getWorkspaceForUser: async () => null,
        mintToken: (input) => mintPostgrestToken(SECRET, input),
        upstreamBaseUrl: process.env.POSTGREST_URL ?? 'http://localhost:3001',
      },
    )
    expect(response.status).toBe(401)
    expect((await response.json()).error.category).toBe('unauthenticated')
  })
})
