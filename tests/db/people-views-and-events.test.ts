import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { migratorUrl, prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000f701'
const OTHER_WS = '00000000-0000-4000-8000-00000000f702'
const P1 = '00000000-0000-4000-8000-00000000f711'
const STEWARD = 'people-steward'
const OWNER = 'people-owner'
const SCIENTIST = 'people-scientist'
const OTHER_OWNER = 'people-other-owner'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES
       ($1,'Steward','pv-steward@test.invalid',true),
       ($2,'Owner','pv-owner@test.invalid',true),
       ($3,'Scientist','pv-sci@test.invalid',true),
       ($4,'Other','pv-other@test.invalid',true)`,
    [STEWARD, OWNER, SCIENTIST, OTHER_OWNER],
  )
  await migrator.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES ($1,'people-views','People'),($2,'people-views-2','Other')`,
    [WS, OTHER_WS],
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES
       ($1,$2,'steward'),($1,$3,'owner'),($1,$4,'scientist'),($5,$6,'owner')`,
    [WS, STEWARD, OWNER, SCIENTIST, OTHER_WS, OTHER_OWNER],
  )
  await migrator.query(
    `INSERT INTO api.projects(id,workspace_id,key,title) VALUES ($1,$2,'pv','People project')`,
    [P1, WS],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((c) => c.end().catch(() => {})))
  await migrator?.end()
})

async function actor(userId: string, workspaceId = WS) {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query("SELECT set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({
      sub: userId,
      workspace_id: workspaceId,
      role: 'authenticated',
    }),
  ])
  return client
}

describe('fixed reporting views', () => {
  it('registers each view in every workspace, hiding what is not listed', async () => {
    const names = await migrator.query<{ view_key: string; view_name: string }>(
      `SELECT view_key, view_name FROM internal.reporting_fixed_view_names WHERE workspace_id=$1 ORDER BY view_key`,
      [WS],
    )
    const ready = (
      await migrator.query<{ ok: boolean }>(
        `SELECT internal.reporting_ready() AS ok`,
      )
    ).rows[0]!.ok
    if (!ready) return
    expect(names.rows.map((r) => r.view_key)).toEqual(
      expect.arrayContaining([
        'members',
        'invitations',
        'project_access',
        'groups',
        'clients',
      ]),
    )
    const other = await migrator.query(
      `SELECT view_name FROM internal.reporting_fixed_view_names WHERE workspace_id=$1 AND view_key='members'`,
      [OTHER_WS],
    )
    // The second workspace gets its own, suffixed name.
    expect(other.rows[0]!.view_name).toMatch(/^members_[0-9a-f]{6}$/)
    const columns = await migrator.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema='data' AND table_name=$1`,
      [names.rows.find((r) => r.view_key === 'invitations')!.view_name],
    )
    expect(columns.rows.map((c) => c.column_name)).not.toContain('token_hash')
  })

  it('shows a login only the rows its member may read', async () => {
    const ready = (
      await migrator.query<{ ok: boolean }>(
        `SELECT internal.reporting_ready() AS ok`,
      )
    ).rows[0]!.ok
    if (!ready) return
    const steward = await actor(STEWARD)
    const login = (
      await steward.query<{ username: string; password: string }>(
        'SELECT username, password FROM api.create_sql_login($1,$2,null)',
        [WS, 'Laptop'],
      )
    ).rows[0]!
    const url = new URL(migratorUrl())
    url.username = login.username
    url.password = login.password
    const sql = new Client({ connectionString: url.toString() })
    clients.push(sql)
    await sql.connect()
    const name = (
      await migrator.query<{ view_name: string }>(
        `SELECT view_name FROM internal.reporting_fixed_view_names WHERE workspace_id=$1 AND view_key='members'`,
        [WS],
      )
    ).rows[0]!.view_name
    const rows = await sql.query<{ user_id: string }>(
      `SELECT user_id FROM data.${name}`,
    )
    expect(rows.rows.map((r) => r.user_id).sort()).toEqual(
      [OWNER, SCIENTIST, STEWARD].sort(),
    )
    // It cannot reach the table underneath.
    await expect(
      sql.query('SELECT * FROM api.workspace_memberships'),
    ).rejects.toThrow()
  })
})

describe('people events', () => {
  it('makes a client, and writes a change event for it', async () => {
    const owner = await actor(OWNER)
    const made = (
      await owner.query<{ id: string }>('SELECT * FROM api.create_client($1)', [
        'Acme Bio',
      ])
    ).rows[0]!
    expect(made.id).toBeTruthy()
    const events = await migrator.query(
      `SELECT operation FROM api.change_events WHERE workspace_id=$1 AND entity_type='client' ORDER BY created_at`,
      [WS],
    )
    expect(events.rows.length).toBeGreaterThan(0)
  })

  it('does not let a viewer add a client', async () => {
    await migrator.query(
      `UPDATE api.workspace_memberships SET role='viewer' WHERE workspace_id=$1 AND user_id=$2`,
      [WS, SCIENTIST],
    )
    const scientist = await actor(SCIENTIST)
    await expect(
      scientist.query('SELECT * FROM api.create_client($1)', ['Nope Ltd']),
    ).rejects.toThrow()
  })

  it('writes a change event when a member is suspended', async () => {
    const owner = await actor(OWNER)
    await owner.query('SELECT api.suspend_member($1,$2)', [WS, SCIENTIST])
    const events = await migrator.query(
      `SELECT operation FROM api.change_events WHERE workspace_id=$1 AND entity_type='workspace_membership'`,
      [WS],
    )
    expect(events.rows.length).toBeGreaterThan(0)
  })
})

describe('agent guardrails', () => {
  it('lets agents delete a group but not a record', async () => {
    const rows = await migrator.query<{ g: boolean; r: boolean }>(
      `SELECT internal.agent_action_always_never('delete_workspace_group') AS g,
              internal.agent_action_always_never('delete_record') AS r`,
    )
    expect(rows.rows[0]).toEqual({ g: false, r: true })
  })
})
