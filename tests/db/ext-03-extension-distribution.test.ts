import { afterAll, beforeAll, describe, expect, it } from 'vitest'
/**
 * EXT-03 database proof: trusted install/update acknowledgement, the
 * compatibleWith grammar (TS ↔ SQL parity), the completed lifecycle
 * (update resets to installed + revokes credentials; remove revokes then
 * deletes and audits), and extension history correlation through the
 * canonical `api.audit_events` RPC — all against real Postgres.
 */
import { Client } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'

import * as schema from '#/db/schema'
import { migratorUrl, prepareTestDatabase } from './helpers'

const WS = '0e030000-0000-4000-8000-0000000000e1'
const OWNER = 'ext3-owner'
const STEWARD = 'ext3-steward'
const MEMBER = 'ext3-member'

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

function manifestFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'acme.dist-governed',
    name: 'Dist Governed',
    version: '1.0.0',
    source: 'https://extensions.example.com/acme/dist-governed-1.0.0.tgz',
    compatibleWith: '>=1.0.0 <2.0.0',
    capabilities: ['record.create'],
    scopes: ['projects:read'],
    contributions: {
      commands: [{ id: 'dist-today', title: 'Show distribution due today' }],
    },
    ...overrides,
  }
}

type Row = {
  id: string
  workspace_id: string
  key: string
  name: string
  version: string
  source: string
  status: string
  credential_id: string | null
  manifest: Record<string, unknown>
}

async function install(
  client: Client,
  overrides: {
    key?: string
    name?: string
    version?: string
    source?: string
    manifest?: unknown
    acknowledgeUntrusted?: boolean
  } = {},
): Promise<Row> {
  const manifest = (overrides.manifest ?? manifestFixture()) as Record<
    string,
    unknown
  >
  const rows = (
    await client.query(
      `select * from api.install_extension($1,$2,$3,$4,$5,$6::jsonb,$7)`,
      [
        WS,
        overrides.key ?? 'dist',
        overrides.name ?? manifest.name ?? 'Dist Governed',
        overrides.version ?? manifest.version ?? '1.0.0',
        overrides.source ??
          manifest.source ??
          'https://extensions.example.com/x.tgz',
        JSON.stringify(manifest),
        overrides.acknowledgeUntrusted ?? false,
      ],
    )
  ).rows
  return rows[0] as Row
}

