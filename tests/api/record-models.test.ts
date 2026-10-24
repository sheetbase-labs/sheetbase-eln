/**
 * MDL-01 step 3 — workspace-defined model definition through the /api/db
 * boundary (ADR-0051).
 *
 * Proves the additive public-API exposure:
 *  - `api.record_models` is on the fail-closed external allowlist for GET/HEAD
 *    under `projects:read`, and is read-only (no POST/PATCH/DELETE).
 *  - A personal API token reads only its own workspace's models.
 *  - Records of a workspace model are already exposed generically through
 *    `api.records` and inherit the same workspace scoping.
 *  - Model-authoring RPCs (`create_workspace_model`,
 *    `next_record_model_identifier`) stay off the credential surface.
 *
 * The suite talks to the running pinned PostgREST and local migrated database,
 * so it exercises the real boundary rather than a stub.
 */
import { config } from 'dotenv'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import * as schema from '#/db/schema'
import { createCredential, mintPersonalApiToken } from '#/lib/api-credentials'
import {
  EXTERNAL_RPC_SCOPES,
  EXTERNAL_TABLE_ACCESS,
  requiredScopes,
  resolveExternalToken,
} from '#/lib/external-token'
import { handleProxyRequest } from '#/lib/postgrest-proxy'

config({ path: ['.env.local', '.env'] })

const WS_A = '7e000000-0000-4000-8000-000000000001'
const WS_B = '7e000000-0000-4000-8000-000000000002'
const OWNER_A = 'mdl-01-api-owner-a'
const OWNER_B = 'mdl-01-api-owner-b'
const MODEL_A = '7e000000-0000-4000-8000-00000000000a'
const RECORD_A = '7e000000-0000-4000-8000-00000000000b'
const SECRET = process.env.PGRST_JWT_SECRET ?? ''

let admin: Client
let database: ReturnType<typeof drizzle<typeof schema>>
let tokenA: string
let tokenB: string

function proxy(request: Request, path: string) {
  return handleProxyRequest(request, path, {
    getSession: async () => null,
    getWorkspaceForUser: async () => null,
    mintToken: async () => '',
    resolveExternalToken: (token, method, parsedPath) =>
      resolveExternalToken(database, token, SECRET, method, parsedPath),
    upstreamBaseUrl: process.env.POSTGREST_URL ?? 'http://localhost:3001',
  })
}

function request(path: string, token: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers)
  headers.set('authorization', `Bearer ${token}`)
  return new Request(`http://sheetbase.test/api/db/${path}`, {
    ...init,
    headers,
  })
}

beforeAll(async () => {
  if (!SECRET) throw new Error('PGRST_JWT_SECRET is required for API tests.')
  admin = new Client({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  })
  await admin.connect()
  database = drizzle(process.env.DATABASE_URL ?? '', { schema })

  await admin.query(
    `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES
       ($1,'MDL-01 API A','mdl-01-api-a@test.invalid',true),
       ($2,'MDL-01 API B','mdl-01-api-b@test.invalid',true)`,
    [OWNER_A, OWNER_B],
  )
  await admin.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES
       ($1,'mdl-01-api-a','MDL-01 API A'),
       ($2,'mdl-01-api-b','MDL-01 API B')`,
    [WS_A, WS_B],
  )
  await admin.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES
       ($1,$3,'owner'),($2,$4,'owner')`,
    [WS_A, WS_B, OWNER_A, OWNER_B],
  )
  // Workspace A defines a model; workspace B does not.
  await admin.query(
    `INSERT INTO api.record_models
       (id,workspace_id,key,name,description,identifier_prefix,lifecycle,current_version,created_by_user_id,updated_by_user_id)
     VALUES ($1,$2,'cell_bank','Cell bank','Banked cell lines','CB','published',1,$3,$3)`,
    [MODEL_A, WS_A, OWNER_A],
  )
  // Privileged fixture setup supplies the published definition required by
  // records. Publication approval itself is covered by the model DB suites.
  await admin.query(
    `INSERT INTO api.record_model_versions
       (model_id,workspace_id,version,lifecycle,definition,published_at,created_by_user_id)
     VALUES ($1,$2,1,'published','{"fields":[]}',now(),$3)`,
    [MODEL_A, WS_A, OWNER_A],
  )
  // A record of the workspace model — still an ordinary api.records row.
  await admin.query(
    `INSERT INTO api.records(id,workspace_id,kind,identifier,title,created_by_user_id)
     VALUES ($1,$2,'cell_bank','CB-0001','Banked line A', $3)`,
    [RECORD_A, WS_A, OWNER_A],
  )

  const credA = await createCredential(database, {
    workspaceId: WS_A,
    createdByUserId: OWNER_A,
    name: 'mdl-01 reader a',
    scopes: ['projects:read'],
    kind: 'personal',
  })
  const credB = await createCredential(database, {
    workspaceId: WS_B,
    createdByUserId: OWNER_B,
    name: 'mdl-01 reader b',
    scopes: ['projects:read'],
    kind: 'personal',
  })
  tokenA = await mintPersonalApiToken(SECRET, {
    workspaceId: WS_A,
    credentialId: credA.id,
    userId: OWNER_A,
    scopes: ['projects:read'],
  })
  tokenB = await mintPersonalApiToken(SECRET, {
    workspaceId: WS_B,
    credentialId: credB.id,
    userId: OWNER_B,
    scopes: ['projects:read'],
  })

  await admin.query(`SELECT pg_notify('pgrst','reload schema')`)
})

