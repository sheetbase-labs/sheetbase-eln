/**
 * Roles from single sign-on groups (migration 0092).
 *
 * Proves, against a freshly migrated database:
 *  - a members manager maps groups to roles, and nobody else can;
 *  - a group cannot give owner or client access;
 *  - groups decide the role of people who joined by their email domain and of
 *    people an administrator handed over to groups, and never of anyone else;
 *  - the highest role among a person's groups wins, and someone in no mapped
 *    group becomes a viewer;
 *  - owners and client accounts are never changed;
 *  - a role set by hand pins it again.
 */
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase, setActorJwt } from './helpers'

const WS = '00000000-0000-4000-8000-00000009c000'
const OWNER = 'idp-owner'
const SSO = 'idp-sso'
const HAND = 'idp-hand'
const CLIENT = 'idp-client'
const MEMBER = 'idp-member'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function asAuthenticated(userId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await setActorJwt(client, userId, WS)
  return client
}

async function roleOf(user: string): Promise<{ role: string; source: string }> {
  const { rows } = await migrator.query(
    `SELECT role, role_source AS source FROM api.workspace_memberships
      WHERE workspace_id = $1 AND user_id = $2`,
    [WS, user],
  )
  return rows[0]
}

const apply = (user: string, groups: string[]) =>
  migrator.query(`SELECT internal.apply_idp_groups($1, $2::text[]) AS n`, [
    user,
    groups,
  ])

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal."user" (id,name,email,"emailVerified") VALUES
      ('${OWNER}','Owner','idp-owner@lab.test',true),
      ('${SSO}','Sso','idp-sso@lab.test',true),
      ('${HAND}','Hand','idp-hand@lab.test',true),
      ('${CLIENT}','Client','idp-client@lab.test',true),
      ('${MEMBER}','Member','idp-member@lab.test',true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspaces (id,slug,name) VALUES ('${WS}','idp','Groups')`,
  )
  await migrator.query(
    `INSERT INTO api.clients (id, workspace_id, code, name)
     VALUES ('00000000-0000-4000-8000-00000009c0c1','${WS}','CL-009','Client nine')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id,user_id,role,role_source,client_id) VALUES
      ('${WS}','${OWNER}','owner','idp',NULL),
      ('${WS}','${SSO}','scientist','idp',NULL),
      ('${WS}','${HAND}','reviewer','manual',NULL),
      ('${WS}','${CLIENT}','client_viewer','idp','00000000-0000-4000-8000-00000009c0c1'),
      ('${WS}','${MEMBER}','scientist','manual',NULL)`,
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

describe('mapping groups to roles', () => {
  it('lets a members manager map a group and refuses everyone else', async () => {
    const member = await asAuthenticated(MEMBER)
    await expectDenied(
      member.query(
        `SELECT * FROM api.set_idp_group_mapping($1::uuid, 'Lab Admins', 'admin')`,
        [WS],
      ),
      'SB052',
    )
    const owner = await asAuthenticated(OWNER)
    const { rows } = await owner.query(
      `SELECT * FROM api.set_idp_group_mapping($1::uuid, 'Lab Admins', 'admin')`,
      [WS],
    )
    expect(rows[0]).toMatchObject({ group_name: 'Lab Admins', role: 'admin' })
    await owner.query(
      `SELECT * FROM api.set_idp_group_mapping($1::uuid, 'Bench Scientists', 'scientist')`,
      [WS],
    )
    await owner.query(
      `SELECT * FROM api.set_idp_group_mapping($1::uuid, 'Visitors', 'viewer')`,
      [WS],
    )
  })

  it('treats a group name the same whatever its case, and updates its role', async () => {
    const owner = await asAuthenticated(OWNER)
    await owner.query(
      `SELECT * FROM api.set_idp_group_mapping($1::uuid, 'visitors', 'analyst')`,
      [WS],
    )
    const { rows } = await owner.query(
      `SELECT group_name, role FROM api.idp_group_mappings WHERE lower(group_name) = 'visitors'`,
    )
    expect(rows).toEqual([{ group_name: 'visitors', role: 'analyst' }])
    await owner.query(
      `SELECT * FROM api.set_idp_group_mapping($1::uuid, 'Visitors', 'viewer')`,
      [WS],
    )
  })

  it('cannot give owner or client access', async () => {
    const owner = await asAuthenticated(OWNER)
    for (const role of ['owner', 'client_viewer', 'nonsense']) {
      await expectDenied(
        owner.query(
          `SELECT * FROM api.set_idp_group_mapping($1::uuid, 'Anyone', $2)`,
          [WS, role],
        ),
        '22023',
      )
    }
  })

  it('is visible to those who see the members area and not to everyone', async () => {
    const owner = await asAuthenticated(OWNER)
    const seen = await owner.query(
      `SELECT count(*)::int AS n FROM api.idp_group_mappings`,
    )
    expect(seen.rows[0].n).toBe(3)
    const member = await asAuthenticated(MEMBER)
    const hidden = await member.query(
      `SELECT count(*)::int AS n FROM api.idp_group_mappings`,
    )
    expect(hidden.rows[0].n).toBe(0)
  })
})

describe('applying groups at sign-in', () => {
  it('sets the role from the highest mapped group, with the slash and case ignored', async () => {
    await apply(SSO, ['/bench scientists', 'LAB ADMINS', 'unmapped'])
    expect(await roleOf(SSO)).toEqual({ role: 'admin', source: 'idp' })
  })

  it('makes someone in no mapped group a viewer', async () => {
    await apply(SSO, ['something-else'])
    expect(await roleOf(SSO)).toEqual({ role: 'viewer', source: 'idp' })
    await apply(SSO, [])
    expect(await roleOf(SSO)).toEqual({ role: 'viewer', source: 'idp' })
  })

  it('leaves roles set by hand alone', async () => {
    await apply(HAND, ['Lab Admins'])
    expect(await roleOf(HAND)).toEqual({ role: 'reviewer', source: 'manual' })
  })

  it('never changes an owner or a client account', async () => {
    await apply(OWNER, [])
    await apply(CLIENT, ['Lab Admins'])
    expect((await roleOf(OWNER)).role).toBe('owner')
    expect((await roleOf(CLIENT)).role).toBe('client_viewer')
  })

  it('lets an administrator hand everyone else over to groups', async () => {
    const owner = await asAuthenticated(OWNER)
    const { rows } = await owner.query(
      `SELECT api.adopt_group_roles($1::uuid) AS n`,
      [WS],
    )
    expect(rows[0].n).toBe(2)
    await apply(HAND, ['Bench Scientists'])
    expect(await roleOf(HAND)).toEqual({ role: 'scientist', source: 'idp' })
  })

  it('pins a role again when an administrator sets it by hand', async () => {
    const owner = await asAuthenticated(OWNER)
    await owner.query(
      `SELECT * FROM api.change_member_role($1::uuid, $2, 'reviewer')`,
      [WS, HAND],
    )
    expect(await roleOf(HAND)).toEqual({ role: 'reviewer', source: 'manual' })
    await apply(HAND, ['Lab Admins'])
    expect(await roleOf(HAND)).toEqual({ role: 'reviewer', source: 'manual' })
  })

  it('records the change in the audit trail', async () => {
    const { rows } = await migrator.query(
      `SELECT payload FROM api.change_events
        WHERE workspace_id = $1 AND payload->>'action' = 'role-from-groups'
        ORDER BY created_at LIMIT 1`,
      [WS],
    )
    expect(rows[0].payload).toMatchObject({
      userId: SSO,
      from: 'scientist',
      to: 'admin',
    })
  })
})

describe('joining by email domain', () => {
  it('starts people who join by domain under groups', async () => {
    await migrator.query(
      `INSERT INTO api.workspace_join_domains (workspace_id, domain, role, created_by_user_id)
       VALUES ($1,'joined.test','scientist',$2)`,
      [WS, OWNER],
    )
    await migrator.query(
      `INSERT INTO internal."user" (id,name,email,"emailVerified")
       VALUES ('idp-joiner','Joiner','joiner@joined.test',true)`,
    )
    await migrator.query(
      `SELECT internal.join_workspace_by_email_domain('idp-joiner')`,
    )
    expect(await roleOf('idp-joiner')).toEqual({
      role: 'scientist',
      source: 'idp',
    })
  })
})
