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
  isWorkspaceMember,
  isWorkspaceOwner,
  listCredentials,
  parseCredentialString,
  revokeCredential,
  rotateCredential,
  type ExchangeDeps,
} from '#/lib/api-credentials'
import { migratorUrl, prepareTestDatabase } from './helpers'

const SECRET = 'test-jwt-secret-at-least-32-chars!!'

let migrator: Client
let db: ReturnType<typeof drizzle<typeof schema>>

const WS = '00000000-0000-4000-8000-00000000050a'
const OWNER = 'cred-owner'
const MEMBER = 'cred-member'

const mintDeps: ExchangeDeps = {
  mintToken: async (input) =>
    `minted:${input.workspaceId}:${input.scopes.join(',')}`,
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
  await db.insert(schema.user).values({
    id: MEMBER,
    name: 'Cred Member',
    email: 'cred-member@sheetbase.test',
    emailVerified: true,
  })
  await db.insert(schema.workspaceMemberships).values([
    {
      workspaceId: WS,
      userId: OWNER,
      role: 'owner',
    },
    {
      workspaceId: WS,
      userId: MEMBER,
      role: 'member',
    },
  ])
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
      hashSecret(
        created.displayPrefix,
        parseCredentialString(created.secret)!.secret,
      ),
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

  it('rejects scientific:* scopes on new credentials', async () => {
    await expect(
      createCredential(db, {
        workspaceId: WS,
        createdByUserId: OWNER,
        name: 'scientific integration',
        scopes: ['scientific:read', 'scientific:write', 'scientific:schema'],
      }),
    ).rejects.toMatchObject({ code: 'invalid_scope' })
  })

  it('issues Core-domain product scopes from the API-01 vocabulary', async () => {
    const created = await createCredential(db, {
      workspaceId: WS,
      createdByUserId: OWNER,
      name: 'dataset reader',
      scopes: ['datasets:read', 'schema:read'],
    })
    expect(created.scopes).toEqual(['datasets:read', 'schema:read'])
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
        eq(table.displayPrefix, parseCredentialString(credSecret)!.prefix),
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

describe('listCredentials', () => {
  it('returns metadata without the secret hash', async () => {
    const created = await createCredential(db, {
      workspaceId: WS,
      createdByUserId: OWNER,
      name: 'listed',
      scopes: ['projects:read'],
    })
    const rows = await listCredentials(db, WS)
    const match = rows.find((row) => row.id === created.id)
    expect(match).toMatchObject({
      displayPrefix: created.displayPrefix,
      name: 'listed',
      createdByUserId: OWNER,
      revokedAt: null,
    })
    expect(match).not.toHaveProperty('secretHash')
    expect(JSON.stringify(match)).not.toContain(created.secret)
  })
})

describe('rotateCredential', () => {
  it('issues a new secret, keeps product scopes, and revokes the old credential', async () => {
    const original = await createCredential(db, {
      workspaceId: WS,
      createdByUserId: OWNER,
      name: 'rotating',
      scopes: ['projects:read', 'projects:write'],
    })
    const rotated = await rotateCredential(db, {
      workspaceId: WS,
      credentialId: original.id,
      createdByUserId: OWNER,
    })
    expect(rotated.secret).not.toBe(original.secret)
    expect(rotated.scopes).toEqual(['projects:read', 'projects:write'])
    expect(rotated.name).toBe('rotating')

    await expect(
      exchangeCredential(db, original.secret, ['projects:read'], mintDeps),
    ).rejects.toMatchObject({ code: 'revoked' })

    const token = await exchangeCredential(
      db,
      rotated.secret,
      ['projects:write'],
      mintDeps,
    )
    expect(token).toContain('projects:write')
  })

  it('drops scientific:* scopes and falls back to projects:read', async () => {
    const id = '00000000-0000-4000-8000-00000000051a'
    await db.insert(schema.apiCredentials).values({
      id,
      workspaceId: WS,
      displayPrefix: 'legacy01',
      secretHash: hashSecret('legacy01', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
      name: 'legacy scientific',
      scopes: ['scientific:read', 'scientific:write'],
      createdByUserId: OWNER,
    })
    const rotated = await rotateCredential(db, {
      workspaceId: WS,
      credentialId: id,
      createdByUserId: OWNER,
    })
    expect(rotated.scopes).toEqual(['projects:read'])
  })
})

describe('workspace privilege helpers', () => {
  it('treats owners as members and members as non-owners', async () => {
    await expect(isWorkspaceOwner(db, OWNER, WS)).resolves.toBe(true)
    await expect(isWorkspaceOwner(db, MEMBER, WS)).resolves.toBe(false)
    await expect(isWorkspaceMember(db, MEMBER, WS)).resolves.toBe(true)
    await expect(isWorkspaceMember(db, 'missing-user', WS)).resolves.toBe(false)
  })
})

describe('legacy scientific credentials', () => {
  it('still exchanges existing scientific:* rows', async () => {
    const prefix = 'cafef00d'
    const secret = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    await db.insert(schema.apiCredentials).values({
      workspaceId: WS,
      displayPrefix: prefix,
      secretHash: hashSecret(prefix, secret),
      name: 'legacy exchange',
      scopes: ['scientific:read'],
      createdByUserId: OWNER,
    })
    const token = await exchangeCredential(
      db,
      `sb_${prefix}_${secret}`,
      ['scientific:read'],
      mintDeps,
    )
    expect(token).toContain('scientific:read')
  })
})
