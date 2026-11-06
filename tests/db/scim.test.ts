/**
 * Directory sync (SCIM 2.0, migration 0105).
 *
 * Proves, against a freshly migrated database:
 *  - tokens: a members manager makes one (the secret is shown once and only a
 *    hash is kept), nobody else can, and a revoked token stops working;
 *  - provisioning creates an account and a viewer membership, links an existing
 *    member without changing their role, and refuses duplicates;
 *  - switching a person off suspends them, counts their open work into the
 *    change event, and switching them back on restores access;
 *  - owners and client accounts are never changed by the provider;
 *  - groups follow the sign-in group mappings (highest role wins, none means
 *    viewer), and removing a person from a group takes the role away;
 *  - every change reaches the change feed.
 */
import { createHash } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase, setActorJwt } from './helpers'

const WS = '00000000-0000-4000-8000-00000009d000'
const OWNER = 'scim-owner'
const LINKED = 'scim-linked'
const CLIENT = 'scim-client'
const MEMBER = 'scim-member'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []
let secret = ''
let tokenId = ''
let actor = ''

async function asAuthenticated(userId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await setActorJwt(client, userId, WS)
  return client
}

const sha = (value: string) =>
  createHash('sha256').update(value).digest('hex')

async function call<T = Record<string, unknown>>(
  sql: string,
  values: unknown[],
): Promise<T> {
  const { rows } = await migrator.query(sql, values)
  return rows[0].doc as T
}

const provision = (changes: Record<string, unknown>) =>
  call<{ id: string; active: boolean; role: string; email: string }>(
    `SELECT internal.scim_provision_user($1::uuid, $2, $3::jsonb) AS doc`,
    [WS, actor, JSON.stringify(changes)],
  )

const update = (id: string, changes: Record<string, unknown>) =>
  call<{ id: string; active: boolean; role: string }>(
    `SELECT internal.scim_update_user($1::uuid, $2, $3::uuid, $4::jsonb) AS doc`,
    [WS, actor, id, JSON.stringify(changes)],
  )

const setGroup = (id: string | null, changes: Record<string, unknown>) =>
  call<{ id: string; members: { value: string }[] }>(
    `SELECT internal.scim_set_group($1::uuid, $2, $3::uuid, $4::jsonb) AS doc`,
    [WS, actor, id, JSON.stringify(changes)],
  )

async function roleOf(email: string): Promise<string> {
  const { rows } = await migrator.query(
    `SELECT m.role FROM api.workspace_memberships m
       JOIN internal."user" u ON u.id = m.user_id
      WHERE m.workspace_id = $1 AND u.email = $2`,
    [WS, email],
  )
  return rows[0]?.role
}

