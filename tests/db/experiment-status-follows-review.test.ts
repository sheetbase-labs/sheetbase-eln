/**
 * An experiment's status follows its review: submitting puts it In review, an
 * approval makes it Approved, a request for changes marks it Returned, and a
 * withdrawn review hands it back as In progress. A draft, another kind of
 * record, or a locked record is left alone.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase, ensureSessions } from './helpers'

const WS = '00000000-0000-4000-8000-00000000090a'
const PROJECT = '00000000-0000-4000-8000-00000000090b'
const USER = 'status-user'

let migrator: Client

beforeAll(async () => {
  ;({ migrator } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES ('${USER}', 'Status User', 'status@sheetbase.test', true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES ('${WS}', 'status-ws', 'Status WS')`,
  )
  await migrator.query(
    `INSERT INTO api.projects (id, workspace_id, key, title, lead_user_id) VALUES ('${PROJECT}', '${WS}', 'stat', 'Status project', NULL)`,
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

async function record(kind: string, status: string): Promise<string> {
  counter += 1
  const id = `00000000-0000-4000-8000-0000000091${String(counter).padStart(2, '0')}`
  await migrator.query(
    `INSERT INTO api.records (id, workspace_id, project_id, kind, identifier, title, status, created_by_user_id)
     VALUES ($1, '${WS}', '${PROJECT}', $2, $3, 'Record', $4, '${USER}')`,
    [id, kind, `${kind.slice(0, 3).toUpperCase()}-S${counter}`, status],
  )
  return id
}

async function submit(recordId: string): Promise<string> {
  counter += 1
  const revision = await migrator.query<{ id: string }>(
    `INSERT INTO api.revisions (id, record_id, workspace_id, structure_version,
       metadata_version, metadata_snapshot, block_snapshot, integrity_digest, reason, created_by_user_id)
     VALUES (gen_random_uuid(), $1, '${WS}', 1, 2, '{}'::jsonb, '[]'::jsonb, repeat('a', 64), 'submit', '${USER}')
     RETURNING id`,
    [recordId],
  )
  const { rows } = await migrator.query<{ id: string }>(
    `INSERT INTO api.review_submissions (workspace_id, record_id, revision_id,
       workflow_definition_key, workflow_definition_version, assigned_reviewer_user_ids,
       submitted_by_user_id, submitted_session_id, submitted_role, submitted_at, idempotency_key)
     VALUES ('${WS}', $1, $2, 'default-review', 1, ARRAY['${USER}']::text[],
             '${USER}', 'sess', 'authenticated', now(), $3)
     RETURNING id`,
    [recordId, revision.rows[0]!.id, `status-${counter}`],
  )
  return rows[0]!.id
}

async function statusOf(recordId: string): Promise<string> {
  const { rows } = await migrator.query<{ status: string }>(
    `SELECT status FROM api.records WHERE id = $1`,
    [recordId],
  )
  return rows[0]!.status
}

async function decide(submissionId: string, state: string): Promise<void> {
  await migrator.query(
    `UPDATE api.review_submissions SET state = $2 WHERE id = $1`,
    [submissionId, state],
  )
}

describe('experiment status follows the review', () => {
  it('moves In progress to In review on submit, then Approved on approval', async () => {
    const id = await record('experiment', 'in_progress')
    const submission = await submit(id)
    expect(await statusOf(id)).toBe('in_review')
    await decide(submission, 'approved')
    expect(await statusOf(id)).toBe('approved')
  })

  it('marks the experiment Returned when changes are requested, and In review again on resubmit', async () => {
    const id = await record('experiment', 'in_progress')
    const submission = await submit(id)
    await decide(submission, 'returned')
    expect(await statusOf(id)).toBe('returned')
    await submit(id)
    expect(await statusOf(id)).toBe('in_review')
  })

  it('hands the experiment back as In progress when the review is withdrawn', async () => {
    const id = await record('experiment', 'in_progress')
    const submission = await submit(id)
    await decide(submission, 'withdrawn')
    expect(await statusOf(id)).toBe('in_progress')
  })

  it('bumps the metadata version so open pages notice the change', async () => {
    const id = await record('experiment', 'in_progress')
    const before = await migrator.query<{ metadata_version: string }>(
      `SELECT metadata_version FROM api.records WHERE id = $1`,
      [id],
    )
    await submit(id)
    const after = await migrator.query<{ metadata_version: string }>(
      `SELECT metadata_version FROM api.records WHERE id = $1`,
      [id],
    )
    expect(Number(after.rows[0]!.metadata_version)).toBe(
      Number(before.rows[0]!.metadata_version) + 1,
    )
  })

  it('leaves a draft and other kinds of record alone', async () => {
    const draft = await record('experiment', 'draft')
    const protocol = await record('protocol_template', 'draft')
    for (const id of [draft, protocol]) await submit(id)
    expect(await statusOf(draft)).toBe('draft')
    expect(await statusOf(protocol)).toBe('draft')
  })
})
