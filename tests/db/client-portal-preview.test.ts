/**
 * Preview as the client: an internal writer sees the approved records and
 * projects a client's portal would list, using the same rules as the portal
 * readers. Clients and people outside the workspace are denied.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000510a'
const OTHER_WS = '00000000-0000-4000-8000-00000000510b'
const CLIENT_A = '00000000-0000-4000-8000-00000000510c'
const CLIENT_B = '00000000-0000-4000-8000-00000000510d'
const PROJECT_A = '00000000-0000-4000-8000-00000000510e'
const PROJECT_A_AUTO = '00000000-0000-4000-8000-00000000510f'
const PROJECT_B = '00000000-0000-4000-8000-000000005110'
const REC_SHARED = '00000000-0000-4000-8000-000000005111'
const REC_UNSHARED = '00000000-0000-4000-8000-000000005112'
const REC_DRAFT = '00000000-0000-4000-8000-000000005113'
const REC_AUTO = '00000000-0000-4000-8000-000000005114'
const REC_B = '00000000-0000-4000-8000-000000005115'
const ADMIN = 'cpp-admin'
const VIEWER_A = 'cpp-viewer-a'
const OUTSIDER = 'cpp-outsider'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Array<Client> = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal."user" (id, name, email, "emailVerified") VALUES
      ('${ADMIN}', 'Ada Admin', 'cpp-admin@sheetbase.test', true),
      ('${VIEWER_A}', 'Cleo Client', 'cpp-viewer-a@sheetbase.test', true),
      ('${OUTSIDER}', 'Olive Outsider', 'cpp-outsider@sheetbase.test', true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES
      ('${WS}', 'cpp', 'Preview workspace'),
      ('${OTHER_WS}', 'cpp-other', 'Other workspace')`,
  )
  await migrator.query(
    `INSERT INTO api.clients (id, workspace_id, code, name) VALUES
      ('${CLIENT_A}', '${WS}', 'CL-001', 'Acme Biologics'),
      ('${CLIENT_B}', '${WS}', 'CL-002', 'Beta Pharma')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id, user_id, role, client_id) VALUES
      ('${WS}', '${ADMIN}', 'owner', NULL),
      ('${WS}', '${VIEWER_A}', 'client_viewer', '${CLIENT_A}'),
      ('${OTHER_WS}', '${OUTSIDER}', 'member', NULL)`,
  )
  await migrator.query(
    `INSERT INTO api.projects (id, workspace_id, key, title, client_id, lead_user_id, auto_share_to_client) VALUES
      ('${PROJECT_A}', '${WS}', 'acme-aav9', 'Acme AAV9 transfer', '${CLIENT_A}', '${ADMIN}', false),
      ('${PROJECT_A_AUTO}', '${WS}', 'acme-auto', 'Acme open book', '${CLIENT_A}', '${ADMIN}', true),
      ('${PROJECT_B}', '${WS}', 'beta-mab', 'Beta mAb process', '${CLIENT_B}', '${ADMIN}', true)`,
  )
  await migrator.query(
    `INSERT INTO api.records
       (id, workspace_id, project_id, kind, identifier, title, status, created_by_user_id)
     VALUES
       ('${REC_SHARED}', '${WS}', '${PROJECT_A}', 'experiment', 'EXP-P1', 'Shared run', 'approved', '${ADMIN}'),
       ('${REC_UNSHARED}', '${WS}', '${PROJECT_A}', 'experiment', 'EXP-P2', 'Approved but not shared', 'approved', '${ADMIN}'),
       ('${REC_DRAFT}', '${WS}', '${PROJECT_A_AUTO}', 'experiment', 'EXP-P3', 'Draft in an open project', 'draft', '${ADMIN}'),
       ('${REC_AUTO}', '${WS}', '${PROJECT_A_AUTO}', 'experiment', 'EXP-P4', 'Approved in an open project', 'approved', '${ADMIN}'),
       ('${REC_B}', '${WS}', '${PROJECT_B}', 'experiment', 'EXP-P5', 'Another client', 'approved', '${ADMIN}')`,
  )
  const admin = await asAuthenticated(ADMIN, WS)
  await admin.query(`SELECT api.share_record_with_client($1, $2)`, [
    CLIENT_A,
    REC_SHARED,
  ])
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

async function asAuthenticated(
  userId: string,
  workspaceId: string,
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

describe('client portal preview', () => {
  it('lists the shared and automatically shared approved records of the client only', async () => {
    const admin = await asAuthenticated(ADMIN, WS)
    const rows = await admin.query<{ identifier: string }>(
      `SELECT identifier FROM api.client_portal_preview_records($1) ORDER BY identifier`,
      [CLIENT_A],
    )
    expect(rows.rows.map((r) => r.identifier)).toEqual(['EXP-P1', 'EXP-P4'])

    const other = await admin.query<{ identifier: string }>(
      `SELECT identifier FROM api.client_portal_preview_records($1)`,
      [CLIENT_B],
    )
    expect(other.rows.map((r) => r.identifier)).toEqual(['EXP-P5'])
  })

  it('lists only the automatically shared projects of the client', async () => {
    const admin = await asAuthenticated(ADMIN, WS)
    const rows = await admin.query<{ title: string; client_code: string }>(
      `SELECT title, client_code FROM api.client_portal_preview_projects($1)`,
      [CLIENT_A],
    )
    expect(rows.rows).toEqual([
      { title: 'Acme open book', client_code: 'CL-001' },
    ])
  })

  it('is denied to client users and to people outside the workspace', async () => {
    const viewer = await asAuthenticated(VIEWER_A, WS)
    await expectDenied(
      viewer.query(`SELECT * FROM api.client_portal_preview_records($1)`, [
        CLIENT_A,
      ]),
      '42501',
    )
    await expectDenied(
      viewer.query(`SELECT * FROM api.client_portal_preview_projects($1)`, [
        CLIENT_A,
      ]),
      '42501',
    )
    const outsider = await asAuthenticated(OUTSIDER, OTHER_WS)
    await expectDenied(
      outsider.query(`SELECT * FROM api.client_portal_preview_records($1)`, [
        CLIENT_A,
      ]),
      '42501',
    )
  })
})
