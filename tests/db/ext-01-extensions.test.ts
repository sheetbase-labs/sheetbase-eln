/**
 * EXT-01 database proof: workspace-scoped extension registry, governed
 * lifecycle (install/enable/disable), fail-closed manifest validation,
 * per-call capability gating and audit trail — all against real Postgres.
 */
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as schema from '#/db/schema'
import { revokeCredential } from '#/lib/api-credentials'
import {
  issueExtensionCredential,
  resolveExtensionCall,
  ExtensionCredentialError,
} from '#/lib/extensions/credentials'
import { migratorUrl, prepareTestDatabase } from './helpers'

const WS_A = '0e010000-0000-4000-8000-0000000000e1'
const WS_B = '0e010000-0000-4000-8000-0000000000e2'
const OWNER_A = 'ext-owner-a'
const STEWARD_A = 'ext-steward-a'
const MEMBER_A = 'ext-member-a'
const VIEWER_A = 'ext-viewer-a'
const OWNER_B = 'ext-owner-b'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
let db: ReturnType<typeof drizzle<typeof schema>>
const clients: Client[] = []

async function actor(userId: string, workspaceId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({
      role: 'authenticated',
      sub: userId,
      workspace_id: workspaceId,
    }),
  ])
  return client
}

function manifestFixture() {
  return {
    id: 'acme.retest-tracker',
    name: 'Retest Tracker',
    version: '1.0.0',
    source: 'https://extensions.example.com/acme/retest-tracker-1.0.0.tgz',
    capabilities: ['record.create', 'record.link'],
    scopes: ['projects:read', 'projects:write'],
    contributions: {
      commands: [{ id: 'retest-today', title: 'Show retests due today' }],
      'event-subscriptions': [{ eventType: 'record.updated' }],
    },
  }
}

async function install(
  client: Client,
  overrides: {
    key?: string
    name?: string
    version?: string
    source?: string
    manifest?: unknown
  } = {},
) {
  const manifest = (overrides.manifest ?? manifestFixture()) as Record<string, unknown>
  const rows = (
    await client.query(
      `select * from api.install_extension($1,$2,$3,$4,$5,$6::jsonb)`,
      [
        WS_A,
        overrides.key ?? 'retest',
        overrides.name ?? manifest.name ?? 'Retest Tracker',
        overrides.version ?? manifest.version ?? '1.0.0',
        overrides.source ?? manifest.source ?? 'https://extensions.example.com/x.tgz',
        JSON.stringify(manifest),
      ],
    )
  ).rows
  return rows[0] as {
    id: string
    workspace_id: string
    key: string
    status: string
    manifest: { capabilities: string[]; scopes: string[] }
  }
}

