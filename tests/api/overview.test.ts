/**
 * SCI-007 API contract proof. Experiment overview records, blocks, links,
 * configuration and historical revisions travel through the same-origin
 * /api/db PostgREST proxy. The admin connection is used only for fixtures.
 */
import { config } from 'dotenv'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { handleProxyRequest } from '#/lib/postgrest-proxy'
import { mintPostgrestToken } from '#/lib/postgrest-token'
import { grantFixtureProjectAccess } from './project-fixtures'

config({ path: ['.env.local', '.env'] })

const WS_A = '6c000000-0000-4000-8000-00000000070a'
const WS_B = '6c000000-0000-4000-8000-00000000070b'
const PROJECT_A = '6c000000-0000-4000-8000-00000000071a'
const PROJECT_B = '6c000000-0000-4000-8000-00000000071b'
const USER_A = 'sci-007-api-owner-a'
const USER_B = 'sci-007-api-owner-b'
const SECRET = process.env.PGRST_JWT_SECRET ?? ''

let admin: Client

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
        session: { id: 'sci-007-api-session' },
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
) {
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
) {
  const response = await rpc('create_record', user, workspace, {
    p_project_id: project,
    p_kind: kind,
    p_title: title,
    p_status: 'draft',
    p_properties: {},
  })
  expect(response.status).toBe(200)
  return response.json()
}

async function insertBlock(
  user: string,
  workspace: string,
  record: { id: string; structure_version: number },
  type: string,
  payload: unknown,
) {
  return rpc('insert_block', user, workspace, {
    p_record_id: record.id,
    p_type: type,
    p_payload: payload,
    p_payload_schema_version: 1,
    p_expected_structure_version: record.structure_version,
  })
}

beforeAll(async () => {
  if (!SECRET) throw new Error('PGRST_JWT_SECRET is required for API tests.')
  admin = new Client({
    connectionString:
      process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL,
  })
  await admin.connect()
  await admin.query(
    `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES
      ($1,'SCI 007 API A','sci-007-api-a@test.invalid',true),
      ($2,'SCI 007 API B','sci-007-api-b@test.invalid',true)`,
    [USER_A, USER_B],
  )
  await admin.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES
      ($1,'sci-007-api-a','SCI 007 API A'),($2,'sci-007-api-b','SCI 007 API B')`,
    [WS_A, WS_B],
  )
  await admin.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES
      ($1,$3,'owner'),($2,$4,'owner')`,
    [WS_A, WS_B, USER_A, USER_B],
  )
  await admin.query(
    `INSERT INTO api.projects(id,workspace_id,key,title) VALUES
      ($1,$2,'sci007api','SCI 007 API A'),($3,$4,'sci007b','SCI 007 API B')`,
    [PROJECT_A, WS_A, PROJECT_B, WS_B],
  )
  for (const [projectId, workspaceId, userId] of [
    [PROJECT_A, WS_A, USER_A],
    [PROJECT_B, WS_B, USER_B],
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
    await admin.end()
  }
})

describe('SCI-007 experiment overview REST contract', () => {
  it('creates an experiment with blocks and reads them through the proxy', async () => {
    const experiment = await createRecord(
      USER_A,
      WS_A,
      PROJECT_A,
      'experiment',
      'Overview API',
    )
    const richTextResponse = await insertBlock(
      USER_A,
      WS_A,
      experiment,
      'rich_text',
      { content: { type: 'doc', content: [] } },
    )
    expect(richTextResponse.status).toBe(200)
    const richTextResult = await richTextResponse.json()
    experiment.structure_version = richTextResult.structure_version

    const chartResponse = await insertBlock(
      USER_A,
      WS_A,
      experiment,
      'chart',
      {},
    )
    expect(chartResponse.status).toBe(200)
    const chartResult = await chartResponse.json()

    const read = await proxy(
      `blocks?record_id=eq.${experiment.id}&order=order.asc`,
      USER_A,
      WS_A,
    )
    expect(read.status).toBe(200)
    const rows = await read.json()
    expect(rows).toHaveLength(2)
    expect(rows.map((row: any) => row.id)).toEqual([
      richTextResult.block.id,
      chartResult.block.id,
    ])
    expect(rows.map((row: any) => row.type)).toEqual(['rich_text', 'chart'])

    const records = await proxy(`records?id=eq.${experiment.id}`, USER_A, WS_A)
    expect(records.status).toBe(200)
    expect(await records.json()).toHaveLength(1)
    const links = await proxy(
      `record_links?source_record_id=eq.${experiment.id}`,
      USER_A,
      WS_A,
    )
    expect(links.status).toBe(200)
    expect(await links.json()).toEqual([])
  })

  it('PATCHes overview configuration and reads it back', async () => {
    const experiment = await createRecord(
      USER_A,
      WS_A,
      PROJECT_A,
      'experiment',
      'Configured overview',
    )
    const blockResponse = await insertBlock(
      USER_A,
      WS_A,
      experiment,
      'rich_text',
      {},
    )
    expect(blockResponse.status).toBe(200)
    const block = (await blockResponse.json()).block
    const properties = { overview: { excludedBlockIds: [block.id] } }

    const update = await proxy(
      `records?id=eq.${experiment.id}&select=id,properties`,
      USER_A,
      WS_A,
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          prefer: 'return=representation',
        },
        body: JSON.stringify({ properties }),
      },
    )
    expect(update.status).toBe(200)

    const read = await proxy(
      `records?id=eq.${experiment.id}&select=id,properties`,
      USER_A,
      WS_A,
    )
    expect(read.status).toBe(200)
    expect((await read.json())[0].properties).toEqual(properties)
  })

  it('creates a revision and reads it back through the proxy', async () => {
    const experiment = await createRecord(
      USER_A,
      WS_A,
      PROJECT_A,
      'experiment',
      'Revision overview',
    )
    const revisionId = '6c000000-0000-4000-8000-00000000072a'
    const blockSnapshot = [
      {
        id: 'b1',
        type: 'rich_text',
        payload: {},
        payload_schema_version: 1,
        order: 0,
        version: 1,
      },
    ]
    await admin.query(
      `INSERT INTO api.revisions (id, record_id, structure_version, metadata_version, metadata_snapshot, block_snapshot, reason, created_by_user_id, created_at, updated_at)
       VALUES ($1, $2, 1, 1, $3, $4, 'submit', $5, NOW(), NOW())`,
      [revisionId, experiment.id, {}, JSON.stringify(blockSnapshot), USER_A],
    )

    const read = await proxy(`revisions?id=eq.${revisionId}`, USER_A, WS_A)
    expect(read.status).toBe(200)
    const rows = await read.json()
    expect(rows).toHaveLength(1)
    expect(rows[0].block_snapshot).toEqual(blockSnapshot)
  })

  it('denies cross-workspace access to the experiment record', async () => {
    const experiment = await createRecord(
      USER_A,
      WS_A,
      PROJECT_A,
      'experiment',
      'Private overview',
    )
    const response = await proxy(`records?id=eq.${experiment.id}`, USER_B, WS_B)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([])
  })

  it('denies cross-workspace PATCH of overview configuration', async () => {
    const experiment = await createRecord(
      USER_A,
      WS_A,
      PROJECT_A,
      'experiment',
      'Protected overview',
    )
    const response = await proxy(
      `records?id=eq.${experiment.id}`,
      USER_B,
      WS_B,
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          prefer: 'return=representation',
        },
        body: JSON.stringify({
          properties: { overview: { excludedBlockIds: ['b1'] } },
        }),
      },
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([])
  })
})
