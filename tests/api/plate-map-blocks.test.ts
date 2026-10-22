/**
 * SCI-005 API contract proof. Plate-map CRUD, payload validation, sample
 * references, workspace isolation and durable-event parity travel through the
 * same-origin /api/db PostgREST proxy. The admin connection is used only for
 * fixture setup and change-event verification.
 */
import { config } from 'dotenv'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { handleProxyRequest } from '#/lib/postgrest-proxy'
import { mintPostgrestToken } from '#/lib/postgrest-token'
import { grantFixtureProjectAccess } from './project-fixtures'

config({ path: ['.env.local', '.env'] })

const WS_A = '6c000000-0000-4000-8000-00000000050a'
const WS_B = '6c000000-0000-4000-8000-00000000050b'
const PROJECT_A = '6c000000-0000-4000-8000-00000000051a'
const PROJECT_B = '6c000000-0000-4000-8000-00000000051b'
const USER_A = 'sci-005-api-owner-a'
const USER_B = 'sci-005-api-owner-b'
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
        session: { id: 'sci-005-api-session' },
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

function platePayload(sample: {
  id: string
  identifier: string
  title: string
}) {
  return {
    title: 'Test plate',
    spec: {
      specVersion: 1,
      format: '96_well',
      rows: 8,
      cols: 12,
      wells: [
        {
          wellCode: 'A1',
          row: 0,
          col: 0,
          role: 'sample',
          sampleRef: {
            recordId: sample.id,
            identifier: sample.identifier,
            title: sample.title,
          },
          replicate: 1,
          volume: { value: 20, unit: 'µL' },
        },
        { wellCode: 'A2', row: 0, col: 1, role: 'positive_control' },
      ],
      validation: {},
    },
    provenance: 'Test lab',
  }
}

