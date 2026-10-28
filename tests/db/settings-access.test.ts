/**
 * Role-configurable settings access: defaults, owner override, the server
 * gates on the settings RPCs, and who may change the mapping.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase, setActorJwt } from './helpers'

const WS = '00000000-0000-4000-8000-0000005e0001'
const OWNER = 'sa-owner'
const ADMIN = 'sa-admin'
const STEWARD = 'sa-steward'
const MEMBER = 'sa-member'
const VIEWER = 'sa-viewer'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function actor(userId: string) {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await setActorJwt(client, userId, WS)
  return client
}

async function level(userId: string, area: string) {
  const c = await actor(userId)
  const { rows } = await c.query(
    'SELECT api.settings_access_level($1::uuid, $2) AS level',
    [WS, area],
  )
  return rows[0].level as string
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(`
    INSERT INTO internal."user"(id, name, email, "emailVerified") VALUES
      ('${OWNER}', 'Owner', 'sa-owner@test.invalid', true),
      ('${ADMIN}', 'Admin', 'sa-admin@test.invalid', true),
      ('${STEWARD}', 'Steward', 'sa-steward@test.invalid', true),
      ('${MEMBER}', 'Member', 'sa-member@test.invalid', true),
      ('${VIEWER}', 'Viewer', 'sa-viewer@test.invalid', true);
    INSERT INTO api.workspaces(id, slug, name) VALUES ('${WS}', 'sa-ws', 'Settings access');
    INSERT INTO api.workspace_memberships(workspace_id, user_id, role) VALUES
      ('${WS}', '${OWNER}', 'owner'), ('${WS}', '${ADMIN}', 'admin'),
      ('${WS}', '${STEWARD}', 'steward'), ('${WS}', '${MEMBER}', 'member'),
      ('${WS}', '${VIEWER}', 'viewer');
  `)
})

afterAll(async () => {
  for (const c of clients) await c.end().catch(() => {})
  await migrator?.end()
})

describe('settings access defaults', () => {
  it('owner manages everything, admin manages everything by default', async () => {
    expect(await level(OWNER, 'members')).toBe('manage')
    expect(await level(ADMIN, 'general')).toBe('manage')
    expect(await level(ADMIN, 'storage')).toBe('manage')
  })

  it('steward manages instruments, integrations and storage only', async () => {
    expect(await level(STEWARD, 'instruments')).toBe('manage')
    expect(await level(STEWARD, 'integrations')).toBe('manage')
    expect(await level(STEWARD, 'storage')).toBe('manage')
    expect(await level(STEWARD, 'members')).toBe('none')
  })

  it('members and viewers reach nothing by default', async () => {
    expect(await level(MEMBER, 'general')).toBe('none')
    expect(await level(VIEWER, 'audit')).toBe('none')
  })

  it('resolves capabilities through the mapping', async () => {
    const steward = await actor(STEWARD)
    const { rows } = await steward.query(
      `SELECT api.has_capability($1::uuid, 'integrations.manage') AS integrations,
              api.has_capability($1::uuid, 'settings.storage.manage') AS storage,
              api.has_capability($1::uuid, 'settings.audit.view') AS audit`,
      [WS],
    )
    expect(rows[0]).toEqual({ integrations: true, storage: true, audit: false })
  })
})

describe('changing the mapping', () => {
  it('lets only the owner change it', async () => {
    const admin = await actor(ADMIN)
    await expect(
      admin.query('SELECT api.set_settings_access($1::uuid,$2,$3,$4)', [
        WS,
        'audit',
        'member',
        'view',
      ]),
    ).rejects.toThrow(/owner access required/)
  })

  it('takes effect on the server, per area and role', async () => {
    const owner = await actor(OWNER)
    await owner.query('SELECT api.set_settings_access($1::uuid,$2,$3,$4)', [
      WS,
      'audit',
      'member',
      'view',
    ])
    await owner.query('SELECT api.set_settings_access($1::uuid,$2,$3,$4)', [
      WS,
      'integrations',
      'steward',
      'none',
    ])
    expect(await level(MEMBER, 'audit')).toBe('view')
    expect(await level(STEWARD, 'integrations')).toBe('none')
    const steward = await actor(STEWARD)
    const { rows } = await steward.query(
      `SELECT api.has_capability($1::uuid, 'integrations.manage') AS ok`,
      [WS],
    )
    expect(rows[0].ok).toBe(false)
  })

  it('gates settings RPCs on their own area', async () => {
    const member = await actor(MEMBER)
    await expect(
      member.query('SELECT api.update_workspace_name($1::uuid, $2)', [
        WS,
        'Renamed',
      ]),
    ).rejects.toThrow()
    const owner = await actor(OWNER)
    await owner.query('SELECT api.set_settings_access($1::uuid,$2,$3,$4)', [
      WS,
      'general',
      'steward',
      'manage',
    ])
    const steward = await actor(STEWARD)
    await steward.query('SELECT api.update_workspace_name($1::uuid, $2)', [
      WS,
      'Renamed by a steward',
    ])
  })

  it('keeps owner changes with a workspace admin', async () => {
    const admin = await actor(ADMIN)
    await expect(
      admin.query('SELECT api.change_member_role($1::uuid,$2,$3)', [
        WS,
        MEMBER,
        'owner',
      ]),
    ).rejects.toThrow(/only a workspace admin can change an owner/)
  })
})
