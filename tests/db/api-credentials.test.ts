/**
 * API-005 contract proof: credential creation, exchange, revocation,
 * wrong-secret, wrong-scope and rate-limiting behaviour. Runs against a
 * freshly migrated sheetbase_test database. Token minting is stubbed so the
 * test asserts the exchange logic, not JWT signing (covered by AUTH-003).
 */
import { drizzle } from 'drizzle-orm/node-postgres'
import { and, eq } from 'drizzle-orm'
import type { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import * as schema from '#/db/schema'
import { emitCredentialAuditEvent } from '#/lib/credential-audit'
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
const PERSONAL = 'cred-personal'

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
  await db.insert(schema.user).values({
    id: PERSONAL,
    name: 'Cred Personal',
    email: 'cred-personal@sheetbase.test',
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
    {
      workspaceId: WS,
      userId: PERSONAL,
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

  it('rejects scientific:* as unknown scopes', async () => {
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

  it('rejects scientific:* at exchange as an unknown scope', async () => {
    await expect(
      exchangeCredential(db, credSecret, ['scientific:read'], mintDeps),
    ).rejects.toMatchObject({ code: 'invalid_scope' })
  })

  it('rejects an expired credential', async () => {
    const created = await createCredential(db, {
      workspaceId: WS,
      createdByUserId: OWNER,
      name: 'soon expired',
      scopes: ['projects:read'],
      expiresAt: new Date(Date.now() + 60_000),
    })
    await db
      .update(schema.apiCredentials)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.apiCredentials.id, created.id))
    await expect(
      exchangeCredential(db, created.secret, ['projects:read'], mintDeps),
    ).rejects.toMatchObject({ code: 'expired' })
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
      expiresAt: null,
    })
    expect(match).not.toHaveProperty('secretHash')
    expect(JSON.stringify(match)).not.toContain(created.secret)
  })
})

