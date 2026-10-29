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
const INVITEE = 'cp-invitee'

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
      ('${OUTSIDER}', 'Olive Outsider', 'cp-outsider@sheetbase.test', true),
      ('${INVITEE}', 'Ivy Invitee', 'cp-invitee@sheetbase.test', true)`,
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

  it('shares a record only with the client its project belongs to', async () => {
    const admin = await asAuthenticated(ADMIN, WS)
    // Acme's record cannot be put in Beta's portal: Beta could never see it.
    await expect(
      admin.query(`SELECT api.share_record_with_client($1, $2)`, [
        CLIENT_B,
        REC_APPROVED,
      ]),
    ).rejects.toMatchObject({ code: '22023' })
    const wrong = await admin.query(
      `SELECT 1 FROM api.client_portal_shares WHERE client_id = $1 AND record_id = $2`,
      [CLIENT_B, REC_APPROVED],
    )
    expect(wrong.rows).toHaveLength(0)
  })

  it('tells the record page which client it would go to and whether it is shared', async () => {
    const admin = await asAuthenticated(ADMIN, WS)
    const shared = await admin.query(
      `SELECT * FROM api.record_client_sharing($1)`,
      [REC_APPROVED],
    )
    expect(shared.rows[0]).toMatchObject({
      record_status: 'approved',
      client_id: CLIENT_A,
      client_code: 'CL-001',
      client_name: 'Acme Biologics',
      auto_share: false,
      shared_by_name: 'Ada Admin',
      can_manage: true,
    })
    expect(shared.rows[0].shared_at).not.toBeNull()

    const draft = await admin.query(
      `SELECT * FROM api.record_client_sharing($1)`,
      [REC_DRAFT],
    )
    expect(draft.rows[0]).toMatchObject({
      record_status: 'draft',
      client_id: CLIENT_A,
      shared_at: null,
    })
  })

  it('does not tell a client viewer about sharing', async () => {
    const viewerA = await asAuthenticated(VIEWER_A, WS)
    await expectDenied(
      viewerA.query(`SELECT * FROM api.record_client_sharing($1)`, [
        REC_APPROVED,
      ]),
      '42501',
    )
  })

  it('shows a client only their own shared approved records', async () => {
    const viewerA = await asAuthenticated(VIEWER_A, WS)
    // The portal is off by default, so no project is listed …
    const projectsOff = await viewerA.query<{ title: string }>(
      `SELECT * FROM api.client_portal_projects()`,
    )
    expect(projectsOff.rows).toEqual([])
    // … but an explicitly shared approved record is still visible.
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
    // A revision, a file and a dataset row exist for the workspace; the client
    // must see none of them, while the internal owner does.
    await migrator.query(
      `INSERT INTO api.revisions
         (id, record_id, structure_version, metadata_version, metadata_snapshot,
          block_snapshot, reason, created_by_user_id, workspace_id,
          canonical_snapshot, integrity_digest)
       VALUES
         ('00000000-0000-4000-8000-000000002320', '${REC_APPROVED}', 1, 1,
          '{}'::jsonb, '[]'::jsonb, 'sign', '${ADMIN}', '${WS}',
          '{"files":[]}'::jsonb, '${'a'.repeat(64)}')`,
    )
    await migrator.query(
      `INSERT INTO api.file_objects
         (id, workspace_id, record_id, storage_key, display_name, media_type, byte_size)
       VALUES
         ('00000000-0000-4000-8000-000000002321', '${WS}', '${REC_APPROVED}',
          '${WS}/${REC_APPROVED}/${'1'.repeat(32)}', 'portal-file.txt', 'text/plain', 12)`,
    )
    await migrator.query(
      `INSERT INTO api.dataset_schema_definitions (id, workspace_id, key, name, lifecycle)
       VALUES ('00000000-0000-4000-8000-000000002322', '${WS}', 'cp_portal', 'Portal schema', 'active')`,
    )
    await migrator.query(
      `INSERT INTO api.dataset_schema_versions (id, schema_id, version, lifecycle)
       VALUES ('00000000-0000-4000-8000-000000002323', '00000000-0000-4000-8000-000000002322', 1, 'active')`,
    )
    await migrator.query(
      `INSERT INTO api.datasets (id, workspace_id, schema_version_id, name, primary_project_id)
       VALUES ('00000000-0000-4000-8000-000000002324', '${WS}', '00000000-0000-4000-8000-000000002323', 'Portal dataset', '${PROJECT_A}')`,
    )
    await migrator.query(
      `INSERT INTO api.dataset_rows (id, dataset_id, workspace_id)
       VALUES ('00000000-0000-4000-8000-000000002325', '00000000-0000-4000-8000-000000002324', '${WS}')`,
    )

    const viewerA = await asAuthenticated(VIEWER_A, WS)
    const records = await viewerA.query(`SELECT id FROM api.records`)
    expect(records.rows).toEqual([])
    const blocks = await viewerA.query(`SELECT id FROM api.blocks`)
    expect(blocks.rows).toEqual([])
    const projects = await viewerA.query(`SELECT id FROM api.projects`)
    expect(projects.rows).toEqual([])
    const shares = await viewerA.query(
      `SELECT id FROM api.client_portal_shares`,
    )
    expect(shares.rows).toEqual([])
    const comments = await viewerA.query(`SELECT id FROM api.comments`)
    expect(comments.rows).toEqual([])
    const revisions = await viewerA.query(`SELECT id FROM api.revisions`)
    expect(revisions.rows).toEqual([])
    const files = await viewerA.query(`SELECT id FROM api.file_objects`)
    expect(files.rows).toEqual([])
    const datasetRows = await viewerA.query(`SELECT id FROM api.dataset_rows`)
    expect(datasetRows.rows).toEqual([])

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
    const adminRevisions = await admin.query(`SELECT id FROM api.revisions`)
    expect(adminRevisions.rows).toHaveLength(1)
    const adminFiles = await admin.query(`SELECT id FROM api.file_objects`)
    expect(adminFiles.rows).toHaveLength(1)
    const adminDatasetRows = await admin.query(
      `SELECT id FROM api.dataset_rows`,
    )
    expect(adminDatasetRows.rows).toHaveLength(1)
  })

  it('shares approved records automatically when the project portal is on', async () => {
    const admin = await asAuthenticated(ADMIN, WS)
    await admin.query(
      `SELECT api.update_project_settings($1, NULL, NULL, true)`,
      [PROJECT_A],
    )
    const viewerA = await asAuthenticated(VIEWER_A, WS)
    const projects = await viewerA.query<{ title: string }>(
      `SELECT * FROM api.client_portal_projects()`,
    )
    expect(projects.rows.map((r) => r.title)).toEqual(['Acme AAV9 transfer'])
    // The approved record is shared automatically; the draft is never shown.
    const records = await viewerA.query<{ identifier: string }>(
      `SELECT * FROM api.client_portal_records()`,
    )
    expect(records.rows.map((r) => r.identifier)).toEqual(['EXP-A1'])

    // Turning it off hides the project again.
    await admin.query(
      `SELECT api.update_project_settings($1, NULL, NULL, false)`,
      [PROJECT_A],
    )
    const afterOff = await viewerA.query(
      `SELECT * FROM api.client_portal_projects()`,
    )
    expect(afterOff.rows).toEqual([])
  })

  it('invites a client viewer with a client and stamps it on accept', async () => {
    const admin = await asAuthenticated(ADMIN, WS)
    // A client viewer invitation needs a client.
    await expect(
      admin.query(
        `SELECT api.create_invitation($1, $2, 'client_viewer', 7, NULL)`,
        [WS, 'new-client@sheetbase.test'],
      ),
    ).rejects.toMatchObject({ code: 'SB061' })

    const created = await admin.query<{ token: string }>(
      `SELECT api.create_invitation($1, $2, 'client_viewer', 7, $3) ->> 'token' AS token`,
      [WS, 'new-client@sheetbase.test', CLIENT_A],
    )
    const token = created.rows[0]?.token as string
    expect(token).toBeTruthy()

    // Turn on the project portal so the new client has a project to see.
    await admin.query(
      `SELECT api.update_project_settings($1, NULL, NULL, true)`,
      [PROJECT_A],
    )

    const invitee = await asAuthenticated(INVITEE, WS)
    await invitee.query(`SELECT api.accept_invitation($1, $2)`, [
      token,
      INVITEE,
    ])
    const membership = await migrator.query<{
      role: string
      client_id: string
    }>(
      `SELECT role, client_id FROM api.workspace_memberships WHERE workspace_id = $1 AND user_id = $2`,
      [WS, INVITEE],
    )
    expect(membership.rows[0]?.role).toBe('client_viewer')
    expect(membership.rows[0]?.client_id).toBe(CLIENT_A)

    // And the new client reads Acme's shared project.
    const projects = await invitee.query<{ title: string }>(
      `SELECT * FROM api.client_portal_projects()`,
    )
    expect(projects.rows.map((r) => r.title)).toEqual(['Acme AAV9 transfer'])
  })

  it('lets the client and the team message on the portal', async () => {
    const viewerA = await asAuthenticated(VIEWER_A, WS)
    await viewerA.query(`SELECT api.post_client_portal_message($1, NULL, $2)`, [
      CLIENT_A,
      'When is the next batch released?',
    ])

    // The client reads their own thread.
    const asClient = await viewerA.query<{ author_kind: string; body: string }>(
      `SELECT * FROM api.client_portal_messages()`,
    )
    expect(asClient.rows.map((r) => r.author_kind)).toEqual(['client'])

    // The team posts and reads the same thread.
    const admin = await asAuthenticated(ADMIN, WS)
    await admin.query(`SELECT api.post_client_portal_message($1, NULL, $2)`, [
      CLIENT_A,
      'Thursday, after the review.',
    ])
    const asTeam = await admin.query<{ author_kind: string }>(
      `SELECT * FROM api.client_portal_messages($1)`,
      [CLIENT_A],
    )
    expect(asTeam.rows.map((r) => r.author_kind)).toEqual(['client', 'team'])

    // Empty messages and the wrong client are refused.
    await expect(
      viewerA.query(`SELECT api.post_client_portal_message($1, NULL, $2)`, [
        CLIENT_A,
        '   ',
      ]),
    ).rejects.toMatchObject({ code: '22023' })

    const viewerB = await asAuthenticated(VIEWER_B, WS)
    await expectDenied(
      viewerB.query(`SELECT api.post_client_portal_message($1, NULL, $2)`, [
        CLIENT_A,
        'Not mine',
      ]),
      '42501',
    )
    const otherThread = await viewerB.query(
      `SELECT * FROM api.client_portal_messages()`,
    )
    expect(otherThread.rows).toEqual([])
  })

  it("lists one portal project's milestones only", async () => {
    await migrator.query(
      `INSERT INTO api.study_tasks (id, workspace_id, project_id, title, task_type, status, due_at, position)
       VALUES
         ('00000000-0000-4000-8000-000000002330', '${WS}', '${PROJECT_A}', 'Upstream process locked', 'milestone', 'completed', '2026-09-19T00:00:00Z', 0),
         ('00000000-0000-4000-8000-000000002331', '${WS}', '${PROJECT_B}', 'Beta milestone', 'milestone', 'in_progress', '2026-10-01T00:00:00Z', 0)`,
    )
    const admin = await asAuthenticated(ADMIN, WS)
    await admin.query(
      `SELECT api.update_project_settings($1, NULL, NULL, true)`,
      [PROJECT_A],
    )
    const viewerA = await asAuthenticated(VIEWER_A, WS)
    const mine = await viewerA.query<{ title: string }>(
      `SELECT * FROM api.client_portal_milestones($1)`,
      [PROJECT_A],
    )
    expect(mine.rows.map((r) => r.title)).toEqual(['Upstream process locked'])
    // Another client's project is not enumerable by id.
    const other = await viewerA.query(
      `SELECT * FROM api.client_portal_milestones($1)`,
      [PROJECT_B],
    )
    expect(other.rows).toEqual([])
  })

  it('lists shared approved reports and hides drafts', async () => {
    const admin = await asAuthenticated(ADMIN, WS)
    const created = await admin.query<{ id: string; record_id: string }>(
      `SELECT * FROM api.create_report_definition($1, $2, NULL, $3, NULL)`,
      [WS, 'Portal progress report', PROJECT_A],
    )
    const report = created.rows[0]
    if (!report) throw new Error('report definition was not created')
    await admin.query(
      `SELECT api.update_report_definition($1, $2, NULL, NULL, 'approved', NULL, NULL)`,
      [WS, report.id],
    )
    await admin.query(`SELECT api.share_record_with_client($1, $2)`, [
      CLIENT_A,
      report.record_id,
    ])
    await admin.query(
      `SELECT * FROM api.create_report_definition($1, $2, NULL, $3, NULL)`,
      [WS, 'Portal draft report', PROJECT_A],
    )

    const viewerA = await asAuthenticated(VIEWER_A, WS)
    const reports = await viewerA.query<{ title: string }>(
      `SELECT * FROM api.client_portal_reports()`,
    )
    expect(reports.rows.map((r) => r.title)).toEqual(['Portal progress report'])
    const records = await viewerA.query<{ kind: string; status: string }>(
      `SELECT * FROM api.client_portal_records() WHERE kind = 'report'`,
    )
    expect(records.rows.map((r) => r.status)).toEqual(['approved'])
  })

  it('guards the record document to shared approved records', async () => {
    const admin = await asAuthenticated(ADMIN, WS)
    await admin.query(
      `SELECT api.update_project_settings($1, NULL, NULL, true)`,
      [PROJECT_A],
    )
    const viewerA = await asAuthenticated(VIEWER_A, WS)
    const ok = await viewerA.query<{ doc: { identifier: string } | null }>(
      `SELECT api.client_portal_record_document($1) AS doc`,
      [REC_APPROVED],
    )
    expect(ok.rows[0]?.doc?.identifier).toBe('EXP-A1')

    const draft = await viewerA.query<{ doc: unknown }>(
      `SELECT api.client_portal_record_document($1) AS doc`,
      [REC_DRAFT],
    )
    expect(draft.rows[0]?.doc).toBeNull()

    const viewerB = await asAuthenticated(VIEWER_B, WS)
    const otherClient = await viewerB.query<{ doc: unknown }>(
      `SELECT api.client_portal_record_document($1) AS doc`,
      [REC_APPROVED],
    )
    expect(otherClient.rows[0]?.doc).toBeNull()

    const outsider = await asAuthenticated(OUTSIDER, OTHER_WS)
    const otherWorkspace = await outsider.query<{ doc: unknown }>(
      `SELECT api.client_portal_record_document($1) AS doc`,
      [REC_APPROVED],
    )
    expect(otherWorkspace.rows[0]?.doc).toBeNull()
  })

  it('keeps workspaces and clients isolated', async () => {
    const outsider = await asAuthenticated(OUTSIDER, OTHER_WS)
    const projects = await outsider.query(
      `SELECT * FROM api.client_portal_projects()`,
    )
    expect(projects.rows).toEqual([])
    const records = await outsider.query(
      `SELECT * FROM api.client_portal_records()`,
    )
    expect(records.rows).toEqual([])
  })
})
