/**
 * WORK-01.2 — the caller's Inbox work items. A security-invoker view: the
 * caller sees their assigned reviews, their failed pipeline runs and their
 * follows; another user and another workspace see nothing.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { grantProjectAccess, prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000070a'
const OTHER_WS = '00000000-0000-4000-8000-00000000070b'
const PROJECT = '00000000-0000-4000-8000-00000000070c'
const REVIEW_RECORD = '00000000-0000-4000-8000-00000000070d'
const FOLLOW_RECORD = '00000000-0000-4000-8000-00000000070e'
const REVISION = '00000000-0000-4000-8000-00000000070f'
const SUBMISSION = '00000000-0000-4000-8000-000000000710'
const DEFINITION = '00000000-0000-4000-8000-000000000711'
const DEFINITION_VERSION = '00000000-0000-4000-8000-000000000712'
const RUN = '00000000-0000-4000-8000-000000000713'
const REVIEWER = 'work-reviewer'
const SUBMITTER = 'work-submitter'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Array<Client> = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
      ('${REVIEWER}', 'Work Reviewer', 'work-reviewer@sheetbase.test', true),
      ('${SUBMITTER}', 'Work Submitter', 'work-submitter@sheetbase.test', true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES
      ('${WS}', 'work-ws', 'Work WS'),
      ('${OTHER_WS}', 'work-other-ws', 'Work other WS')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS}', '${REVIEWER}', 'member'),
      ('${WS}', '${SUBMITTER}', 'member')`,
  )
  await migrator.query(
    `INSERT INTO api.projects (id, workspace_id, key, title, lead_user_id) VALUES ('${PROJECT}', '${WS}', 'work', 'Work project', '${SUBMITTER}')`,
  )
  await grantProjectAccess(migrator, {
    workspaceId: WS,
    projectId: PROJECT,
    userId: REVIEWER,
    canView: true,
    canEdit: true,
  })
  await migrator.query(
    `INSERT INTO api.records (id, workspace_id, project_id, kind, identifier, title, status, created_by_user_id) VALUES
      ('${REVIEW_RECORD}', '${WS}', '${PROJECT}', 'experiment', 'EXP-W1', 'Awaiting review', 'in_progress', '${SUBMITTER}'),
      ('${FOLLOW_RECORD}', '${WS}', '${PROJECT}', 'experiment', 'EXP-W2', 'Followed record', 'in_progress', '${SUBMITTER}')`,
  )
  await migrator.query(
    `INSERT INTO api.revisions (id, record_id, workspace_id, structure_version,
       metadata_version, metadata_snapshot, block_snapshot, integrity_digest,
       reason, created_by_user_id)
     VALUES ('${REVISION}', '${REVIEW_RECORD}', '${WS}', 1, 2, '{}'::jsonb,
             '[]'::jsonb, repeat('a', 64), 'submit', '${SUBMITTER}')`,
  )
  await migrator.query(
    `INSERT INTO internal.review_workflow_definitions (definition_key, version, definition)
     VALUES ('default-review', 1, '{"steps":[]}'::jsonb) ON CONFLICT DO NOTHING`,
  )
  await migrator.query(
    `INSERT INTO api.review_submissions (id, workspace_id, record_id, revision_id,
       workflow_definition_key, workflow_definition_version, assigned_reviewer_user_ids,
       submitted_by_user_id, submitted_session_id, submitted_role, submitted_at, idempotency_key)
     VALUES ('${SUBMISSION}', '${WS}', '${REVIEW_RECORD}', '${REVISION}',
             'default-review', 1, ARRAY['${REVIEWER}']::text[], '${SUBMITTER}',
             'sess', 'authenticated', now(), 'work-01-2-idem')`,
  )
  await migrator.query(
    `INSERT INTO api.pipeline_definitions (id, workspace_id, key, name, created_by_user_id)
     VALUES ('${DEFINITION}', '${WS}', 'work_pipeline', 'Work pipeline', '${REVIEWER}')`,
  )
  await migrator.query(
    `INSERT INTO api.pipeline_definition_versions (id, definition_id, workspace_id, version, configuration)
     VALUES ('${DEFINITION_VERSION}', '${DEFINITION}', '${WS}', 1, '{}'::jsonb)`,
  )
  await migrator.query(
    `INSERT INTO api.pipeline_runs (id, workspace_id, definition_version_id, status, finished_at, error_code, error_message, actor_user_id)
     VALUES
       ('${RUN}', '${WS}', '${DEFINITION_VERSION}', 'failed', now(), 'PL001', 'Out of temporary storage', '${REVIEWER}')`,
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

interface WorkItemRow {
  kind: string
  record_id: string | null
  identifier: string
  state: string
}

describe('api.my_work_items', () => {
  it('shows the assigned review and the failed run to the reviewer', async () => {
    const reviewer = await asAuthenticated(REVIEWER)
    const { rows } = await reviewer.query<WorkItemRow>(
      `SELECT kind, record_id, identifier, state FROM api.my_work_items ORDER BY kind, identifier`,
    )
    expect(rows).toEqual([
      {
        kind: 'review_requested',
        record_id: REVIEW_RECORD,
        identifier: 'EXP-W1',
        state: 'needs_action',
      },
      {
        kind: 'run_failed',
        record_id: null,
        identifier: 'work_pipeline',
        state: 'needs_action',
      },
    ])
  })

  it('does not show another user the review or the run', async () => {
    const submitter = await asAuthenticated(SUBMITTER)
    const { rows } = await submitter.query(`SELECT kind FROM api.my_work_items`)
    expect(rows).toEqual([])
  })

  it('shows a followed record as following', async () => {
    const reviewer = await asAuthenticated(REVIEWER)
    await reviewer.query(`SELECT api.follow_record('${FOLLOW_RECORD}')`)
    const { rows } = await reviewer.query<WorkItemRow>(
      `SELECT kind, record_id FROM api.my_work_items WHERE kind = 'following'`,
    )
    expect(rows).toEqual([{ kind: 'following', record_id: FOLLOW_RECORD }])
  })

  it('shows nothing to a caller in another workspace', async () => {
    const other = await asAuthenticated(REVIEWER, OTHER_WS)
    const { rows } = await other.query(`SELECT kind FROM api.my_work_items`)
    expect(rows).toEqual([])
  })
})
