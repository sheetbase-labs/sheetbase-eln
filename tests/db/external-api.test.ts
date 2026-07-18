/**
 * API-005 follow-up integration proof: a scoped external credential can read
 * and write projects through the api_client role + RLS, while a wrong-scope,
 * revoked, or cross-workspace token cannot. Runs against a freshly migrated
 * sheetbase_test database.
 *
 * The test mints real api_client JWTs (signed with PGRST_JWT_SECRET) and sets
 * request.jwt.claims + SET ROLE api_client against an authenticator client,
 * which is exactly what PostgREST does per request. resolveExternalToken is
 * exercised against the real credential row so revocation-at-use and scope
 * enforcement are tested against the database, not stubbed.
 */
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import * as schema from '#/db/schema'
import {
  createCredential,
  mintApiClientToken,
  revokeCredential,
} from '#/lib/api-credentials'
import {
  ExternalTokenError,
  resolveExternalToken,
} from '#/lib/external-token'
import type { ProxyPath } from '#/lib/postgrest-path'
import { migratorUrl, prepareTestDatabase } from './helpers'

const SECRET = process.env.PGRST_JWT_SECRET ?? 'test-jwt-secret-at-least-32-chars!!'

let migrator: Client
let db: ReturnType<typeof drizzle<typeof schema>>
const clients: Array<Client> = []

const WS_A = '00000000-0000-4000-8000-00000000070a'
const WS_B = '00000000-0000-4000-8000-00000000070b'
const OWNER_A = 'ext-owner-a'
const OWNER_B = 'ext-owner-b'
const PROJ_A = '00000000-0000-4000-8000-00000000080a'

const readPath: ProxyPath = { kind: 'table', resource: 'projects' }
const rpcPath: ProxyPath = { kind: 'rpc', resource: 'create_project' }

beforeAll(async () => {
  ;({ migrator } = await prepareTestDatabase())
  db = drizzle(migratorUrl(), { schema })

  await db.insert(schema.user).values([
    {
      id: OWNER_A,
      name: 'Owner A',
      email: 'ext-a@sheetbase.test',
      emailVerified: true,
    },
    {
      id: OWNER_B,
      name: 'Owner B',
      email: 'ext-b@sheetbase.test',
      emailVerified: true,
    },
  ])
  await db.insert(schema.workspaces).values([
    { id: WS_A, slug: 'ext-ws-a', name: 'Ext WS A' },
    { id: WS_B, slug: 'ext-ws-b', name: 'Ext WS B' },
  ])
  await db.insert(schema.workspaceMemberships).values([
    { workspaceId: WS_A, userId: OWNER_A, role: 'owner' },
    { workspaceId: WS_B, userId: OWNER_B, role: 'owner' },
  ])
  await db.insert(schema.projects).values({
    id: PROJ_A,
    workspaceId: WS_A,
    key: 'ext-proj-a',
    title: 'External Project A',
  })
})

afterAll(async () => {
  for (const c of clients) await c.end()
  await db.$client.end()
  await migrator.end()
})

/**
 * Simulates what PostgREST does: connects as authenticator, switches to
 * api_client, and installs the jwt claims as a GUC. Returns a client that
 * sees exactly what an external request with this token would see.
 */
async function asApiClient(claims: Record<string, unknown>): Promise<Client> {
  // Reuse the authenticator connection helper from the db test layer.
  const { Client } = await import('pg')
  const url = new URL(process.env.PGRST_DB_URI ?? '')
  url.hostname = 'localhost'
  url.port = process.env.POSTGRES_PORT ?? '5432'
  url.pathname = '/sheetbase_test'
  const client = new Client({ connectionString: url.toString() })
  await client.connect()
  clients.push(client)
  await client.query('SET ROLE api_client')
  await client.query("SELECT set_config('request.jwt.claims', $1, false)", [
    JSON.stringify(claims),
  ])
  return client
}

async function projectTitles(client: Client): Promise<string[]> {
  const { rows } = await client.query<{ title: string }>(
    'SELECT title FROM api.projects ORDER BY title',
  )
  return rows.map((r) => r.title)
}

