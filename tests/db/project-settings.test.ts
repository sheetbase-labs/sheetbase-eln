/**
 * PROJ-03.2 — the project's require_independent_reviewer setting is enforced
 * by a signature trigger: when set, the approving reviewer must not be the
 * author, and only admins can change the setting.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  expectDenied,
  prepareTestDatabase,
  grantProjectAccess,
} from './helpers'

const WS = '00000000-0000-4000-8000-00000000090a'
const PROJECT = '00000000-0000-4000-8000-00000000090b'
const RECORD = '00000000-0000-4000-8000-00000000090c'
const REVISION = '00000000-0000-4000-8000-00000000090d'
const SUBMISSION = '00000000-0000-4000-8000-00000000090e'
const ADMIN = 'settings-admin'
const AUTHOR = 'settings-author'
const REVIEWER = 'settings-reviewer'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Array<Client> = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
      ('${ADMIN}', 'Settings Admin', 'settings-admin@sheetbase.test', true),
      ('${AUTHOR}', 'Settings Author', 'settings-author@sheetbase.test', true),
      ('${REVIEWER}', 'Settings Reviewer', 'settings-reviewer@sheetbase.test', true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES ('${WS}', 'settings-ws', 'Settings WS')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS}', '${ADMIN}', 'admin'),
      ('${WS}', '${AUTHOR}', 'member'),
      ('${WS}', '${REVIEWER}', 'member')`,
  )
  await migrator.query(
    `INSERT INTO api.projects (id, workspace_id, key, title, lead_user_id) VALUES ('${PROJECT}', '${WS}', 'set', 'Settings project', '${AUTHOR}')`,
    await grantProjectAccess(migrator, {
      workspaceId: WS,
      projectId: PROJECT,
      userId: ADMIN,
      canView: true,
      canEdit: false,
      canReview: false,
      canManage: true,
    }),
  )
  await grantProjectAccess(migrator, {
    workspaceId: WS,
    projectId: PROJECT,
    userId: REVIEWER,
    canView: true,
    canEdit: true,
  })
  await migrator.query(
    `INSERT INTO api.records (id, workspace_id, project_id, kind, identifier, title, created_by_user_id)
     VALUES ('${RECORD}', '${WS}', '${PROJECT}', 'experiment', 'EXP-S1', 'Governed record', '${AUTHOR}')`,
  )
  await migrator.query(
    `INSERT INTO api.revisions (id, record_id, workspace_id, structure_version,
       metadata_version, metadata_snapshot, block_snapshot, integrity_digest, reason, created_by_user_id)
     VALUES ('${REVISION}', '${RECORD}', '${WS}', 1, 2, '{}'::jsonb, '[]'::jsonb, repeat('a', 64), 'submit', '${AUTHOR}')`,
  )
  await migrator.query(
    `INSERT INTO internal.review_workflow_definitions (definition_key, version, definition)
     VALUES ('default-review', 1, '{"steps":[]}'::jsonb) ON CONFLICT DO NOTHING`,
  )
  await migrator.query(
    `INSERT INTO api.review_submissions (id, workspace_id, record_id, revision_id,
       state, workflow_definition_key, workflow_definition_version, assigned_reviewer_user_ids,
       submitted_by_user_id, submitted_session_id, submitted_role, submitted_at, idempotency_key)
     VALUES ('${SUBMISSION}', '${WS}', '${RECORD}', '${REVISION}', 'approved', 'default-review', 1,
             ARRAY['${REVIEWER}']::text[], '${AUTHOR}', 'sess', 'authenticated', now(), 'settings-idem')`,
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

async function asAuthenticated(userId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query("SELECT set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: userId, workspace_id: WS, role: 'authenticated' }),
  ])
  return client
}

let signatureSeq = 0
// Signatures are written through api.sign_revision (SECURITY DEFINER); the
// independence trigger is exercised here by inserting directly as the
// migrator, which still fires BEFORE INSERT triggers.
async function sign(_client: Client, signerUserId: string) {
  signatureSeq += 1
  const id = `00000000-0000-4000-8000-0000000091${String(signatureSeq).padStart(2, '0')}`
  await migrator.query('RESET ROLE')
  return migrator.query(
    `INSERT INTO api.signatures (id, workspace_id, submission_id, revision_id, record_id,
       signature_meaning, revision_integrity_digest, signer_user_id, signer_session_id,
       signer_role, auth_method, confirmation_phrase)
     VALUES ($1, '${WS}', '${SUBMISSION}', '${REVISION}', '${RECORD}',
             'approve-for-record', repeat('a', 64), $2, 'sess', 'authenticated',
             'session+name-confirmation', 'Confirm')`,
    [id, signerUserId],
  )
}

describe('project settings', () => {
  it('defaults off and refuses a non-admin', async () => {
    const member = await asAuthenticated(AUTHOR)
    const { rows } = await member.query<{
      require_independent_reviewer: boolean
    }>(
      `SELECT require_independent_reviewer FROM api.projects WHERE id = '${PROJECT}'`,
    )
    expect(rows[0]?.require_independent_reviewer).toBe(false)
    await expectDenied(
      member.query(
        `SELECT api.update_project_settings('${PROJECT}', NULL, true, NULL)`,
      ),
      '42501',
    )
  })

  it('lets the author sign while the setting is off', async () => {
    const author = await asAuthenticated(AUTHOR)
    await expect(sign(author, AUTHOR)).resolves.toBeTruthy()
  })

  it('refuses an author signature once independent review is required', async () => {
    const admin = await asAuthenticated(ADMIN)
    await admin.query(
      `SELECT api.update_project_settings('${PROJECT}', NULL, true, NULL)`,
    )
    await expect(sign(admin, AUTHOR)).rejects.toMatchObject({ code: 'SB008' })
    // A different reviewer is allowed.
    await expect(sign(admin, REVIEWER)).resolves.toBeTruthy()
  })
})
