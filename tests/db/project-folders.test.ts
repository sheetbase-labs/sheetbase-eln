/**
 * UI port — project folders: create and move, gated to project editors.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  expectDenied,
  prepareTestDatabase,
  grantProjectAccess,
} from './helpers'

const WS = '00000000-0000-4000-8000-00000000220a'
const OTHER_WS = '00000000-0000-4000-8000-00000000220b'
const PROJECT = '00000000-0000-4000-8000-00000000220c'
const OTHER_PROJECT = '00000000-0000-4000-8000-00000000220d'
const RECORD = '00000000-0000-4000-8000-00000000220e'
const LEAD = 'pf-lead'
const EDITOR = 'pf-editor'
const VIEWER = 'pf-viewer'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Array<Client> = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal."user" (id, name, email, "emailVerified") VALUES
      ('${LEAD}', 'P Folders Lead', 'pf-lead@sheetbase.test', true),
      ('${EDITOR}', 'E Editor', 'pf-editor@sheetbase.test', true),
      ('${VIEWER}', 'V Viewer', 'pf-viewer@sheetbase.test', true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES
      ('${WS}', 'pf', 'PF'), ('${OTHER_WS}', 'pf-other', 'PF other')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS}', '${LEAD}', 'scientist'),
      ('${WS}', '${EDITOR}', 'member'),
      ('${WS}', '${VIEWER}', 'member')`,
  )
  await migrator.query(
    `INSERT INTO api.projects (id, workspace_id, key, title, lead_user_id) VALUES
      ('${PROJECT}', '${WS}', 'pf', 'Folders project', '${LEAD}'),
      ('${OTHER_PROJECT}', '${OTHER_WS}', 'pfx', 'Other project', NULL)`,
  )
  // Explicit flag-based rules (SET-02 / ADR-0050); a bare access_level is no
  // longer authority.
  await grantProjectAccess(migrator, {
    workspaceId: WS,
    projectId: PROJECT,
    userId: EDITOR,
    canView: true,
    canEdit: true,
  })
  await grantProjectAccess(migrator, {
    workspaceId: WS,
    projectId: PROJECT,
    userId: VIEWER,
    canView: true,
    canEdit: false,
  })
  await migrator.query(
    `INSERT INTO api.records (id, workspace_id, project_id, kind, identifier, title, status, created_by_user_id) VALUES
      ('${RECORD}', '${WS}', '${PROJECT}', 'experiment', 'EXP-F1', 'Movable record', 'in_progress', '${LEAD}')`,
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

async function asAuthenticated(
  userId: string,
  workspaceId = WS,
): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query("SELECT set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({
      sub: userId,
      workspace_id: workspaceId,
      role: 'authenticated',
    }),
  ])
  return client
}

describe('project folders', () => {
  it('lets a project editor create a folder and move a record into it', async () => {
    const editor = await asAuthenticated(EDITOR)
    const { rows } = await editor.query<{ id: string; identifier: string }>(
      `SELECT * FROM api.create_project_folder($1, 'Clarification')`,
      [PROJECT],
    )
    expect(rows[0]?.identifier).toMatch(/^FOL-\d{4}$/)
    const moved = await editor.query<{ n: number }>(
      `SELECT api.move_records_to_folder($1, ARRAY[$2]::uuid[], $3) AS n`,
      [PROJECT, RECORD, rows[0]!.id],
    )
    expect(moved.rows[0]?.n).toBe(1)
    const check = await editor.query<{ folder_id: string }>(
      `SELECT folder_id FROM api.records WHERE id = $1`,
      [RECORD],
    )
    expect(check.rows[0]?.folder_id).toBe(rows[0]!.id)
  })

  it('denies a viewer and an invalid name', async () => {
    const viewer = await asAuthenticated(VIEWER)
    await expectDenied(
      viewer.query(`SELECT * FROM api.create_project_folder($1, 'Nope')`, [
        PROJECT,
      ]),
      '42501',
    )
    const lead = await asAuthenticated(LEAD)
    await expect(
      lead.query(`SELECT * FROM api.create_project_folder($1, '   ')`, [
        PROJECT,
      ]),
    ).rejects.toMatchObject({ code: '22023' })
  })

  it('rejects a parent folder from another project', async () => {
    const lead = await asAuthenticated(LEAD)
    const { rows } = await lead.query<{ id: string }>(
      `SELECT * FROM api.create_project_folder($1, 'Parent')`,
      [PROJECT],
    )
    const other = lead.query(
      `SELECT * FROM api.create_project_folder($1, 'Wrong', $2)`,
      [OTHER_PROJECT, rows[0]!.id],
    )
    await expect(other).rejects.toMatchObject({ code: '42501' })
  })
})