beforeAll(async () => {
  if (!SECRET) throw new Error('PGRST_JWT_SECRET is required for API tests.')
  admin = new Client({ connectionString: process.env.DATABASE_URL })
  await admin.connect()
  await admin.query(
    `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES
      ($1,'SCI 005 API A','sci-005-api-a@test.invalid',true),
      ($2,'SCI 005 API B','sci-005-api-b@test.invalid',true)`,
    [USER_A, USER_B],
  )
  await admin.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES
      ($1,'sci-005-api-a','SCI 005 API A'),($2,'sci-005-api-b','SCI 005 API B')`,
    [WS_A, WS_B],
  )
  await admin.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES
      ($1,$3,'owner'),($2,$4,'owner')`,
    [WS_A, WS_B, USER_A, USER_B],
  )
  await admin.query(
    `INSERT INTO api.projects(id,workspace_id,key,title) VALUES
      ($1,$2,'sci005api','SCI 005 API A'),($3,$4,'sci005b','SCI 005 API B')`,
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

describe('SCI-005 plate-map blocks REST contract', () => {
  let experiment: { id: string; structure_version: number }
  let sample: { id: string; identifier: string; title: string }
  let block: { id: string; version: number; payload: any }

  it('creates and reads an authenticated plate_map block through the proxy', async () => {
    experiment = await createRecord(
      USER_A,
      WS_A,
      PROJECT_A,
      'experiment',
      'Plate map API',
    )
    sample = await createRecord(
      USER_A,
      WS_A,
      PROJECT_A,
      'sample',
      'Test sample',
    )
    const response = await insertBlock(
      USER_A,
      WS_A,
      experiment,
      'plate_map',
      platePayload(sample),
    )
    expect(response.status).toBe(200)
    block = (await response.json()).block

    const read = await proxy(
      `blocks?id=eq.${block.id}&select=id,type,payload`,
      USER_A,
      WS_A,
    )
    expect(read.status).toBe(200)
    const rows = await read.json()
    expect(rows).toHaveLength(1)
    expect(rows[0].type).toBe('plate_map')
    expect(rows[0].payload).toEqual(platePayload(sample))
  })

  it('updates the payload title through update_block_payload', async () => {
    const payload = { ...platePayload(sample), title: 'Renamed plate' }
    const response = await rpc('update_block_payload', USER_A, WS_A, {
      p_block_id: block.id,
      p_payload: payload,
      p_expected_version: block.version,
      p_payload_schema_version: 1,
    })
    expect(response.status).toBe(200)
    block = await response.json()
    expect(block.payload.title).toBe('Renamed plate')
  })

  it('filters blocks by plate_map type and record', async () => {
    const response = await proxy(
      `blocks?type=eq.plate_map&record_id=eq.${experiment.id}`,
      USER_A,
      WS_A,
    )
    expect(response.status).toBe(200)
    const rows = await response.json()
    expect(rows).toHaveLength(1)
    expect(rows.every((row: any) => row.type === 'plate_map')).toBe(true)
  })

  it('rejects invalid plate dimensions', async () => {
    const payload = platePayload(sample)
    payload.spec.rows = 4
    const response = await rpc('update_block_payload', USER_A, WS_A, {
      p_block_id: block.id,
      p_payload: payload,
      p_expected_version: block.version,
      p_payload_schema_version: 1,
    })
    expect(response.status).toBeGreaterThanOrEqual(400)
  })

  it('rejects an invalid well code', async () => {
    const payload = platePayload(sample)
    payload.spec.wells[0].wellCode = 'Z99'
    const response = await rpc('update_block_payload', USER_A, WS_A, {
      p_block_id: block.id,
      p_payload: payload,
      p_expected_version: block.version,
      p_payload_schema_version: 1,
    })
    expect(response.status).toBeGreaterThanOrEqual(400)
  })

  it('rejects duplicate well assignments', async () => {
    const payload = platePayload(sample)
    payload.spec.wells[1] = {
      wellCode: 'A1',
      row: 0,
      col: 0,
      role: 'positive_control',
    }
    const response = await rpc('update_block_payload', USER_A, WS_A, {
      p_block_id: block.id,
      p_payload: payload,
      p_expected_version: block.version,
      p_payload_schema_version: 1,
    })
    expect(response.status).toBeGreaterThanOrEqual(400)
  })

  it('rejects a cross-workspace reader at the blocks boundary', async () => {
    const response = await proxy(`blocks?id=eq.${block.id}`, USER_B, WS_B)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([])
  })

  it('accepts and reads a plate map referencing an archived sample', async () => {
    const archived = await createRecord(
      USER_A,
      WS_A,
      PROJECT_A,
      'sample',
      'Archived sample',
    )
    const archive = await proxy(`records?id=eq.${archived.id}`, USER_A, WS_A, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        prefer: 'return=representation',
      },
      body: JSON.stringify({ archived_at: new Date().toISOString() }),
    })
    expect(archive.status).toBe(200)
    const record = await createRecord(
      USER_A,
      WS_A,
      PROJECT_A,
      'experiment',
      'Archived plate',
    )
    const response = await insertBlock(
      USER_A,
      WS_A,
      record,
      'plate_map',
      platePayload(archived),
    )
    expect(response.status).toBe(200)
    const archivedBlock = (await response.json()).block
    const read = await proxy(`blocks?id=eq.${archivedBlock.id}`, USER_A, WS_A)
    expect(read.status).toBe(200)
    expect(
      (await read.json())[0].payload.spec.wells[0].sampleRef.recordId,
    ).toBe(archived.id)
  })

  it('emits a durable block.update event with actor attribution', async () => {
    const { rows } = await admin.query(
      `SELECT operation,actor_user_id FROM api.change_events
       WHERE record_id=$1 AND entity_type='block' ORDER BY sequence DESC LIMIT 20`,
      [experiment.id],
    )
    expect(
      rows.some(
        (event: any) =>
          event.operation === 'update' && event.actor_user_id === USER_A,
      ),
    ).toBe(true)
  })

  it('rejects an unauthenticated REST request at the proxy boundary', async () => {
    const response = await handleProxyRequest(
      new Request('http://sheetbase.test/api/db/blocks'),
      'blocks',
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
