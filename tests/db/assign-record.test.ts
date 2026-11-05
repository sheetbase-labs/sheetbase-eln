/**
 * assign_record: any record can name one person it is assigned to.
 *
 * Proves, against a freshly migrated sheetbase_test database:
 *  - an editor assigns a record to a workspace member, and clears it again;
 *  - each change bumps the metadata version, and a stale version is refused;
 *  - someone who is not a workspace member cannot be assigned;
 *  - a viewer cannot assign.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { grantProjectAccess, prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-0000000730aa'
const PROJ = '00000000-0000-4000-8000-0000000731aa'
const OWNER = 'assign730-owner'
const MEMBER = 'assign730-member'
const VIEWER = 'assign730-viewer'
const STRANGER = 'assign730-stranger'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function asAuthenticated(userId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query("SELECT set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: userId, workspace_id: WS, role: 'authenticated' }),
  ])
  return client
}

async function createExperiment(client: Client): Promise<Record<string, any>> {
  const { rows } = await client.query(
    `SELECT * FROM api.create_record($1::uuid, 'experiment', 'Assign me', 'draft', ARRAY[]::text[], '{}'::jsonb)`,
    [PROJ],
  )
  return rows[0]
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
      ('${OWNER}', 'Owner', 'assign730-owner@sheetbase.test', true),
      ('${MEMBER}', 'Member', 'assign730-member@sheetbase.test', true),
      ('${VIEWER}', 'Viewer', 'assign730-viewer@sheetbase.test', true),
      ('${STRANGER}', 'Stranger', 'assign730-stranger@sheetbase.test', true);
     INSERT INTO api.workspaces (id, slug, name) VALUES ('${WS}', 'assign730', 'Assign 730');
     INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS}', '${OWNER}', 'owner'),
      ('${WS}', '${MEMBER}', 'member'),
      ('${WS}', '${VIEWER}', 'viewer');
     INSERT INTO api.projects (id, workspace_id, key, title, lead_user_id) VALUES
      ('${PROJ}', '${WS}', 'assign730', 'Assign 730', '${OWNER}')`,
  )
  await grantProjectAccess(migrator, {
    workspaceId: WS,
    projectId: PROJ,
    userId: VIEWER,
    canView: true,
    canEdit: false,
  })
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

describe('assign_record', () => {
  it('assigns a record to a member and clears it again', async () => {
    const owner = await asAuthenticated(OWNER)
    const record = await createExperiment(owner)
    expect(record.assignee_user_id).toBeNull()

    const assigned = (
      await owner.query(
        `SELECT * FROM api.assign_record($1::uuid, $2::int, $3)`,
        [record.id, record.metadata_version, MEMBER],
      )
    ).rows[0]
    expect(assigned.assignee_user_id).toBe(MEMBER)
    expect(assigned.metadata_version).toBe(record.metadata_version + 1)

    const cleared = (
      await owner.query(
        `SELECT * FROM api.assign_record($1::uuid, $2::int, NULL)`,
        [record.id, assigned.metadata_version],
      )
    ).rows[0]
    expect(cleared.assignee_user_id).toBeNull()
  })

  it('refuses a stale version', async () => {
    const owner = await asAuthenticated(OWNER)
    const record = await createExperiment(owner)
    await expect(
      owner.query(`SELECT * FROM api.assign_record($1::uuid, $2::int, $3)`, [
        record.id,
        record.metadata_version + 5,
        MEMBER,
      ]),
    ).rejects.toMatchObject({ code: 'SB001' })
  })

  it('refuses someone who is not in the workspace', async () => {
    const owner = await asAuthenticated(OWNER)
    const record = await createExperiment(owner)
    await expect(
      owner.query(`SELECT * FROM api.assign_record($1::uuid, $2::int, $3)`, [
        record.id,
        record.metadata_version,
        STRANGER,
      ]),
    ).rejects.toMatchObject({ code: '22023' })
  })

  it('refuses a viewer', async () => {
    const owner = await asAuthenticated(OWNER)
    const record = await createExperiment(owner)
    const viewer = await asAuthenticated(VIEWER)
    await expect(
      viewer.query(`SELECT * FROM api.assign_record($1::uuid, $2::int, $3)`, [
        record.id,
        record.metadata_version,
        MEMBER,
      ]),
    ).rejects.toBeTruthy()
  })
})
