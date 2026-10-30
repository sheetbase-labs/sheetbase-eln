/**
 * The set-based project access (internal.viewable_project_ids) must give every
 * caller exactly the projects internal.can_view_project gives them one by one.
 * Row-level security reads the set; the function stays for single lookups.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-0000000049a0'
const OTHER_WS = '00000000-0000-4000-8000-0000000049a9'
const GROUP = '00000000-0000-4000-8000-0000000049b0'
const CLIENT = '00000000-0000-4000-8000-0000000049c0'
const P_DIRECT = '00000000-0000-4000-8000-0000000049a1'
const P_GROUP = '00000000-0000-4000-8000-0000000049a2'
const P_NONE = '00000000-0000-4000-8000-0000000049a3'
const P_EDIT_ONLY = '00000000-0000-4000-8000-0000000049a4'
const P_FOREIGN = '00000000-0000-4000-8000-0000000049a5'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function as(
  role: 'authenticated' | 'api_client',
  userId: string,
  workspaceId = WS,
): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query(`SET ROLE ${role}`)
  await client.query("SELECT set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: userId, workspace_id: workspaceId, role }),
  ])
  return client
}

async function bothWays(client: Client): Promise<{
  set: string[]
  perRow: string[]
}> {
  const set = await client.query<{ id: string }>(
    `SELECT id FROM internal.viewable_project_ids() AS id ORDER BY 1`,
  )
  const perRow = await client.query<{ id: string }>(
    `SELECT p.id FROM api.projects p WHERE internal.can_view_project(p.id) ORDER BY 1`,
  )
  return {
    set: set.rows.map((r) => r.id),
    perRow: perRow.rows.map((r) => r.id),
  }
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(`
    INSERT INTO internal."user" (id, name, email, "emailVerified") VALUES
      ('pa-direct', 'Direct', 'pa-d@sheetbase.test', true),
      ('pa-grouped', 'Grouped', 'pa-g@sheetbase.test', true),
      ('pa-suspended', 'Suspended', 'pa-s@sheetbase.test', true),
      ('pa-client', 'Client', 'pa-c@sheetbase.test', true),
      ('pa-outsider', 'Outsider', 'pa-o@sheetbase.test', true),
      ('pa-editor', 'Editor', 'pa-e@sheetbase.test', true),
      ('pa-lead', 'Lead', 'pa-l@sheetbase.test', true);
    INSERT INTO api.workspaces (id, slug, name) VALUES
      ('${WS}', 'pa', 'PA'), ('${OTHER_WS}', 'pa-other', 'PA other');
    INSERT INTO api.clients (id, workspace_id, name) VALUES ('${CLIENT}', '${WS}', 'Client');
    INSERT INTO api.workspace_memberships (workspace_id, user_id, role, client_id, suspended_at) VALUES
      ('${WS}', 'pa-lead', 'owner', NULL, NULL),
      ('${WS}', 'pa-direct', 'member', NULL, NULL),
      ('${WS}', 'pa-grouped', 'member', NULL, NULL),
      ('${WS}', 'pa-suspended', 'member', NULL, now()),
      ('${WS}', 'pa-client', 'client_viewer', '${CLIENT}', NULL),
      ('${WS}', 'pa-editor', 'member', NULL, NULL);
    INSERT INTO api.projects (id, workspace_id, key, title, lead_user_id) VALUES
      ('${P_DIRECT}', '${WS}', 'pa-1', 'Direct', 'pa-lead'),
      ('${P_GROUP}', '${WS}', 'pa-2', 'Group', 'pa-lead'),
      ('${P_NONE}', '${WS}', 'pa-3', 'None', 'pa-lead'),
      ('${P_EDIT_ONLY}', '${WS}', 'pa-4', 'Edit only', 'pa-lead');
    INSERT INTO api.workspace_groups (id, workspace_id, name) VALUES ('${GROUP}', '${WS}', 'Group');
    INSERT INTO api.workspace_group_memberships (workspace_id, group_id, user_id)
      VALUES ('${WS}', '${GROUP}', 'pa-grouped');
  `)
  // Access is granted by rule rows; clear what project creation added so the
  // fixtures are exactly what this test says they are.
  await migrator.query(
    `DELETE FROM api.project_access WHERE workspace_id = '${WS}'`,
  )
  await migrator.query(`
    INSERT INTO api.project_access
      (workspace_id, project_id, user_id, group_id, granted_by_user_id, can_view, can_edit, can_review, can_manage, client_portal)
    VALUES
      ('${WS}', '${P_DIRECT}', 'pa-direct', NULL, 'pa-lead', true, false, false, false, false),
      ('${WS}', '${P_DIRECT}', 'pa-suspended', NULL, 'pa-lead', true, false, false, false, false),
      ('${WS}', '${P_DIRECT}', 'pa-client', NULL, 'pa-lead', true, false, false, false, true),
      ('${WS}', '${P_GROUP}', NULL, '${GROUP}', 'pa-lead', true, false, false, false, false),
      ('${WS}', '${P_EDIT_ONLY}', 'pa-editor', NULL, 'pa-lead', false, true, false, false, false)
  `)
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

describe('viewable_project_ids', () => {
  it.each([
    ['pa-direct', [P_DIRECT]],
    ['pa-grouped', [P_GROUP]],
    ['pa-editor', [P_EDIT_ONLY]],
    ['pa-suspended', []],
    ['pa-client', []],
    ['pa-outsider', []],
    ['pa-lead', []],
  ])(
    'gives %s the same projects the per-row check does',
    async (user, expected) => {
      const client = await as('authenticated', user)
      const { set, perRow } = await bothWays(client)
      expect(set).toEqual(perRow)
      expect(set).toEqual([...expected].sort())
    },
  )

  it('gives an API client every project of its own workspace and nothing else', async () => {
    await migrator
      .query(
        `INSERT INTO api.projects (id, workspace_id, key, title, lead_user_id)
       SELECT '${P_FOREIGN}', '${OTHER_WS}', 'pa-x', 'Foreign', 'pa-lead'`,
      )
      .catch(() => undefined)
    const client = await as('api_client', 'pa-direct')
    const { set, perRow } = await bothWays(client)
    expect(set).toEqual(perRow)
    expect(set).toEqual([P_DIRECT, P_GROUP, P_NONE, P_EDIT_ONLY].sort())
  })

  it('gives nothing to a caller in another workspace than the project', async () => {
    const client = await as('authenticated', 'pa-direct', OTHER_WS)
    const { set, perRow } = await bothWays(client)
    expect(set).toEqual(perRow)
    expect(set).toEqual([])
  })

  it('shows records of only those projects through the policies', async () => {
    await migrator.query(`
      INSERT INTO api.records (workspace_id, project_id, kind, identifier, title, status, created_by_user_id)
      VALUES ('${WS}', '${P_DIRECT}', 'sample', 'PA-S-1', 'Seen', 'available', 'pa-lead'),
             ('${WS}', '${P_NONE}', 'sample', 'PA-S-2', 'Hidden', 'available', 'pa-lead'),
             ('${WS}', NULL, 'sample', 'PA-S-3', 'No project', 'available', 'pa-lead')`)
    const client = await as('authenticated', 'pa-direct')
    const { rows } = await client.query<{ identifier: string }>(
      `SELECT identifier FROM api.records WHERE identifier LIKE 'PA-S-%' ORDER BY 1`,
    )
    expect(rows.map((r) => r.identifier)).toEqual(['PA-S-1', 'PA-S-3'])
    const projects = await client.query<{ id: string }>(
      `SELECT id FROM api.projects ORDER BY 1`,
    )
    expect(projects.rows.map((r) => r.id)).toEqual([P_DIRECT])
  })
})
