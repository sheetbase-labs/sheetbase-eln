/**
 * ADR-0049 — client users. A client viewer is a member for identity but never
 * for reads: the internal read surface (records, blocks, projects) denies them,
 * and the portal RPCs return only approved records explicitly shared to the
 * caller's client.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000230a'
const OTHER_WS = '00000000-0000-4000-8000-00000000230b'
const CLIENT_A = '00000000-0000-4000-8000-00000000230c'
const CLIENT_B = '00000000-0000-4000-8000-00000000230d'
const PROJECT_A = '00000000-0000-4000-8000-00000000230e'
const PROJECT_B = '00000000-0000-4000-8000-00000000230f'
const REC_APPROVED = '00000000-0000-4000-8000-000000002310'
const REC_DRAFT = '00000000-0000-4000-8000-000000002311'
const REC_B = '00000000-0000-4000-8000-000000002312'
const ADMIN = 'cp-admin'
const VIEWER_A = 'cp-viewer-a'
const VIEWER_B = 'cp-viewer-b'
const OUTSIDER = 'cp-outsider'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Array<Client> = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal."user" (id, name, email, "emailVerified") VALUES
      ('${ADMIN}', 'Ada Admin', 'cp-admin@sheetbase.test', true),
      ('${VIEWER_A}', 'Cleo Client', 'cp-viewer-a@sheetbase.test', true),
      ('${VIEWER_B}', 'Ben Buyer', 'cp-viewer-b@sheetbase.test', true),
      ('${OUTSIDER}', 'Olive Outsider', 'cp-outsider@sheetbase.test', true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES
      ('${WS}', 'cp', 'Client portal workspace'),
      ('${OTHER_WS}', 'cp-other', 'Other workspace')`,
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
      ('${WS}', '${VIEWER_B}', 'client_viewer', '${CLIENT_B}'),
      ('${OTHER_WS}', '${OUTSIDER}', 'member', NULL)`,
  )
  await migrator.query(
    `INSERT INTO api.projects (id, workspace_id, key, title, client_id, lead_user_id) VALUES
      ('${PROJECT_A}', '${WS}', 'acme-aav9', 'Acme AAV9 transfer', '${CLIENT_A}', '${ADMIN}'),
      ('${PROJECT_B}', '${WS}', 'beta-mab', 'Beta mAb process', '${CLIENT_B}', '${ADMIN}')`,
  )
  await migrator.query(
    `INSERT INTO api.records
       (id, workspace_id, project_id, kind, identifier, title, status, created_by_user_id)
     VALUES
       ('${REC_APPROVED}', '${WS}', '${PROJECT_A}', 'experiment', 'EXP-A1', 'Acme approved run', 'approved', '${ADMIN}'),
       ('${REC_DRAFT}', '${WS}', '${PROJECT_A}', 'experiment', 'EXP-A2', 'Acme draft run', 'draft', '${ADMIN}'),
       ('${REC_B}', '${WS}', '${PROJECT_B}', 'experiment', 'EXP-B1', 'Beta approved run', 'approved', '${ADMIN}')`,
  )
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

describe('client portal', () => {
  it('shares only approved records, and only internal writers may share', async () => {
    const admin = await asAuthenticated(ADMIN, WS)
    await admin.query(`SELECT api.share_record_with_client($1, $2)`, [
      CLIENT_A,
      REC_APPROVED,
    ])
    await admin.query(`SELECT api.share_record_with_client($1, $2)`, [
      CLIENT_B,
      REC_B,
    ])

    // A draft cannot be shared.
    await expect(
      admin.query(`SELECT api.share_record_with_client($1, $2)`, [
        CLIENT_A,
        REC_DRAFT,
      ]),
    ).rejects.toMatchObject({ code: '22023' })

    // A client cannot share; an outsider cannot share.
    const viewerA = await asAuthenticated(VIEWER_A, WS)
    await expectDenied(
      viewerA.query(`SELECT api.share_record_with_client($1, $2)`, [
        CLIENT_A,
        REC_APPROVED,
      ]),
      '42501',
    )
    const outsider = await asAuthenticated(OUTSIDER, OTHER_WS)
    await expectDenied(
      outsider.query(`SELECT api.share_record_with_client($1, $2)`, [
        CLIENT_A,
        REC_APPROVED,
      ]),
      '42501',
    )
  })

  it('shows a client only their own shared approved records', async () => {
    const viewerA = await asAuthenticated(VIEWER_A, WS)
    const projects = await viewerA.query<{ display_id: string }>(
      `SELECT * FROM api.client_portal_projects()`,
    )
    expect(projects.rows.map((r) => r.display_id ?? r.title)).toHaveLength(1)

    const records = await viewerA.query<{ identifier: string }>(
      `SELECT * FROM api.client_portal_records()`,
    )
    expect(records.rows.map((r) => r.identifier)).toEqual(['EXP-A1'])

    // The other client sees only their own.
    const viewerB = await asAuthenticated(VIEWER_B, WS)
    const recordsB = await viewerB.query<{ identifier: string }>(
      `SELECT * FROM api.client_portal_records()`,
    )
    expect(recordsB.rows.map((r) => r.identifier)).toEqual(['EXP-B1'])
  })

  it('denies a client the internal read surface', async () => {
    const viewerA = await asAuthenticated(VIEWER_A, WS)
    const records = await viewerA.query(`SELECT id FROM api.records`)
    expect(records.rows).toEqual([])
    const blocks = await viewerA.query(`SELECT id FROM api.blocks`)
    expect(blocks.rows).toEqual([])
    const projects = await viewerA.query(`SELECT id FROM api.projects`)
    expect(projects.rows).toEqual([])
    const shares = await viewerA.query(`SELECT id FROM api.client_portal_shares`)
    expect(shares.rows).toEqual([])

    // An internal member is unaffected.
    const admin = await asAuthenticated(ADMIN, WS)
    const adminRecords = await admin.query<{ identifier: string }>(
      `SELECT identifier FROM api.records ORDER BY identifier`,
    )
    expect(adminRecords.rows.map((r) => r.identifier)).toEqual([
      'EXP-A1',
      'EXP-A2',
      'EXP-B1',
    ])
  })

  it('keeps workspaces and clients isolated', async () => {
    const outsider = await asAuthenticated(OUTSIDER, OTHER_WS)
    const projects = await outsider.query(`SELECT * FROM api.client_portal_projects()`)
    expect(projects.rows).toEqual([])
    const records = await outsider.query(`SELECT * FROM api.client_portal_records()`)
    expect(records.rows).toEqual([])
  })
})