describe('api_client RLS isolation', () => {
  it('reads only the workspace the token is scoped to', async () => {
    const token = await mintApiClientToken(SECRET, {
      workspaceId: WS_A,
      credentialId: 'cred-unused-here',
      scopes: ['projects:read'],
    })
    const client = await asApiClient({
      workspace_id: WS_A,
      credential_id: 'cred-unused-here',
      scopes: ['projects:read'],
      role: 'api_client',
    })
    expect(await projectTitles(client)).toEqual(['External Project A'])
  })

  it('cannot see another workspace', async () => {
    const client = await asApiClient({
      workspace_id: WS_B,
      credential_id: 'cred-unused-here',
      scopes: ['projects:read'],
      role: 'api_client',
    })
    expect(await projectTitles(client)).toEqual([])
  })

  it('cannot insert into another workspace', async () => {
    const client = await asApiClient({
      workspace_id: WS_A,
      credential_id: 'cred-unused-here',
      scopes: ['projects:write'],
      role: 'api_client',
    })
    // Attempt to insert a row claiming WS_B while the active workspace claim
    // is WS_A — RLS WITH CHECK must reject it.
    await expect(
      client.query(
        `INSERT INTO api.projects (workspace_id, key, title) VALUES ('${WS_B}', 'sneaky', 'Sneaky')`,
      ),
    ).rejects.toMatchObject({ code: '42501' })
  })
})

describe('resolveExternalToken (revocation + scope at use time)', () => {
  it('allows a projects:read GET on a table', async () => {
    const cred = await createCredential(db, {
      workspaceId: WS_A,
      createdByUserId: OWNER_A,
      name: 'reader',
      scopes: ['projects:read'],
    })
    const token = await mintApiClientToken(SECRET, {
      workspaceId: WS_A,
      credentialId: cred.id,
      scopes: ['projects:read'],
    })
    const result = await resolveExternalToken(db, token, SECRET, 'GET', readPath)
    expect(result.workspaceId).toBe(WS_A)
  })

  it('rejects a projects:write POST when the credential only has projects:read', async () => {
    const cred = await createCredential(db, {
      workspaceId: WS_A,
      createdByUserId: OWNER_A,
      name: 'read-only',
      scopes: ['projects:read'],
    })
    const token = await mintApiClientToken(SECRET, {
      workspaceId: WS_A,
      credentialId: cred.id,
      scopes: ['projects:read'],
    })
    await expect(
      resolveExternalToken(db, token, SECRET, 'POST', readPath),
    ).rejects.toMatchObject({ code: 'insufficient_scope' })
  })

  it('rejects a create_project RPC without projects:write', async () => {
    const cred = await createCredential(db, {
      workspaceId: WS_A,
      createdByUserId: OWNER_A,
      name: 'rpc-reader',
      scopes: ['projects:read'],
    })
    const token = await mintApiClientToken(SECRET, {
      workspaceId: WS_A,
      credentialId: cred.id,
      scopes: ['projects:read'],
    })
    await expect(
      resolveExternalToken(db, token, SECRET, 'POST', rpcPath),
    ).rejects.toMatchObject({ code: 'insufficient_scope' })
  })

  it('rejects a revoked credential even with a still-valid token', async () => {
    const cred = await createCredential(db, {
      workspaceId: WS_A,
      createdByUserId: OWNER_A,
      name: 'to-revoke',
      scopes: ['projects:read', 'projects:write'],
    })
    const token = await mintApiClientToken(SECRET, {
      workspaceId: WS_A,
      credentialId: cred.id,
      scopes: ['projects:read'],
    })
    await revokeCredential(db, {
      workspaceId: WS_A,
      credentialId: cred.id,
    })
    await expect(
      resolveExternalToken(db, token, SECRET, 'GET', readPath),
    ).rejects.toMatchObject({ code: 'revoked' })
  })

  it('rejects a token whose workspace_id does not match the credential row', async () => {
    const cred = await createCredential(db, {
      workspaceId: WS_A,
      createdByUserId: OWNER_A,
      name: 'mismatched',
      scopes: ['projects:read'],
    })
    const token = await mintApiClientToken(SECRET, {
      workspaceId: WS_B, // tampered / misconfigured
      credentialId: cred.id,
      scopes: ['projects:read'],
    })
    await expect(
      resolveExternalToken(db, token, SECRET, 'GET', readPath),
    ).rejects.toMatchObject({ code: 'invalid_token' })
  })

  it('rejects a garbage token', async () => {
    await expect(
      resolveExternalToken(db, 'not-a-jwt', SECRET, 'GET', readPath),
    ).rejects.toBeInstanceOf(ExternalTokenError)
  })
})
