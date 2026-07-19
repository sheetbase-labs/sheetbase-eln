/**
 * API-005 contract proof: credential creation, exchange, revocation,
 * wrong-secret, wrong-scope and rate-limiting behaviour. Runs against a
 * freshly migrated sheetbase_test database. Token minting is stubbed so the
 * test asserts the exchange logic, not JWT signing (covered by AUTH-003).
 */
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import * as schema from '#/db/schema'
import {
  createCredential,
  exchangeCredential,
  hashSecret,
  parseCredentialString,
  revokeCredential,
  CredentialError,
  type ExchangeDeps,
} from '#/lib/api-credentials'
import { migratorUrl, prepareTestDatabase } from './helpers'

const SECRET = 'test-jwt-secret-at-least-32-chars!!'

let migrator: Client
let db: ReturnType<typeof drizzle<typeof schema>>

const WS = '00000000-0000-4000-8000-00000000050a'
const OWNER = 'cred-owner'

const mintDeps: ExchangeDeps = {
  mintToken: async (input) => `minted:${input.workspaceId}:${input.scopes.join(',')}`,
}

beforeAll(async () => {
  ;({ migrator } = await prepareTestDatabase())
  db = drizzle(migratorUrl(), { schema })

  await db.insert(schema.user).values({
    id: OWNER,
    name: 'Cred Owner',
    email: 'cred-owner@sheetbase.test',
    emailVerified: true,
  })
  await db.insert(schema.workspaces).values({
    id: WS,
    slug: 'cred-ws',
    name: 'Cred WS',
  })
  await db.insert(schema.workspaceMemberships).values({
    workspaceId: WS,
    userId: OWNER,
    role: 'owner',
  })
})

afterAll(async () => {
  await db.$client.end()
  await migrator.end()
})

describe('createCredential', () => {
  it('creates a credential and returns the full secret once', async () => {
    const created = await createCredential(db, {
      workspaceId: WS,
      createdByUserId: OWNER,
      name: 'CI token',
      scopes: ['projects:read'],
    })

    expect(created.secret).toMatch(/^sb_[0-9a-f]{8}_[0-9a-f]{32}$/)
    expect(created.scopes).toEqual(['projects:read'])
    expect(created.displayPrefix).toHaveLength(8)

    // The stored hash is not the secret.
    const row = await db.query.apiCredentials.findFirst({
      where: (table, { eq }) => eq(table.id, created.id),
    })
    expect(row?.secretHash).not.toContain(created.secret)
    expect(row?.secretHash).toBe(
      hashSecret(created.displayPrefix, parseCredentialString(created.secret)!.secret),
    )
  })

  it('rejects an unknown scope', async () => {
    await expect(
      createCredential(db, {
        workspaceId: WS,
        createdByUserId: OWNER,
        name: 'bad',
        scopes: ['projects:read', 'unknown:scope' as never],
      }),
    ).rejects.toMatchObject({ code: 'invalid_scope' })
  })

  it('accepts the independent scientific scope vocabulary', async () => {
    const created = await createCredential(db, {
      workspaceId: WS,
      createdByUserId: OWNER,
      name: 'scientific integration',
      scopes: ['scientific:read', 'scientific:write', 'scientific:schema'],
    })
    expect(created.scopes).toEqual([
      'scientific:read',
      'scientific:write',
      'scientific:schema',
    ])
  })
})

describe('exchangeCredential', () => {
  let credSecret: string

  beforeAll(async () => {
    const created = await createCredential(db, {
      workspaceId: WS,
      createdByUserId: OWNER,
      name: 'exchange token',
      scopes: ['projects:read', 'projects:write'],
    })
    credSecret = created.secret
  })

  it('exchanges a valid credential with sufficient scope for a token', async () => {
    const token = await exchangeCredential(
      db,
      credSecret,
      ['projects:read'],
      mintDeps,
    )
    expect(token).toContain(WS)
    expect(token).toContain('projects:read')
  })

  it('stamps last_used_at on a successful exchange', async () => {
    await exchangeCredential(db, credSecret, ['projects:read'], mintDeps)
    const row = await db.query.apiCredentials.findFirst({
      where: (table, { eq }) =>
        eq(
          table.displayPrefix,
          parseCredentialString(credSecret)!.prefix,
        ),
    })
    expect(row?.lastUsedAt).not.toBeNull()
  })

  it('rejects a wrong secret with invalid_credential', async () => {
    await expect(
      exchangeCredential(
        db,
        'sb_00000000_ffffffffffffffffffffffffffffffff',
        ['projects:read'],
        mintDeps,
      ),
    ).rejects.toMatchObject({ code: 'invalid_credential' })
  })

  it('rejects a malformed credential string', async () => {
    await expect(
      exchangeCredential(db, 'not-a-credential', ['projects:read'], mintDeps),
    ).rejects.toMatchObject({ code: 'invalid_credential' })
  })

  it('rejects a scope the credential does not have', async () => {
    // Create a read-only credential and request write.
    const readOnly = await createCredential(db, {
      workspaceId: WS,
      createdByUserId: OWNER,
      name: 'read only',
      scopes: ['projects:read'],
    })
    await expect(
      exchangeCredential(db, readOnly.secret, ['projects:write'], mintDeps),
    ).rejects.toMatchObject({ code: 'insufficient_scope' })
  })
})

describe('revokeCredential', () => {
  it('makes a revoked credential fail immediately', async () => {
    const created = await createCredential(db, {
      workspaceId: WS,
      createdByUserId: OWNER,
      name: 'to revoke',
      scopes: ['projects:read'],
    })

    await revokeCredential(db, {
      workspaceId: WS,
      credentialId: created.id,
    })

    await expect(
      exchangeCredential(db, created.secret, ['projects:read'], mintDeps),
    ).rejects.toMatchObject({ code: 'revoked' })
  })

  it('does not revoke a credential from another workspace', async () => {
    // A second workspace + owner.
    await db.insert(schema.workspaces).values({
      id: '00000000-0000-4000-8000-00000000050b',
      slug: 'cred-ws-2',
      name: 'Cred WS 2',
    })
    await db.insert(schema.workspaceMemberships).values({
      workspaceId: '00000000-0000-4000-8000-00000000050b',
      userId: OWNER,
      role: 'owner',
    })
    const created = await createCredential(db, {
      workspaceId: WS,
      createdByUserId: OWNER,
      name: 'cross-ws',
      scopes: ['projects:read'],
    })

    // Attempt revoke from the wrong workspace: the update matches 0 rows.
    await revokeCredential(db, {
      workspaceId: '00000000-0000-4000-8000-00000000050b',
      credentialId: created.id,
    })

    // The credential still works.
    const token = await exchangeCredential(
      db,
      created.secret,
      ['projects:read'],
      mintDeps,
    )
    expect(token).toContain(WS)
  })
})

describe('rate limiting', () => {
  it('locks the prefix after 5 failed attempts', async () => {
    // Use a prefix that won't exist so every attempt is a failure.
    const bad = 'sb_deadbeef_ffffffffffffffffffffffffffffffff'
    for (let i = 0; i < 5; i++) {
      await expect(
        exchangeCredential(db, bad, ['projects:read'], mintDeps),
      ).rejects.toMatchObject({ code: 'invalid_credential' })
    }
    // 6th attempt is rate-limited, not invalid_credential.
    await expect(
      exchangeCredential(db, bad, ['projects:read'], mintDeps),
    ).rejects.toMatchObject({ code: 'rate_limited' })
  })
})
