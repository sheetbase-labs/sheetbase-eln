/**
 * WORK-01.1 — a submission's due date comes from the project's default review
 * period (7 days when unset), and an explicit due date overrides it.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase, ensureSessions } from './helpers'

const WS = '00000000-0000-4000-8000-00000000080a'
const PROJECT = '00000000-0000-4000-8000-00000000080b'
const PROJECT_PLAIN = '00000000-0000-4000-8000-00000000080c'
const RECORD = '00000000-0000-4000-8000-00000000080d'
const RECORD_PLAIN = '00000000-0000-4000-8000-00000000080e'
const USER = 'due-user'

let migrator: Client

beforeAll(async () => {
  ;({ migrator } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES ('${USER}', 'Due User', 'due@sheetbase.test', true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES ('${WS}', 'due-ws', 'Due WS')`,
  )
  await migrator.query(
    `INSERT INTO api.projects (id, workspace_id, key, title, default_review_period_days, lead_user_id) VALUES
      ('${PROJECT}', '${WS}', 'due', 'Three-day project', 3, NULL),
      ('${PROJECT_PLAIN}', '${WS}', 'plain', 'Default project', NULL, NULL)`,
  )
  await ensureSessions(migrator, [USER])
  await migrator.query(
    `INSERT INTO api.records (id, workspace_id, project_id, kind, identifier, title, created_by_user_id) VALUES
      ('${RECORD}', '${WS}', '${PROJECT}', 'experiment', 'EXP-D1', 'Three-day record', '${USER}'),
      ('${RECORD_PLAIN}', '${WS}', '${PROJECT_PLAIN}', 'experiment', 'EXP-D2', 'Default record', '${USER}')`,
  )
  await migrator.query(
    `INSERT INTO internal.review_workflow_definitions (definition_key, version, definition)
     VALUES ('default-review', 1, '{"steps":[]}'::jsonb) ON CONFLICT DO NOTHING`,
  )
})

afterAll(async () => {
  await migrator.end()
})

async function submit(
  recordId: string,
  key: string,
  dueAt: string | null,
): Promise<{ due_at: Date; submitted_at: Date }> {
  const revision = await migrator.query<{ id: string }>(
    `INSERT INTO api.revisions (id, record_id, workspace_id, structure_version,
       metadata_version, metadata_snapshot, block_snapshot, integrity_digest, reason, created_by_user_id)
     VALUES (gen_random_uuid(), $1, '${WS}', 1, 2, '{}'::jsonb, '[]'::jsonb, repeat('a', 64), 'submit', '${USER}')
     RETURNING id`,
    [recordId],
  )
  const due = dueAt ? `'${dueAt}'::timestamptz` : `NULL`
  const { rows } = await migrator.query<{ due_at: Date; submitted_at: Date }>(
    `INSERT INTO api.review_submissions (workspace_id, record_id, revision_id,
       workflow_definition_key, workflow_definition_version, assigned_reviewer_user_ids,
       submitted_by_user_id, submitted_session_id, submitted_role, submitted_at, due_at, idempotency_key)
     VALUES ('${WS}', $1, $2, 'default-review', 1, ARRAY['${USER}']::text[],
             '${USER}', 'sess', 'authenticated', '2026-09-25T09:40:00+01:00'::timestamptz, ${due}, $3)
     RETURNING due_at, submitted_at`,
    [recordId, revision.rows[0]!.id, key],
  )
  return rows[0]!
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000)
}

describe('review submission due dates', () => {
  it('uses the project default review period', async () => {
    const row = await submit(RECORD, 'due-1', null)
    expect(daysBetween(row.submitted_at, row.due_at)).toBe(3)
  })

  it('falls back to seven days when the project has no period', async () => {
    const row = await submit(RECORD_PLAIN, 'due-2', null)
    expect(daysBetween(row.submitted_at, row.due_at)).toBe(7)
  })

  it('keeps an explicit due date as the override', async () => {
    const row = await submit(RECORD, 'due-3', '2026-10-10T09:40:00+01:00')
    expect(daysBetween(row.submitted_at, row.due_at)).toBe(15)
  })
})