async function events(type: string): Promise<{ operation: string; payload: any }[]> {
  const { rows } = await migrator.query(
    `SELECT operation, payload FROM api.change_events
      WHERE workspace_id = $1 AND entity_type = $2 ORDER BY sequence`,
    [WS, type],
  )
  return rows
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal."user" (id,name,email,"emailVerified") VALUES
      ('${OWNER}','Owner','scim-owner@lab.test',true),
      ('${LINKED}','Linked','scim-linked@lab.test',true),
      ('${CLIENT}','Client','scim-client@lab.test',true),
      ('${MEMBER}','Member','scim-member@lab.test',true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspaces (id,slug,name) VALUES ('${WS}','scim','Directory')`,
  )
  await migrator.query(
    `INSERT INTO api.clients (id, workspace_id, code, name)
     VALUES ('00000000-0000-4000-8000-00000009d0c1','${WS}','CL-010','Client ten')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id,user_id,role,role_source,client_id) VALUES
      ('${WS}','${OWNER}','owner','manual',NULL),
      ('${WS}','${LINKED}','scientist','manual',NULL),
      ('${WS}','${CLIENT}','client_viewer','manual','00000000-0000-4000-8000-00000009d0c1'),
      ('${WS}','${MEMBER}','scientist','manual',NULL)`,
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

describe('tokens', () => {
  it('lets a members manager make a token, shows the secret once and keeps a hash', async () => {
    const owner = await asAuthenticated(OWNER)
    const { rows } = await owner.query(
      `SELECT api.create_scim_token($1::uuid, 'Okta') AS made`,
      [WS],
    )
    const made = rows[0].made as { token: { id: string }; secret: string }
    secret = made.secret
    tokenId = made.token.id
    actor = OWNER
    expect(secret).toMatch(/^sbscim_[0-9a-f]{64}$/)

    const listed = await owner.query(`SELECT * FROM api.scim_tokens`)
    expect(listed.rows).toHaveLength(1)
    expect(JSON.stringify(listed.rows)).not.toContain(secret)
    const stored = await migrator.query(
      `SELECT secret_hash FROM internal.scim_token_secrets WHERE token_id = $1`,
      [tokenId],
    )
    expect(stored.rows[0].secret_hash).toBe(sha(secret))
    expect((await events('scim_token'))[0]).toMatchObject({ operation: 'create' })
  })

  it('refuses everyone without members access', async () => {
    const member = await asAuthenticated(MEMBER)
    await expectDenied(
      member.query(`SELECT api.create_scim_token($1::uuid, 'Nope')`, [WS]),
      'SB052',
    )
    const seen = await member.query(`SELECT * FROM api.scim_tokens`)
    expect(seen.rows).toHaveLength(0)
  })

  it('finds the workspace for a live token and stops at a revoked one', async () => {
    const found = await migrator.query(
      `SELECT * FROM internal.scim_authenticate($1)`,
      [sha(secret)],
    )
    expect(found.rows[0]).toMatchObject({
      token_id: tokenId,
      workspace_id: WS,
      actor_user_id: OWNER,
    })
    const none = await migrator.query(
      `SELECT * FROM internal.scim_authenticate($1)`,
      [sha('sbscim_wrong')],
    )
    expect(none.rows).toHaveLength(0)

    const second = await (await asAuthenticated(OWNER)).query(
      `SELECT api.create_scim_token($1::uuid, 'Entra') AS made`,
      [WS],
    )
    const spare = second.rows[0].made as {
      token: { id: string }
      secret: string
    }
    const owner = await asAuthenticated(OWNER)
    await owner.query(`SELECT api.revoke_scim_token($1::uuid)`, [spare.token.id])
    const revoked = await migrator.query(
      `SELECT * FROM internal.scim_authenticate($1)`,
      [sha(spare.secret)],
    )
    expect(revoked.rows).toHaveLength(0)
    expect((await events('scim_token')).map((e) => e.operation)).toEqual([
      'create',
      'create',
      'revoke',
    ])
  })
})

describe('users', () => {
  it('creates an account and a viewer membership for a new person', async () => {
    const doc = await provision({
      userName: 'New.Person@lab.test',
      externalId: 'ext-1',
      displayName: 'New Person',
    })
    expect(doc).toMatchObject({
      active: true,
      role: 'viewer',
      email: 'new.person@lab.test',
    })
    const row = await migrator.query(
      `SELECT u."emailVerified", m.role_source FROM internal."user" u
         JOIN api.workspace_memberships m ON m.user_id = u.id
        WHERE u.email = 'new.person@lab.test'`,
    )
    expect(row.rows[0]).toEqual({ emailVerified: true, role_source: 'idp' })
    expect((await events('scim_user'))[0]).toMatchObject({
      operation: 'create',
      payload: { via: 'scim', action: 'scim-user-provisioned', created: true },
    })
  })

  it('refuses a duplicate userName or externalId', async () => {
    await expect(
      provision({ userName: 'new.person@lab.test' }),
    ).rejects.toMatchObject({ code: '23505' })
    await expect(
      provision({ userName: 'someone.else@lab.test', externalId: 'ext-1' }),
    ).rejects.toMatchObject({ code: '23505' })
  })

  it('refuses a userName that is not an email address', async () => {
    await expect(provision({ userName: 'no-at-sign' })).rejects.toMatchObject({
      code: '22023',
    })
  })

  it('links a person who is already a member without changing their role', async () => {
    const doc = await provision({ userName: 'scim-linked@lab.test' })
    expect(doc.role).toBe('scientist')
    expect(await roleOf('scim-linked@lab.test')).toBe('scientist')
  })

  it('never lets the provider change an owner or a client account', async () => {
    const { rows } = await migrator.query(
      `SELECT m.id, u.email FROM api.workspace_memberships m
         JOIN internal."user" u ON u.id = m.user_id
        WHERE m.workspace_id = $1 AND m.user_id = $2`,
      [WS, OWNER],
    )
    await expect(update(rows[0].id, { active: false })).rejects.toMatchObject({
      code: 'SB052',
    })
    await expect(
      provision({ userName: 'scim-client@lab.test' }),
    ).rejects.toMatchObject({ code: 'SB052' })
    expect(await roleOf('scim-owner@lab.test')).toBe('owner')
  })

  it('switches a person off, counts their open work, and switches them back on', async () => {
    const created = await provision({ userName: 'leaver@lab.test' })
    const off = await update(created.id, { active: false })
    expect(off.active).toBe(false)
    const suspended = (await events('scim_user')).find(
      (e) => e.operation === 'suspend',
    )
    expect(suspended?.payload).toMatchObject({
      action: 'scim-user-deprovisioned',
      openWork: 0,
    })
    const on = await update(created.id, { active: true })
    expect(on.active).toBe(true)
  })

  it('forgets a deleted person but keeps the account, and re-provisions them', async () => {
    const created = await provision({ userName: 'gone@lab.test' })
    await migrator.query(
      `SELECT internal.scim_delete_user($1::uuid, $2, $3::uuid)`,
      [WS, actor, created.id],
    )
    const listed = await call<{ total: number }>(
      `SELECT internal.scim_list_users($1::uuid, 'gone@lab.test', NULL, 1, 10) AS doc`,
      [WS],
    )
    expect(listed.total).toBe(0)
    const kept = await migrator.query(
      `SELECT suspended_at FROM api.workspace_memberships WHERE id = $1`,
      [created.id],
    )
    expect(kept.rows[0].suspended_at).not.toBeNull()
    const back = await provision({ userName: 'gone@lab.test' })
    expect(back.id).toBe(created.id)
    expect(back.active).toBe(true)
  })

  it('lists and filters', async () => {
    const all = await call<{ total: number; rows: unknown[] }>(
      `SELECT internal.scim_list_users($1::uuid, NULL, NULL, 1, 100) AS doc`,
      [WS],
    )
    expect(all.total).toBeGreaterThanOrEqual(4)
    const one = await call<{ total: number; rows: { user_name: string }[] }>(
      `SELECT internal.scim_list_users($1::uuid, 'NEW.PERSON@lab.test', NULL, 1, 100) AS doc`,
      [WS],
    )
    expect(one.total).toBe(1)
    const byExternal = await call<{ total: number }>(
      `SELECT internal.scim_list_users($1::uuid, NULL, 'ext-1', 1, 100) AS doc`,
      [WS],
    )
    expect(byExternal.total).toBe(1)
    const page = await call<{ total: number; rows: unknown[] }>(
      `SELECT internal.scim_list_users($1::uuid, NULL, NULL, 2, 2) AS doc`,
      [WS],
    )
    expect(page.rows).toHaveLength(2)
    expect(page.total).toBe(all.total)
  })
})

describe('groups decide roles', () => {
  let adminsId = ''
  let scientistsId = ''
  let personId = ''

  it('does nothing to roles until the workspace maps a group', async () => {
    const person = await provision({ userName: 'grouped@lab.test' })
    personId = person.id
    const group = await setGroup(null, {
      displayName: 'Lab Admins',
      members: [personId],
    })
    adminsId = group.id
    expect(await roleOf('grouped@lab.test')).toBe('viewer')
  })

  it('follows the sign-in group mappings once they exist', async () => {
    const owner = await asAuthenticated(OWNER)
    await owner.query(
      `SELECT api.set_idp_group_mapping($1::uuid, 'lab admins', 'admin')`,
      [WS],
    )
    await owner.query(
      `SELECT api.set_idp_group_mapping($1::uuid, 'Scientists', 'scientist')`,
      [WS],
    )
    // Roles are recomputed when a group changes.
    await setGroup(adminsId, { members: [personId] })
    expect(await roleOf('grouped@lab.test')).toBe('admin')
    const changed = (await events('idp_group_mapping')).filter(
      (e) => e.payload.action === 'role-from-groups',
    )
    expect(changed.at(-1)?.payload).toMatchObject({ from: 'viewer', to: 'admin' })
  })

  it('lets the highest role among a person’s groups win', async () => {
    const group = await setGroup(null, {
      displayName: 'Scientists',
      members: [personId],
    })
    scientistsId = group.id
    expect(await roleOf('grouped@lab.test')).toBe('admin')
  })

  it('takes the role away when the person leaves the group', async () => {
    await setGroup(adminsId, { members: [] })
    expect(await roleOf('grouped@lab.test')).toBe('scientist')
    await migrator.query(
      `SELECT internal.scim_delete_group($1::uuid, $2, $3::uuid)`,
      [WS, actor, scientistsId],
    )
    expect(await roleOf('grouped@lab.test')).toBe('viewer')
  })

  it('refuses members who are not in the workspace and duplicate names', async () => {
    await expect(
      setGroup(adminsId, { members: ['00000000-0000-4000-8000-00000000ffff'] }),
    ).rejects.toMatchObject({ code: '22023' })
    await expect(
      setGroup(null, { displayName: 'LAB ADMINS' }),
    ).rejects.toMatchObject({ code: '23505' })
  })

  it('does not touch people whose role was set by hand', async () => {
    const linked = await migrator.query(
      `SELECT id FROM api.workspace_memberships WHERE workspace_id = $1 AND user_id = $2`,
      [WS, LINKED],
    )
    await setGroup(adminsId, { members: [linked.rows[0].id] })
    expect(await roleOf('scim-linked@lab.test')).toBe('scientist')
  })

  it('counts the provider’s groups when someone signs in with their own groups', async () => {
    await setGroup(adminsId, { members: [personId] })
    expect(await roleOf('grouped@lab.test')).toBe('admin')
    await migrator.query(
      `SELECT internal.apply_idp_groups($1, ARRAY['scientists'])`,
      [(await migrator.query(`SELECT user_id FROM api.workspace_memberships WHERE id = $1`, [personId])).rows[0].user_id],
    )
    expect(await roleOf('grouped@lab.test')).toBe('admin')
  })

  it('reaches the change feed', async () => {
    const created = (await events('scim_group')).map((e) => e.operation)
    expect(created).toContain('create')
    expect(created).toContain('update')
    expect(created).toContain('delete')
  })
})