afterAll(async () => {
  if (admin) {
    await admin.end()
    await database.$client.end()
  }
})

describe('MDL-01 record_models public API exposure', () => {
  it('allowlists a read-only record_models and keeps model authoring denied', () => {
    expect(
      requiredScopes('GET', { kind: 'table', resource: 'record_models' }),
    ).toEqual(['projects:read'])
    expect(
      requiredScopes('HEAD', { kind: 'table', resource: 'record_models' }),
    ).toEqual(['projects:read'])
    expect(EXTERNAL_TABLE_ACCESS.record_models.write).toBeUndefined()
    expect(() =>
      requiredScopes('PATCH', { kind: 'table', resource: 'record_models' }),
    ).toThrow()

    expect(EXTERNAL_RPC_SCOPES).not.toHaveProperty('create_workspace_model')
    expect(EXTERNAL_RPC_SCOPES).not.toHaveProperty(
      'next_record_model_identifier',
    )
  })

  it('reads the workspace model definition via a scoped personal token', async () => {
    const res = await proxy(
      request('record_models?order=key.asc', tokenA),
      'record_models',
    )
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject([
      {
        id: MODEL_A,
        workspace_id: WS_A,
        key: 'cell_bank',
        name: 'Cell bank',
        description: 'Banked cell lines',
        identifier_prefix: 'CB',
        lifecycle: 'published',
        current_version: 1,
      },
    ])
  })

  it('hides another workspace model definition from the token', async () => {
    const res = await proxy(
      request(`record_models?workspace_id=eq.${WS_A}`, tokenB),
      'record_models',
    )
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual([])
  })

  it('exposes model records generically through api.records, scoped', async () => {
    const own = await proxy(
      request(
        'records?kind=eq.cell_bank&select=id,kind,identifier,title',
        tokenA,
      ),
      'records',
    )
    expect(own.status).toBe(200)
    await expect(own.json()).resolves.toMatchObject([
      {
        id: RECORD_A,
        kind: 'cell_bank',
        identifier: 'CB-0001',
        title: 'Banked line A',
      },
    ])

    const other = await proxy(
      request(
        'records?kind=eq.cell_bank&select=id,kind,identifier,title',
        tokenB,
      ),
      'records',
    )
    expect(other.status).toBe(200)
    await expect(other.json()).resolves.toEqual([])
  })

  it('rejects the model-authoring RPC on the credential surface', async () => {
    const res = await proxy(
      request('rpc/create_workspace_model', tokenA, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          p_workspace_id: WS_A,
          p_key: 'cell_line',
          p_name: 'Cell line',
          p_identifier_prefix: 'CL',
        }),
      }),
      'rpc/create_workspace_model',
    )
    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toMatchObject({
      error: { category: 'permission_denied' },
    })
  })

  it('rejects a write to the read-only record_models table', async () => {
    const res = await proxy(
      request('record_models', tokenA, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Renamed' }),
      }),
      'record_models',
    )
    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toMatchObject({
      error: { category: 'permission_denied' },
    })
  })
})
