/**
 * WORK-03.2 — notifications are written from change events and read per user.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { grantProjectAccess, prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-000000000d0a'
const PROJECT = '00000000-0000-4000-8000-000000000d0b'
const RECORD = '00000000-0000-4000-8000-000000000d0c'
const REVISION = '00000000-0000-4000-8000-000000000d0d'
const SUBMISSION = '00000000-0000-4000-8000-000000000d0e'
const MENTIONED = 'notif-mentioned'
const PROTOCOL = '00000000-0000-4000-8000-000000000d0f'
const REVIEWER = 'notif-reviewer'
const SUBMITTER = 'notif-submitter'
const COMMENT = '00000000-0000-4000-8000-000000000d10'
const VERSION = '00000000-0000-4000-8000-000000000d11'
const COMMENT2 = '00000000-0000-4000-8000-000000000d12'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Array<Client> = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
      ('${REVIEWER}', 'Notif Reviewer', 'notif-reviewer@sheetbase.test', true),
      ('${SUBMITTER}', 'Notif Submitter', 'notif-submitter@sheetbase.test', true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES ('${WS}', 'notif-ws', 'Notif WS')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS}', '${REVIEWER}', 'member'),
      ('${WS}', '${SUBMITTER}', 'member')`,
  )
  await migrator.query(
    `INSERT INTO api.projects (id, workspace_id, key, title, lead_user_id) VALUES ('${PROJECT}', '${WS}', 'nfn', 'Notif project', '${SUBMITTER}')`,
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
     VALUES ('${RECORD}', '${WS}', '${PROJECT}', 'experiment', 'EXP-N1', 'Notified record', '${SUBMITTER}')`,
  )
  await migrator.query(
    `INSERT INTO api.revisions (id, record_id, workspace_id, structure_version,
       metadata_version, metadata_snapshot, block_snapshot, integrity_digest, reason, created_by_user_id)
     VALUES ('${REVISION}', '${RECORD}', '${WS}', 1, 2, '{}'::jsonb, '[]'::jsonb, repeat('a', 64), 'submit', '${SUBMITTER}')`,
  )
  await migrator.query(
    `INSERT INTO internal.review_workflow_definitions (definition_key, version, definition)
     VALUES ('default-review', 1, '{"steps":[]}'::jsonb) ON CONFLICT DO NOTHING`,
  )
  await migrator.query(
    `INSERT INTO api.review_submissions (id, workspace_id, record_id, revision_id,
       workflow_definition_key, workflow_definition_version, assigned_reviewer_user_ids,
       submitted_by_user_id, submitted_session_id, submitted_role, submitted_at, idempotency_key)
     VALUES ('${SUBMISSION}', '${WS}', '${RECORD}', '${REVISION}', 'default-review', 1,
             ARRAY['${REVIEWER}']::text[], '${SUBMITTER}', 'sess', 'authenticated', now(), 'notif-idem')`,
  )
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
      ('${MENTIONED}', 'Notif Mentioned', 'notif-mentioned@sheetbase.test', true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id, user_id, role)
     VALUES ('${WS}', '${MENTIONED}', 'member')`,
  )
  await migrator.query(
    `INSERT INTO api.records (id, workspace_id, project_id, kind, identifier, title, status, created_by_user_id)
     VALUES ('${PROTOCOL}', '${WS}', '${PROJECT}', 'protocol_template', 'PRT-N1', 'Notif protocol', 'active', '${SUBMITTER}')`,
  )
  await migrator.query(
    `INSERT INTO api.protocol_training (workspace_id, protocol_record_id, user_id)
     VALUES ('${WS}', '${PROTOCOL}', '${REVIEWER}'),
            ('${WS}', '${PROTOCOL}', '${MENTIONED}')`,
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

async function emitReviewEvent(actor: string) {
  await migrator.query(
    `INSERT INTO api.change_events
       (id, workspace_id, sequence, entity_type, entity_uuid, operation, record_id, project_id, actor_user_id, payload)
     VALUES (gen_random_uuid(), $1,
             (SELECT coalesce(max(sequence), 0) + 1 FROM api.change_events WHERE workspace_id = $1),
             'review_submission', $2, 'create', $3, $4, $5, '{}'::jsonb)`,
    [WS, SUBMISSION, RECORD, PROJECT, actor],
  )
}

async function emitEvent(
  entityType: string,
  entityId: string,
  operation: string,
  actor: string,
) {
  await migrator.query(
    `INSERT INTO api.change_events
       (id, workspace_id, sequence, entity_type, entity_uuid, operation, record_id, project_id, actor_user_id, payload)
     VALUES (gen_random_uuid(), $1,
             (SELECT coalesce(max(sequence), 0) + 1 FROM api.change_events WHERE workspace_id = $1),
             $2, $3, $4, $5, $6, $7, '{}'::jsonb)`,
    [WS, entityType, entityId, operation, RECORD, PROJECT, actor],
  )
}

describe('notifications', () => {
  it('writes a review_requested notification for the assigned reviewer', async () => {
    await emitReviewEvent(SUBMITTER)
    const rows = await migrator.query<{ user_id: string; event_type: string }>(
      `SELECT user_id, event_type FROM internal.notifications WHERE record_id = $1`,
      [RECORD],
    )
    expect(rows.rows).toEqual([
      { user_id: REVIEWER, event_type: 'review_requested' },
    ])
  })

  it('shows the reviewer their notification and marks it read', async () => {
    const reviewer = await asAuthenticated(REVIEWER)
    const list = await reviewer.query<{ id: string; read_at: string | null }>(
      `SELECT id, read_at FROM api.my_notifications`,
    )
    expect(list.rows).toHaveLength(1)
    expect(list.rows[0]?.read_at).toBeNull()

    const marked = await reviewer.query<{ n: number }>(
      `SELECT api.mark_notifications_read(NULL) AS n`,
    )
    expect(marked.rows[0]!.n).toBe(1)

    const after = await reviewer.query<{ read_at: string | null }>(
      `SELECT read_at FROM api.my_notifications`,
    )
    expect(after.rows[0]?.read_at).not.toBeNull()
  })

  it('does not notify the submitter of their own review request', async () => {
    const submitter = await asAuthenticated(SUBMITTER)
    const list = await submitter.query(`SELECT id FROM api.my_notifications`)
    expect(list.rows).toEqual([])
  })

  it('notifies the record author and a mentioned user of a comment', async () => {
    await migrator.query(
      `INSERT INTO api.comments (id, root_id, workspace_id, record_id, revision_id, target_kind, target, body, mentions, author_user_id)
       VALUES ('${COMMENT}', '${COMMENT}', '${WS}', '${RECORD}', '${REVISION}', 'revision', '{}'::jsonb, 'Please look', ARRAY['${MENTIONED}']::text[], '${REVIEWER}')`,
    )
    await emitEvent('comment', COMMENT, 'create', REVIEWER)

    const rows = await migrator.query<{ user_id: string; event_type: string }>(
      `SELECT user_id, event_type FROM internal.notifications WHERE event_type='comment_or_mention' ORDER BY user_id`,
    )
    expect(rows.rows.map((row) => row.user_id).sort()).toEqual(
      [SUBMITTER, MENTIONED].sort(),
    )
    expect(
      rows.rows.every((row) => row.event_type === 'comment_or_mention'),
    ).toBe(true)

    // The comment's author is not notified of their own comment.
    expect(rows.rows.some((row) => row.user_id === REVIEWER)).toBe(false)
  })

  it('skips a user who turned in-app delivery off for the event type', async () => {
    await migrator.query(
      `INSERT INTO api.notification_preferences (user_id, event_type, in_app, email, digest)
       VALUES ('${MENTIONED}', 'comment_or_mention', false, false, false)
       ON CONFLICT DO NOTHING`,
    )
    await migrator.query(
      `INSERT INTO api.comments (id, root_id, workspace_id, record_id, revision_id, target_kind, target, body, mentions, author_user_id)
       VALUES ('${COMMENT2}', '${COMMENT2}', '${WS}', '${RECORD}', '${REVISION}', 'revision', '{}'::jsonb, 'Second', ARRAY['${MENTIONED}']::text[], '${REVIEWER}')`,
    )
    const before = await migrator.query<{ n: string }>(
      `SELECT count(*) AS n FROM internal.notifications WHERE event_type='comment_or_mention' AND user_id='${MENTIONED}'`,
    )
    await emitEvent('comment', COMMENT2, 'create', REVIEWER)
    const after = await migrator.query<{ n: string }>(
      `SELECT count(*) AS n FROM internal.notifications WHERE event_type='comment_or_mention' AND user_id='${MENTIONED}'`,
    )
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n)
  })

  it('notifies everyone trained on a protocol when a new version appears', async () => {
    const version = await migrator.query<{ id: string }>(
      `INSERT INTO api.protocol_versions (id, workspace_id, protocol_record_id, version, status, created_by_user_id)
       VALUES ('${VERSION}', '${WS}', '${PROTOCOL}', 2, 'draft', '${SUBMITTER}') RETURNING id`,
    )
    await emitEvent(
      'protocol_version',
      version.rows[0]!.id,
      'create',
      SUBMITTER,
    )

    const rows = await migrator.query<{ user_id: string }>(
      `SELECT user_id FROM internal.notifications WHERE event_type='protocol_new_version' ORDER BY user_id`,
    )
    expect(rows.rows.map((row) => row.user_id).sort()).toEqual(
      [REVIEWER, MENTIONED].sort(),
    )
  })
})