describe('rotateCredential', () => {
  it('issues a new secret, keeps the exact scopes, and revokes the old credential', async () => {
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

  it('does not increase privilege on rotation', async () => {
    const original = await createCredential(db, {
      workspaceId: WS,
      createdByUserId: OWNER,
      name: 'read only rotator',
      scopes: ['projects:read', 'datasets:read'],
    })
    const rotated = await rotateCredential(db, {
      workspaceId: WS,
      credentialId: original.id,
      createdByUserId: OWNER,
    })
    expect(rotated.scopes).toEqual(['projects:read', 'datasets:read'])
    expect(rotated.scopes).not.toContain('projects:write')
    expect(rotated.scopes).not.toContain('datasets:write')
    await expect(
      exchangeCredential(db, rotated.secret, ['projects:write'], mintDeps),
    ).rejects.toMatchObject({ code: 'insufficient_scope' })
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

describe('removed scientific scopes', () => {
  it('rejects stored scientific:* rows at the database CHECK', async () => {
    await expect(
      db.insert(schema.apiCredentials).values({
        workspaceId: WS,
        displayPrefix: 'cafef00d',
        secretHash: hashSecret('cafef00d', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
        name: 'legacy exchange',
        scopes: ['scientific:read'],
        createdByUserId: OWNER,
      }),
    ).rejects.toThrow()
  })
})

describe('personal tokens', () => {
  let captured: Parameters<ExchangeDeps['mintToken']>[0] | null

  const captureDeps: ExchangeDeps = {
    mintToken: async (input) => {
      captured = input
      return 'minted'
    },
  }

  beforeEach(() => {
    captured = null
  })

  function suspendMembership(userId: string) {
    return db
      .update(schema.workspaceMemberships)
      .set({ suspendedAt: new Date() })
      .where(
        and(
          eq(schema.workspaceMemberships.userId, userId),
          eq(schema.workspaceMemberships.workspaceId, WS),
        ),
      )
  }

  function restoreMembership(userId: string) {
    return db
      .update(schema.workspaceMemberships)
      .set({ suspendedAt: null })
      .where(
        and(
          eq(schema.workspaceMemberships.userId, userId),
          eq(schema.workspaceMemberships.workspaceId, WS),
        ),
      )
  }

  it('exchanges as its creating member', async () => {
    const created = await createCredential(db, {
      workspaceId: WS,
      createdByUserId: PERSONAL,
      name: 'my token',
      scopes: ['projects:read'],
      kind: 'personal',
    })

    await exchangeCredential(db, created.secret, ['projects:read'], captureDeps)

    expect(captured).toMatchObject({
      kind: 'personal',
      userId: PERSONAL,
      workspaceId: WS,
      scopes: ['projects:read'],
    })
  })

  it('stops exchanging while the membership is suspended, resumes after', async () => {
    const created = await createCredential(db, {
      workspaceId: WS,
      createdByUserId: PERSONAL,
      name: 'suspend me',
      scopes: ['projects:read'],
      kind: 'personal',
    })

    try {
      await suspendMembership(PERSONAL)
      await expect(
        exchangeCredential(db, created.secret, ['projects:read'], mintDeps),
      ).rejects.toMatchObject({ code: 'revoked' })
    } finally {
      await restoreMembership(PERSONAL)
    }

    await exchangeCredential(db, created.secret, ['projects:read'], mintDeps)
  })

  it('keeps a service credential usable when its creator is suspended', async () => {
    const created = await createCredential(db, {
      workspaceId: WS,
      createdByUserId: PERSONAL,
      name: 'service stays',
      scopes: ['projects:read'],
    })

    try {
      await suspendMembership(PERSONAL)
      await exchangeCredential(db, created.secret, ['projects:read'], mintDeps)
    } finally {
      await restoreMembership(PERSONAL)
    }
  })

  it('rotation keeps the personal kind and member binding', async () => {
    const original = await createCredential(db, {
      workspaceId: WS,
      createdByUserId: PERSONAL,
      name: 'rotating personal',
      scopes: ['projects:read'],
      kind: 'personal',
    })

    const rotated = await rotateCredential(db, {
      workspaceId: WS,
      credentialId: original.id,
      createdByUserId: PERSONAL,
    })

    expect(rotated.kind).toBe('personal')
    await expect(
      exchangeCredential(db, original.secret, ['projects:read'], mintDeps),
    ).rejects.toMatchObject({ code: 'revoked' })

    await exchangeCredential(db, rotated.secret, ['projects:read'], captureDeps)
    expect(captured).toMatchObject({ kind: 'personal', userId: PERSONAL })
  })
})

describe('credential audit events', () => {
  function eventsFor(credentialId: string) {
    return db
      .select()
      .from(schema.changeEvents)
      .where(eq(schema.changeEvents.entityUuid, credentialId))
  }

  it('records create inside the mutation transaction with display metadata only', async () => {
    const created = await db.transaction(async (tx) => {
      const created = await createCredential(tx, {
        workspaceId: WS,
        createdByUserId: OWNER,
        name: 'audited create',
        scopes: ['projects:read'],
        kind: 'personal',
      })
      await emitCredentialAuditEvent(tx, {
        actorUserId: OWNER,
        workspaceId: WS,
        credentialId: created.id,
        operation: 'create',
        payload: {
          name: created.name,
          displayPrefix: created.displayPrefix,
          kind: 'personal',
        },
      })
      return created
    })

    const rows = await eventsFor(created.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      entityType: 'api_credential',
      operation: 'create',
      actorUserId: OWNER,
      workspaceId: WS,
    })
    expect(rows[0].payload).toEqual({
      name: 'audited create',
      displayPrefix: created.displayPrefix,
      kind: 'personal',
    })
    expect(JSON.stringify(rows[0].payload)).not.toContain('secret')
  })

  it('rolls the audit event back with a failed mutation transaction', async () => {
    let credentialId: string | null = null

    await expect(
      db.transaction(async (tx) => {
        const created = await createCredential(tx, {
          workspaceId: WS,
          createdByUserId: OWNER,
          name: 'never commits',
          scopes: ['projects:read'],
        })
        credentialId = created.id
        await emitCredentialAuditEvent(tx, {
          actorUserId: OWNER,
          workspaceId: WS,
          credentialId: created.id,
          operation: 'create',
          payload: { name: created.name },
        })
        throw new Error('rollback after emit')
      }),
    ).rejects.toThrow('rollback after emit')

    expect(credentialId!).toBeTruthy()
    // Neither the credential nor its audit event exists: they rolled back
    // together.
    expect(await eventsFor(credentialId!)).toHaveLength(0)
    const row = await db.query.apiCredentials.findFirst({
      where: eq(schema.apiCredentials.id, credentialId!),
    })
    expect(row).toBeUndefined()
  })

  it('records rotation as revoke(old) + create(new) with rotation linkage', async () => {
    const original = await createCredential(db, {
      workspaceId: WS,
      createdByUserId: OWNER,
      name: 'audited rotation',
      scopes: ['projects:read'],
    })

    const rotated = await db.transaction(async (tx) => {
      const rotated = await rotateCredential(tx, {
        workspaceId: WS,
        credentialId: original.id,
        createdByUserId: OWNER,
      })
      await emitCredentialAuditEvent(tx, {
        actorUserId: OWNER,
        workspaceId: WS,
        credentialId: original.id,
        operation: 'revoke',
        payload: { rotatedToCredentialId: rotated.id },
      })
      await emitCredentialAuditEvent(tx, {
        actorUserId: OWNER,
        workspaceId: WS,
        credentialId: rotated.id,
        operation: 'create',
        payload: {
          name: rotated.name,
          displayPrefix: rotated.displayPrefix,
          kind: rotated.kind,
          rotatedFromCredentialId: original.id,
        },
      })
      return rotated
    })

    const oldRows = await eventsFor(original.id)
    const newRows = await eventsFor(rotated.id)
    expect(oldRows).toHaveLength(1)
    expect(newRows).toHaveLength(1)
    expect(oldRows[0]).toMatchObject({
      entityType: 'api_credential',
      operation: 'revoke',
    })
    expect(oldRows[0].payload).toEqual({
      rotatedToCredentialId: rotated.id,
    })
    expect(newRows[0].payload).toMatchObject({
      rotatedFromCredentialId: original.id,
    })

    // The revoke(old) event precedes create(new) in the workspace stream.
    expect(oldRows[0].sequence < newRows[0].sequence).toBe(true)
  })
})

describe('SET-04.2 token expiry window and refusals', () => {
  it('refuses a token that would live longer than 90 days', async () => {
    const { rows } = await migrator.query<{ id: string }>(
      `insert into internal.api_credentials(workspace_id,display_prefix,secret_hash,name,scopes,created_by_user_id,expires_at)
       values($1,'aaaabbbb','hash','Too long',array['projects:read'],$2, now() + interval '91 days')
       returning id`,
      [WS, OWNER],
    ).catch((error: Error) => ({ rows: [{ id: `error:${error.message}` }] }))
    expect(rows[0]!.id).toContain('90 days')

    const ok = await migrator.query<{ id: string }>(
      `insert into internal.api_credentials(workspace_id,display_prefix,secret_hash,name,scopes,created_by_user_id,expires_at)
       values($1,'bbbbcccc','hash','Within window',array['projects:read'],$2, now() + interval '89 days')
       returning id`,
      [WS, OWNER],
    )
    const id = ok.rows[0]!.id

    // A refusal is recorded and surfaces as needing a replacement once expired.
    await migrator.query('select internal.record_credential_refusal($1)', [id])
    await migrator.query(
      `update internal.api_credentials set expires_at = now() - interval '1 hour' where id=$1`,
      [id],
    )
    // The settings read is admin-scoped, so it is called with the owner's claims.
    await migrator.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ role: 'authenticated', sub: OWNER, workspace_id: WS }),
    ])
    const status = await migrator.query<{
      refusal_count: number
      expired: boolean
      needs_replacement: boolean
    }>('select refusal_count,expired,needs_replacement from api.api_credential_status() where id=$1', [id])
    await migrator.query("select set_config('request.jwt.claims','{}',false)")
    expect(status.rows[0]).toMatchObject({
      refusal_count: 1,
      expired: true,
      needs_replacement: true,
    })
  })
})