async function createWorkspaceFixture() {
  await migrator.query(
    `insert into api.workspaces(id,slug,name,status) values
       ('${WS}','ext-3','EXT 3','active')
     on conflict (id) do nothing`,
  )
  for (const [id, name] of [
    [OWNER, 'Owner'],
    [STEWARD, 'Steward'],
    [MEMBER, 'Member'],
  ] as const) {
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values($1,$2,$3,'f')
       on conflict (id) do nothing`,
      [id, name, `${id}@test`],
    )
  }
  for (const [userId, role] of [
    [OWNER, 'owner'],
    [STEWARD, 'steward'],
    [MEMBER, 'member'],
  ] as const) {
    await migrator.query(
      `insert into api.workspace_memberships(workspace_id,user_id,role)
       values($1,$2,$3) on conflict do nothing`,
      [WS, userId, role],
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

describe('EXT-03 trusted distribution', () => {
  it('installs https sources without acknowledgement and keeps old 6-arg calls working', async () => {
    const owner = await actor(OWNER, WS)
    const extension = await install(owner, { key: 'dist-https' })
    expect(extension.status).toBe('installed')

    // Pre-EXT-03 callers pass six arguments; the defaulted acknowledgement
    // keeps them working for trusted sources.
    const manifest = manifestFixture()
    const legacy = (
      await owner.query(
        `select * from api.install_extension($1,$2,$3,$4,$5,$6::jsonb)`,
        [
          WS,
          'dist-legacy',
          manifest.name,
          manifest.version,
          manifest.source,
          JSON.stringify(manifest),
        ],
      )
    ).rows[0] as Row
    expect(legacy.status).toBe('installed')
  })

  it('rejects untrusted sources without explicit acknowledgement, accepts with it', async () => {
    const owner = await actor(OWNER, WS)
    const source = 'dev:dist-governed-panel'
    const manifest = manifestFixture({
      version: '1.0.0',
      source,
      compatibleWith: '*',
    })
    await expect(
      install(owner, { key: 'dist-untrusted', source, manifest }),
    ).rejects.toMatchObject({ code: 'SB034' })

    const acknowledged = await install(owner, {
      key: 'dist-untrusted',
      source,
      manifest,
      acknowledgeUntrusted: true,
    })
    expect(acknowledged.source).toBe(source)
  })

  it('denies untrusted installs to members even with acknowledgement', async () => {
    const member = await actor(MEMBER, WS)
    await expect(
      install(member, {
        key: 'dist-member',
        source: 'dev:dist-member',
        manifest: manifestFixture({
          source: 'dev:dist-member',
          compatibleWith: '*',
        }),
        acknowledgeUntrusted: true,
      }),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('rejects malformed compatibleWith ranges fail-closed (SQL side of parity)', async () => {
    const owner = await actor(OWNER, WS)
    for (const [key, compatibleWith] of [
      ['dist-compat-caret', '^1.0.0'],
      ['dist-compat-word', 'banana'],
      ['dist-compat-short', '>=1.0'],
    ] as const) {
      await expect(
        install(owner, {
          key,
          manifest: manifestFixture({ compatibleWith }),
        }),
      ).rejects.toMatchObject({ code: 'SB034' })
    }
    const wildcard = await install(owner, {
      key: 'dist-compat-ok',
      manifest: manifestFixture({ compatibleWith: '*' }),
    })
    expect(wildcard.manifest['compatibleWith']).toBe('*')
  })
})

describe('EXT-03 lifecycle completion', () => {
  it('updates reset to installed, clear credentials and audit the transition', async () => {
    const owner = await actor(OWNER, WS)
    const extension = await install(owner, { key: 'dist-update' })
    await owner.query(`select * from api.enable_extension($1,$2)`, [
      WS,
      extension.id,
    ])

    const next = manifestFixture({ version: '1.1.0' })
    const updated = (
      await owner.query(
        `select * from api.update_extension($1,$2,$3,$4,$5,$6::jsonb,$7)`,
        [
          WS,
          extension.id,
          next.name,
          next.version,
          next.source,
          JSON.stringify(next),
          false,
        ],
      )
    ).rows[0] as Row
    expect(updated.version).toBe('1.1.0')
    // New code never auto-runs: back to installed, credential binding gone.
    expect(updated.status).toBe('installed')
    expect(updated.credential_id).toBeNull()

    const operations = (
      await owner.query(
        `select operation from api.change_events
         where workspace_id=$1 and entity_type='extension' and entity_uuid=$2
         order by created_at asc`,
        [WS, extension.id],
      )
    ).rows.map((row: { operation: string }) => row.operation)
    expect(operations).toEqual(['create', 'update', 'update'])
  })

  it('rejects update identity drift and gates update on extensions.manage', async () => {
    const owner = await actor(OWNER, WS)
    const member = await actor(MEMBER, WS)
    const extension = await install(owner, { key: 'dist-update-guard' })
    const next = manifestFixture({ version: '1.0.1' })
    await expect(
      owner.query(
        `select * from api.update_extension($1,$2,$3,$4,$5,$6::jsonb,$7)`,
        [
          WS,
          extension.id,
          'Different Name',
          next.version,
          next.source,
          JSON.stringify(next),
          false,
        ],
      ),
    ).rejects.toMatchObject({ code: 'SB034' })
    await expect(
      member.query(
        `select * from api.update_extension($1,$2,$3,$4,$5,$6::jsonb,$7)`,
        [
          WS,
          extension.id,
          next.name,
          next.version,
          next.source,
          JSON.stringify(next),
          false,
        ],
      ),
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      owner.query(
        `select * from api.update_extension($1,$2,$3,$4,$5,$6::jsonb,$7)`,
        [
          WS,
          '00000000-0000-4000-8000-000000000000',
          next.name,
          next.version,
          next.source,
          JSON.stringify(next),
          false,
        ],
      ),
    ).rejects.toMatchObject({ code: 'SB036' })
  })

  it('removes revoke bound credentials, delete the row and audit the removal', async () => {
    const owner = await actor(OWNER, WS)
    const extension = await install(owner, { key: 'dist-remove' })

    // Bind a credential through the ordinary credential path so removal has
    // real authority to revoke.
    const credential = (
      await migrator.query(
        `insert into internal.api_credentials(workspace_id,name,display_prefix,secret_hash,scopes,created_by_user_id)
         values($1,'extension:dist-remove','sb_test_fake','fake-hash','{projects:read}'::text[],$2)
         returning id`,
        [WS, OWNER],
      )
    ).rows[0] as { id: string }
    await migrator.query(
      `update api.extensions set credential_id=$1 where id=$2`,
      [credential.id, extension.id],
    )
    await owner.query(`select * from api.enable_extension($1,$2)`, [
      WS,
      extension.id,
    ])

    await owner.query(`select api.remove_extension($1,$2)`, [WS, extension.id])

    const remaining = (
      await owner.query(`select id from api.extensions where id=$1`, [
        extension.id,
      ])
    ).rows
    expect(remaining).toHaveLength(0)

    const revoked = (
      await migrator.query(
        `select revoked_at from internal.api_credentials where id=$1`,
        [credential.id],
      )
    ).rows[0] as { revoked_at: string | null }
    expect(revoked.revoked_at).not.toBeNull()

    const operations = (
      await owner.query(
        `select operation from api.change_events
         where workspace_id=$1 and entity_type='extension' and entity_uuid=$2
         order by created_at asc`,
        [WS, extension.id],
      )
    ).rows.map((row: { operation: string }) => row.operation)
    expect(operations).toEqual(['create', 'update', 'delete'])

    // Removal without dependents is unconditional; missing rows fail closed.
    await expect(
      owner.query(`select api.remove_extension($1,$2)`, [WS, extension.id]),
    ).rejects.toMatchObject({ code: 'SB036' })
    const member = await actor(MEMBER, WS)
    const other = await install(owner, { key: 'dist-remove-guard' })
    await expect(
      member.query(`select api.remove_extension($1,$2)`, [WS, other.id]),
    ).rejects.toMatchObject({ code: '42501' })
  })
})
describe('EXT-03 extension history correlation', () => {
  it('reads lifecycle plus attributed events through api.audit_events', async () => {
    const owner = await actor(OWNER, WS)
    // api.audit_events needs human-session claims (GOV-03), unlike the
    // extension lifecycle RPCs.
    await owner.query(`select set_config('request.jwt.claims',$1,false)`, [
      JSON.stringify({
        role: 'authenticated',
        sub: OWNER,
        workspace_id: WS,
        session_id: 'ext3-session',
      }),
    ])
    const extension = await install(owner, { key: 'dist-history' })
    // A durable extension-attributed write stamps the audit identity into
    // its canonical payload; the object correlation must find it.
    await migrator.query(
      `select internal.emit_change_event_as_actor($1,$2,'record',$3,'create',NULL,NULL,$4::jsonb)`,
      [
        OWNER,
        WS,
        '11111111-0000-4000-8000-000000000001',
        JSON.stringify({ extension_id: extension.id }),
      ],
    )

    const page = (
      await owner.query(`select api.audit_events($1,$2,$3,$4,$5,$6,$7)`, [
        null,
        null,
        null,
        null,
        null,
        null,
        extension.id,
      ])
    ).rows[0]['audit_events'] as {
      events: Array<{ entityType: string; operation: string }>
    }
    expect(
      page.events.map((event) => `${event.entityType}/${event.operation}`),
    ).toEqual(expect.arrayContaining(['extension/create', 'record/create']))

    const lifecycleOnly = (
      await owner.query(`select api.audit_events($1,$2,$3,$4,$5,$6,$7)`, [
        'extension',
        null,
        null,
        null,
        null,
        null,
        extension.id,
      ])
    ).rows[0]['audit_events'] as {
      events: Array<{ entityType: string; operation: string }>
    }
    expect(lifecycleOnly.events).toMatchObject([
      { entityType: 'extension', operation: 'create' },
    ])
  })
})
