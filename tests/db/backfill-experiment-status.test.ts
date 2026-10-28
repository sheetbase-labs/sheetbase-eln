/**
 * Experiments reviewed before the status followed the review are brought in
 * line with their latest review submission by migration 0026.
 */
import { readFileSync } from 'node:fs'
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase, ensureSessions } from './helpers'

const WS = '00000000-0000-4000-8000-00000000095a'
const PROJECT = '00000000-0000-4000-8000-00000000095b'
const USER = 'backfill-user'

let migrator: Client

beforeAll(async () => {
  ;({ migrator } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES ('${USER}', 'Backfill User', 'backfill@sheetbase.test', true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES ('${WS}', 'backfill-ws', 'Backfill WS')`,
  )
  await migrator.query(
    `INSERT INTO api.projects (id, workspace_id, key, title, lead_user_id) VALUES ('${PROJECT}', '${WS}', 'bfl', 'Backfill project', NULL)`,
  )
  await ensureSessions(migrator, [USER])
  await migrator.query(
    `INSERT INTO internal.review_workflow_definitions (definition_key, version, definition)
     VALUES ('default-review', 1, '{"steps":[]}'::jsonb) ON CONFLICT DO NOTHING`,
  )
})

afterAll(async () => {
  await migrator.end()
})

let counter = 0

async function reviewed(state: string): Promise<string> {
  counter += 1
  const id = `00000000-0000-4000-8000-0000000095${String(counter).padStart(2, '0')}`
  await migrator.query(
    `INSERT INTO api.records (id, workspace_id, project_id, kind, identifier, title, status, created_by_user_id)
     VALUES ($1, '${WS}', '${PROJECT}', 'experiment', $2, 'Record', 'in_progress', '${USER}')`,
    [id, `EXP-B${counter}`],
  )
  const revision = await migrator.query<{ id: string }>(
    `INSERT INTO api.revisions (id, record_id, workspace_id, structure_version,
       metadata_version, metadata_snapshot, block_snapshot, integrity_digest, reason, created_by_user_id)
     VALUES (gen_random_uuid(), $1, '${WS}', 1, 2, '{}'::jsonb, '[]'::jsonb, repeat('a', 64), 'submit', '${USER}')
     RETURNING id`,
    [id],
  )
  await migrator.query(
    `INSERT INTO api.review_submissions (workspace_id, record_id, revision_id,
       workflow_definition_key, workflow_definition_version, assigned_reviewer_user_ids,
       submitted_by_user_id, submitted_session_id, submitted_role, submitted_at, idempotency_key, state)
     VALUES ('${WS}', $1, $2, 'default-review', 1, ARRAY['${USER}']::text[],
             '${USER}', 'sess', 'authenticated', now(), $3, $4)`,
    [id, revision.rows[0]!.id, `backfill-${counter}`, state],
  )
  // Put it back to how it looked before the trigger existed.
  await migrator.query(
    `UPDATE api.records SET status = 'in_progress' WHERE id = $1`,
    [id],
  )
  return id
}

async function statusOf(id: string): Promise<string> {
  const { rows } = await migrator.query<{ status: string }>(
    `SELECT status FROM api.records WHERE id = $1`,
    [id],
  )
  return rows[0]!.status
}

describe('backfill experiment status from review', () => {
  it('moves reviewed experiments to the status their review implies', async () => {
    const submitted = await reviewed('submitted')
    const approved = await reviewed('approved')
    const returned = await reviewed('returned')
    const withdrawn = await reviewed('withdrawn')
    expect(await statusOf(submitted)).toBe('in_progress')

    await migrator.query(
      readFileSync(
        'drizzle/0026_backfill_experiment_status_from_review.sql',
        'utf8',
      ),
    )

    expect(await statusOf(submitted)).toBe('in_review')
    expect(await statusOf(approved)).toBe('approved')
    expect(await statusOf(returned)).toBe('returned')
    expect(await statusOf(withdrawn)).toBe('in_progress')
  })
})
