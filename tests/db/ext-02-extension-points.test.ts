/**
 * EXT-02 database proof: the sample manifest survives the server-side
 * validation (TS ↔ SQL parity for a capabilities-free manifest), the
 * enable/disable machine gates `api.assert_extension_capability`
 * fail-closed, and the registry resolves the installed row for members
 * only while it is enabled.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { resolveExtensionContributions } from '#/lib/extensions/registry'
import { SAMPLE_EXTENSION_KEY, SAMPLE_EXTENSION_MANIFEST } from '#/lib/extensions/sample/manifest'
import { prepareTestDatabase } from './helpers'

const WS = '0e020000-0000-4000-8000-0000000000e1'
const OWNER = 'ext02-owner'
const MEMBER = 'ext02-member'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function actor(userId: string, workspaceId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ role: 'authenticated', sub: userId, workspace_id: workspaceId }),
  ])
  return client
}

async function installSample(client: Client, key = SAMPLE_EXTENSION_KEY) {
  const rows = (
    await client.query(
      `select * from api.install_extension($1,$2,$3,$4,$5,$6::jsonb)`,
      [
        WS,
        key,
        SAMPLE_EXTENSION_MANIFEST.name,
        SAMPLE_EXTENSION_MANIFEST.version,
        SAMPLE_EXTENSION_MANIFEST.source,
        JSON.stringify(SAMPLE_EXTENSION_MANIFEST),
      ],
    )
  ).rows
  return rows[0] as { id: string; status: string; manifest: unknown }
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `insert into api.workspaces(id,slug,name,status) values
       ('${WS}','ext-02','EXT-02','active')
     on conflict (id) do nothing`,
  )
  for (const [id, name] of [
    [OWNER, 'EXT-02 Owner'],
    [MEMBER, 'EXT-02 Member'],
  ] as const) {
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values($1,$2,$3,'f')
       on conflict (id) do nothing`,
      [id, name, `${id}@test`],
    )
  }
  for (const [userId, role] of [
    [OWNER, 'owner'],
    [MEMBER, 'member'],
  ] as const) {
    await migrator.query(
      `insert into api.workspace_memberships(workspace_id,user_id,role)
       values($1,$2,$3) on conflict do nothing`,
      [WS, userId, role],
    )
  }
})

afterAll(async () => {
  await migrator.end().catch(() => {})
  for (const client of clients) await client.end().catch(() => {})
})

describe('EXT-02 sample install + enforcement', () => {
  it('installs the capabilities-free sample manifest (TS/SQL parity)', async () => {
    const owner = await actor(OWNER, WS)
    const extension = await installSample(owner, 'sample-parity')
    expect(extension.status).toBe('installed')
  })

  it('gates assert_extension_capability fail-closed around the lifecycle', async () => {
    const owner = await actor(OWNER, WS)
    const member = await actor(MEMBER, WS)
    const extension = await installSample(owner, 'sample-gate')

    // Installed but not enabled: every assert fails, even for members.
    await expect(
      member.query(`select api.assert_extension_capability($1,$2,$3)`, [
        WS,
        extension.id,
        'record.create',
      ]),
    ).rejects.toMatchObject({ code: 'SB042' })

    await owner.query(`select api.enable_extension($1,$2)`, [WS, extension.id])

    // Enabled, but the sample declares no capabilities: any assert fails
    // with the capability error, never a silent pass.
    await expect(
      member.query(`select api.assert_extension_capability($1,$2,$3)`, [
        WS,
        extension.id,
        'record.create',
      ]),
    ).rejects.toMatchObject({ code: '42501' })

    // Disabling revokes the gate again.
    await owner.query(`select api.disable_extension($1,$2)`, [WS, extension.id])
    await expect(
      member.query(`select api.assert_extension_capability($1,$2,$3)`, [
        WS,
        extension.id,
        'record.create',
      ]),
    ).rejects.toMatchObject({ code: 'SB042' })
  })

  it('resolves the installed row through the registry only while enabled', async () => {
    const owner = await actor(OWNER, WS)
    const extension = await installSample(owner, 'sample-resolve')
    const toInstall = (status: string) => ({
      id: extension.id,
      key: SAMPLE_EXTENSION_KEY,
      status,
      manifest: extension.manifest,
    })

    // Installed-only: nothing resolves, even for members.
    expect(
      resolveExtensionContributions([toInstall('installed')], 'member').objectActions,
    ).toEqual([])

    await owner.query(`select api.enable_extension($1,$2)`, [WS, extension.id])
    const live = (
      await owner.query(`select status, manifest from api.extensions where id=$1`, [extension.id])
    ).rows[0] as { status: string; manifest: unknown }
    const enabled = resolveExtensionContributions(
      [{ id: extension.id, key: SAMPLE_EXTENSION_KEY, status: live.status, manifest: live.manifest }],
      'member',
    )
    expect(enabled.objectActions.map((c) => c.id)).toEqual(['open-panel'])
    expect(enabled.panels.map((c) => c.id)).toEqual(['sample-panel'])
    expect(enabled.commands.map((c) => c.id)).toEqual(['sample-overview'])
  })
})