async function createWorkspaceFixture() {
  await migrator.query(
    `insert into api.workspaces(id,slug,name,status) values
       ('${WS_A}','ext-a','EXT A','active'),
       ('${WS_B}','ext-b','EXT B','active')
     on conflict (id) do nothing`,
  )
  for (const [id, name] of [
    [OWNER_A, 'Owner A'],
    [STEWARD_A, 'Steward A'],
    [MEMBER_A, 'Member A'],
    [VIEWER_A, 'Viewer A'],
    [OWNER_B, 'Owner B'],
  ] as const) {
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values($1,$2,$3,'f')
       on conflict (id) do nothing`,
      [id, name, `${id}@test`],
    )
  }
  for (const [userId, workspaceId, role] of [
    [OWNER_A, WS_A, 'owner'],
    [STEWARD_A, WS_A, 'steward'],
    [MEMBER_A, WS_A, 'member'],
    [VIEWER_A, WS_A, 'viewer'],
    [OWNER_B, WS_B, 'owner'],
  ] as const) {
    await migrator.query(
      `insert into api.workspace_memberships(workspace_id,user_id,role)
       values($1,$2,$3) on conflict do nothing`,
      [workspaceId, userId, role],
    )
  }
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  db = drizzle(migratorUrl(), { schema })
  await createWorkspaceFixture()
})

afterAll(async () => {
  await db.$client.end().catch(() => {})
  await migrator.end().catch(() => {})
  for (const client of clients) await client.end().catch(() => {})
})

describe('EXT-01 extension lifecycle', () => {
  it('installs as owner and audits the transition', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const extension = await install(owner, { key: 'retest-audit' })
    expect(extension.status).toBe('installed')
    expect(extension.workspace_id).toBe(WS_A)
    const events = (
      await owner.query(
        `select entity_type, operation from api.change_events
         where workspace_id=$1 and entity_type='extension' and entity_uuid=$2`,
        [WS_A, extension.id],
      )
    ).rows
    expect(events).toMatchObject([{ entity_type: 'extension', operation: 'create' }])
  })

  it('lets stewards install but denies members and viewers', async () => {
    const steward = await actor(STEWARD_A, WS_A)
    const extension = await install(steward, { key: 'retest-steward' })
    expect(extension.status).toBe('installed')

    const member = await actor(MEMBER_A, WS_A)
    await expect(install(member, { key: 'retest-member' })).rejects.toMatchObject({
      code: '42501',
    })
    const viewer = await actor(VIEWER_A, WS_A)
    await expect(install(viewer, { key: 'retest-viewer' })).rejects.toMatchObject({
      code: '42501',
    })
  })

  it('rejects unknown contribution points fail-closed', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const manifest = { ...manifestFixture(), contributions: { widgets: [] } }
    await expect(install(owner, { key: 'retest-widget', manifest })).rejects.toMatchObject({
      code: 'SB034',
    })
  })

  it('rejects unknown capabilities, scopes and event subscriptions', async () => {
    const owner = await actor(OWNER_A, WS_A)
    await expect(
      install(owner, {
        key: 'retest-badcap',
        manifest: { ...manifestFixture(), capabilities: ['database.drop'] },
      }),
    ).rejects.toMatchObject({ code: 'SB034' })
    await expect(
      install(owner, {
        key: 'retest-badscope',
        manifest: { ...manifestFixture(), scopes: ['database:admin'] },
      }),
    ).rejects.toMatchObject({ code: 'SB034' })
    await expect(
      install(owner, {
        key: 'retest-badevent',
        manifest: {
          ...manifestFixture(),
          contributions: {
            'event-subscriptions': [{ eventType: 'record.teleported' }],
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'SB034' })
  })

  it('rejects row/manifest identity drift', async () => {
    const owner = await actor(OWNER_A, WS_A)
    await expect(
      install(owner, { key: 'retest-drift', name: 'Different Name' }),
    ).rejects.toMatchObject({ code: 'SB034' })
  })

  it('moves installed → enabled → disabled with idempotent repeats', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const extension = await install(owner, { key: 'retest-lifecycle' })

    const enabled = (
      await owner.query(`select * from api.enable_extension($1,$2)`, [WS_A, extension.id])
    ).rows[0]
    expect(enabled.status).toBe('enabled')

    const enabledAgain = (
      await owner.query(`select * from api.enable_extension($1,$2)`, [WS_A, extension.id])
    ).rows[0]
    expect(enabledAgain.status).toBe('enabled')

    const disabled = (
      await owner.query(`select * from api.disable_extension($1,$2)`, [WS_A, extension.id])
    ).rows[0]
    expect(disabled.status).toBe('disabled')

    const events = (
      await owner.query(
        `select operation from api.change_events
         where workspace_id=$1 and entity_type='extension' and entity_uuid=$2
         order by created_at asc`,
        [WS_A, extension.id],
      )
    ).rows.map((row: { operation: string }) => row.operation)
    expect(events).toEqual(['create', 'update', 'update'])
  })

  it('gates lifecycle transitions on extensions.manage and workspace scope', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const extension = await install(owner, { key: 'retest-gated' })

    const member = await actor(MEMBER_A, WS_A)
    await expect(
      member.query(`select * from api.enable_extension($1,$2)`, [WS_A, extension.id]),
    ).rejects.toMatchObject({ code: '42501' })

    const otherOwner = await actor(OWNER_B, WS_B)
    await expect(
      otherOwner.query(`select * from api.enable_extension($1,$2)`, [WS_A, extension.id]),
    ).rejects.toMatchObject({ code: 'SB033' })

    await expect(
      owner.query(`select * from api.enable_extension($1,$2)`, [
        WS_A,
        '00000000-0000-4000-8000-ffffffffffff',
      ]),
    ).rejects.toMatchObject({ code: 'SB036' })
  })

  it('isolates installs between workspaces (RLS)', async () => {
    const owner = await actor(OWNER_A, WS_A)
    await install(owner, { key: 'retest-rls' })
    const mine = await owner.query(`select count(*)::int as n from api.extensions`)
    expect(mine.rows[0].n).toBeGreaterThan(0)

    const otherOwner = await actor(OWNER_B, WS_B)
    const theirs = await otherOwner.query(`select count(*)::int as n from api.extensions`)
    expect(theirs.rows[0].n).toBe(0)
  })

  it('keeps the registry invisible to external credentials (fail-closed)', async () => {
    const grants = (
      await migrator.query(
        `select grantee, privilege_type from information_schema.role_table_grants
         where table_schema='api' and table_name='extensions' order by grantee, privilege_type`,
      )
    ).rows
    expect(
      grants.filter((g: { grantee: string }) => g.grantee === 'api_client'),
    ).toEqual([])
    const rpcGrants = (
      await migrator.query(
        `select grantee from information_schema.routine_privileges
         where routine_schema='api'
           and routine_name in ('install_extension','enable_extension','disable_extension')
           and grantee='api_client'`,
      )
    ).rows
    expect(rpcGrants).toEqual([])
  })
})

describe('EXT-01 extension-attributed authority', () => {
  it('asserts enabled + declared + granted on every call', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const extension = await install(owner, { key: 'retest-assert' })
    await owner.query(`select * from api.enable_extension($1,$2)`, [WS_A, extension.id])

    // Declared and granted to the owner: passes silently.
    await owner.query(`select api.assert_extension_capability($1,$2,$3)`, [
      WS_A,
      extension.id,
      'record.create',
    ])

    // Not declared by the manifest: denied even though the owner holds it.
    await expect(
      owner.query(`select api.assert_extension_capability($1,$2,$3)`, [
        WS_A,
        extension.id,
        'schema.edit',
      ]),
    ).rejects.toMatchObject({ code: '42501' })

    // Declared but not granted to a viewer: denied.
    const viewer = await actor(VIEWER_A, WS_A)
    await expect(
      viewer.query(`select api.assert_extension_capability($1,$2,$3)`, [
        WS_A,
        extension.id,
        'record.create',
      ]),
    ).rejects.toMatchObject({ code: '42501' })

    // Disabled extensions cannot act.
    await owner.query(`select * from api.disable_extension($1,$2)`, [WS_A, extension.id])
    await expect(
      owner.query(`select api.assert_extension_capability($1,$2,$3)`, [
        WS_A,
        extension.id,
        'record.create',
      ]),
    ).rejects.toMatchObject({ code: 'SB042' })
  })

  it('reports declared capabilities to workspace members', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const extension = await install(owner, { key: 'retest-declared' })
    const { rows } = await owner.query(`select api.extension_capabilities($1,$2) caps`, [
      WS_A,
      extension.id,
    ])
    expect(rows[0].caps).toEqual(['record.create', 'record.link'])
  })

  it('lists extensions.manage for governors, never for viewers', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const ownerCaps = (
      await owner.query(`select api.list_capabilities($1) caps`, [WS_A])
    ).rows[0].caps as string[]
    expect(ownerCaps).toContain('extensions.manage')

    const viewer = await actor(VIEWER_A, WS_A)
    const viewerCaps = (
      await viewer.query(`select api.list_capabilities($1) caps`, [WS_A])
    ).rows[0].caps as string[]
    expect(viewerCaps).not.toContain('extensions.manage')
  })
})

describe('EXT-01 per-extension credentials', () => {
  it('issues minimal manifest-declared scopes and resolves enabled calls', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const extension = await install(owner, { key: 'retest-cred' })
    await owner.query(`select * from api.enable_extension($1,$2)`, [WS_A, extension.id])

    const created = await issueExtensionCredential(db, {
      workspaceId: WS_A,
      extensionId: extension.id,
      actorRole: 'owner',
      actorUserId: OWNER_A,
      scopes: ['projects:read'],
    })
    expect(created.scopes).toEqual(['projects:read'])

    const resolved = await resolveExtensionCall(db, {
      credentialId: created.id,
      requiredScope: 'projects:read',
    })
    expect(resolved.extensionId).toBe(extension.id)
    expect(resolved.workspaceId).toBe(WS_A)
    expect(resolved.audit.extension_key).toBe('retest-cred')
    expect(resolved.audit.extension_manifest).toBe('acme.retest-tracker')
  })

  it('refuses issuance without extensions.manage or beyond declared scopes', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const extension = await install(owner, { key: 'retest-creddenied' })

    await expect(
      issueExtensionCredential(db, {
        workspaceId: WS_A,
        extensionId: extension.id,
        actorRole: 'member',
        actorUserId: MEMBER_A,
        scopes: ['projects:read'],
      }),
    ).rejects.toMatchObject({ name: 'ExtensionCredentialError', code: 'denied' })

    await expect(
      issueExtensionCredential(db, {
        workspaceId: WS_A,
        extensionId: extension.id,
        actorRole: 'owner',
        actorUserId: OWNER_A,
        scopes: ['datasets:read'],
      }),
    ).rejects.toMatchObject({
      name: 'ExtensionCredentialError',
      code: 'scope_not_declared',
    })
  })

  it('fails closed on unenabled installs, revoked credentials and missing scopes', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const extension = await install(owner, { key: 'retest-credfail' })

    const created = await issueExtensionCredential(db, {
      workspaceId: WS_A,
      extensionId: extension.id,
      actorRole: 'owner',
      actorUserId: OWNER_A,
      scopes: ['projects:read'],
    })

    // Installed but not enabled: calls cannot attribute.
    await expect(
      resolveExtensionCall(db, { credentialId: created.id, requiredScope: 'projects:read' }),
    ).rejects.toMatchObject({ name: 'ExtensionCredentialError', code: 'extension_disabled' })

    await owner.query(`select * from api.enable_extension($1,$2)`, [WS_A, extension.id])
    // Credential lacks the scope the call needs.
    await expect(
      resolveExtensionCall(db, { credentialId: created.id, requiredScope: 'projects:write' }),
    ).rejects.toMatchObject({ name: 'ExtensionCredentialError', code: 'insufficient_scope' })

    // Disabled again: calls stop attributing immediately.
    await owner.query(`select * from api.disable_extension($1,$2)`, [WS_A, extension.id])
    await expect(
      resolveExtensionCall(db, { credentialId: created.id, requiredScope: 'projects:read' }),
    ).rejects.toMatchObject({ name: 'ExtensionCredentialError', code: 'extension_disabled' })

    // Revoked credentials never attribute again, even once re-enabled.
    await owner.query(`select * from api.enable_extension($1,$2)`, [WS_A, extension.id])
    await revokeCredential(db, { workspaceId: WS_A, credentialId: created.id })
    await expect(
      resolveExtensionCall(db, { credentialId: created.id, requiredScope: 'projects:read' }),
    ).rejects.toMatchObject({ name: 'ExtensionCredentialError', code: 'revoked' })
  })
})
