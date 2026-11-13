/**
 * Approving through the /api/db boundary with a personal token: a token holding
 * `reviews:write` approves as its owner, one without it is refused at the
 * boundary, a service credential cannot, and a regulated lab keeps it in the app.
 */
import { config } from 'dotenv'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import * as schema from '#/db/schema'
import {
  createCredential,
  mintApiClientToken,
  mintPersonalApiToken,
} from '#/lib/api-credentials'
import { resolveExternalToken } from '#/lib/external-token'
import { handleProxyRequest } from '#/lib/postgrest-proxy'

config({ path: ['.env.local', '.env'] })

const WS = '7f000000-0000-4000-8000-0000000000a1'
const SUBMITTER = 'token-approvals-submitter'
const APPROVER = 'token-approvals-approver'
const SECRET = process.env.PGRST_JWT_SECRET ?? ''

let admin: Client
let database: ReturnType<typeof drizzle<typeof schema>>
let approverToken: string
let noScopeToken: string
let serviceToken: string

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

function decide(token: string, name: string, args: Record<string, unknown>) {
  return proxy(
    new Request(`http://sheetbase.test/api/db/rpc/${name}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(args),
    }),
    `rpc/${name}`,
  )
}

/** A waiting request, made as the submitter. */
async function waitingRequest(key: string): Promise<string> {
  await admin.query('BEGIN')
  try {
    await admin.query('SET LOCAL ROLE authenticated')
    await admin.query(`SELECT set_config('request.jwt.claims',$1,true)`, [
      JSON.stringify({
        role: 'authenticated',
        sub: SUBMITTER,
        workspace_id: WS,
      }),
    ])
    const made = await admin.query<{ result: { schema_version_id: string } }>(
      `SELECT api.create_dataset_schema_definition($1,$2,'Token approvals',null,'[]'::jsonb) result`,
      [WS, key],
    )
    const request = await admin.query<{ id: string }>(
      `SELECT id FROM api.submit_approval_request($1,'dataset_schema_version',$2,ARRAY['reviewer']::text[],'Please approve')`,
      [WS, made.rows[0]!.result.schema_version_id],
    )
    await admin.query('COMMIT')

    return request.rows[0]!.id
  } catch (error) {
    await admin.query('ROLLBACK')
    throw error
  }
}

beforeAll(async () => {
  if (!SECRET) throw new Error('PGRST_JWT_SECRET is required for API tests.')
  admin = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL })
  await admin.connect()
  database = drizzle(process.env.DATABASE_URL ?? '', { schema })
  await admin.query(
    `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES
       ($1,'Submitter','token-approvals-submitter@test.invalid',true),
       ($2,'Approver','token-approvals-approver@test.invalid',true)`,
    [SUBMITTER, APPROVER],
  )
  await admin.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES ($1,'token-approvals','Token approvals')`,
    [WS],
  )
  await admin.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES
       ($1,$2,'steward'),($1,$3,'reviewer')`,
    [WS, SUBMITTER, APPROVER],
  )
  const withScope = await createCredential(database, {
    workspaceId: WS,
    createdByUserId: APPROVER,
    name: 'approver',
    scopes: ['reviews:write'],
    kind: 'personal',
  })
  approverToken = await mintPersonalApiToken(SECRET, {
    workspaceId: WS,
    credentialId: withScope.id,
    userId: APPROVER,
    scopes: ['reviews:write'],
  })
  const withoutScope = await createCredential(database, {
    workspaceId: WS,
    createdByUserId: APPROVER,
    name: 'reader',
    scopes: ['lab:read'],
    kind: 'personal',
  })
  noScopeToken = await mintPersonalApiToken(SECRET, {
    workspaceId: WS,
    credentialId: withoutScope.id,
    userId: APPROVER,
    scopes: ['lab:read'],
  })
  const service = await createCredential(database, {
    workspaceId: WS,
    createdByUserId: APPROVER,
    name: 'service',
    scopes: ['lab:read', 'lab:write'],
    kind: 'service',
  })
  serviceToken = await mintApiClientToken(SECRET, {
    workspaceId: WS,
    credentialId: service.id,
    scopes: ['lab:read', 'lab:write'],
  })
  await admin.query(`SELECT pg_notify('pgrst','reload schema')`)
})

afterAll(async () => {
  if (admin) {
    await admin.end()
    await database.$client.end()
  }
})

describe('approving with a token', () => {
  it('approves as the owner of a token holding reviews:write', async () => {
    const id = await waitingRequest('api_tok_approve')
    const res = await decide(approverToken, 'approve_approval_request', {
      p_request_id: id,
      p_reason: 'checked',
    })
    expect(res.status, await res.clone().text()).toBe(200)
    expect(await res.json()).toMatchObject({ id, state: 'approved' })
  })

  it('returns a request with a reason', async () => {
    const id = await waitingRequest('api_tok_return')
    const res = await decide(approverToken, 'return_approval_request', {
      p_request_id: id,
      p_reason: 'needs a unit',
    })
    expect(res.status, await res.clone().text()).toBe(200)
    expect(await res.json()).toMatchObject({ id, state: 'returned' })
  })

  it('refuses a token without the scope, and a service credential', async () => {
    const id = await waitingRequest('api_tok_refused')
    const args = { p_request_id: id }
    expect(
      (await decide(noScopeToken, 'approve_approval_request', args)).status,
    ).toBe(403)
    expect(
      (await decide(serviceToken, 'approve_approval_request', args)).status,
    ).toBe(403)
  })

  it('keeps signing closed even with reviews:write', async () => {
    const res = await decide(approverToken, 'sign_revision', {
      p_submission_id: '00000000-0000-4000-8000-000000000000',
      p_signature_meaning: 'reviewed-and-approved',
      p_confirmation_phrase: 'Approver',
      p_expected_revision_digest: 'x',
    })
    expect(res.status).toBe(403)
  })

  it('stays in the app when the lab is regulated', async () => {
    const id = await waitingRequest('api_tok_regulated')
    await admin.query(
      `INSERT INTO api.workspace_settings(workspace_id,created_by_user_id,regulated_lab)
       VALUES ($1,$2,true) ON CONFLICT(workspace_id) DO UPDATE SET regulated_lab=true`,
      [WS, SUBMITTER],
    )
    try {
      const res = await decide(approverToken, 'approve_approval_request', {
        p_request_id: id,
      })
      expect(res.status).toBe(403)
    } finally {
      await admin.query(
        'UPDATE api.workspace_settings SET regulated_lab=false WHERE workspace_id=$1',
        [WS],
      )
    }
  })
})
