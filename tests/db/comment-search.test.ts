/**
 * SRCH-01.1 — comment text search respects the record's RLS.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase, grantProjectAccess } from './helpers'

const WS = '00000000-0000-4000-8000-00000000180a'
const OTHER_WS = '00000000-0000-4000-8000-00000000180b'
const PROJECT = '00000000-0000-4000-8000-00000000180c'
const OTHER_PROJECT = '00000000-0000-4000-8000-00000000180d'
const RECORD = '00000000-0000-4000-8000-00000000180e'
const OTHER_RECORD = '00000000-0000-4000-8000-00000000180f'
const REVISION = '00000000-0000-4000-8000-000000001810'
const OTHER_REVISION = '00000000-0000-4000-8000-000000001811'
const MEMBER = 'cs-member'
const VIEWER = 'cs-viewer'
const OUTSIDER = 'cs-outsider'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Array<Client> = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
      ('${MEMBER}', 'CS Member', 'cs@sheetbase.test', true),
      ('${VIEWER}', 'CS Viewer', 'csv@sheetbase.test', true),
      ('${OUTSIDER}', 'CS Outsider', 'cso@sheetbase.test', true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES
      ('${WS}', 'cs-ws', 'CS WS'),
      ('${OTHER_WS}', 'cs-other', 'CS other')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS}', '${MEMBER}', 'member'),
      ('${WS}', '${VIEWER}', 'viewer'),
      ('${OTHER_WS}', '${OUTSIDER}', 'member')`,
  )
  await migrator.query(
    `INSERT INTO api.projects (id, workspace_id, key, title, lead_user_id) VALUES
      ('${PROJECT}', '${WS}', 'cs', 'CS', '${MEMBER}'),
      ('${OTHER_PROJECT}', '${OTHER_WS}', 'cso', 'CS other', '${OUTSIDER}')`,
  )
  await grantProjectAccess(migrator, {
    workspaceId: WS,
    projectId: PROJECT,
    userId: VIEWER,
    canView: true,
    canEdit: false,
  })
  await migrator.query(
    `INSERT INTO api.records (id, workspace_id, project_id, kind, identifier, title, created_by_user_id) VALUES
      ('${RECORD}', '${WS}', '${PROJECT}', 'experiment', 'EXP-C1', 'Commented record', '${MEMBER}'),
      ('${OTHER_RECORD}', '${OTHER_WS}', '${OTHER_PROJECT}', 'experiment', 'EXP-C2', 'Other record', '${OUTSIDER}')`,
  )
  await migrator.query(
    `INSERT INTO api.revisions (id, record_id, workspace_id, structure_version,
       metadata_version, metadata_snapshot, block_snapshot, integrity_digest, reason, created_by_user_id)
     VALUES
      ('${REVISION}', '${RECORD}', '${WS}', 1, 2, '{}'::jsonb, '[]'::jsonb, repeat('a', 64), 'submit', '${MEMBER}'),
      ('${OTHER_REVISION}', '${OTHER_RECORD}', '${OTHER_WS}', 1, 2, '{}'::jsonb, '[]'::jsonb, repeat('a', 64), 'submit', '${OUTSIDER}')`,
  )
  await migrator.query(
    `INSERT INTO api.comments (id, workspace_id, revision_id, record_id, root_id, target_kind, target, body, author_user_id) VALUES
      ('00000000-0000-4000-8000-000000001820', '${WS}', '${REVISION}', '${RECORD}', '00000000-0000-4000-8000-000000001820', 'revision', '{"blockId":"blk-1"}'::jsonb, 'Can we repeat C at 150 with a 1:5 dilution?', '${MEMBER}'),
      ('00000000-0000-4000-8000-000000001821', '${OTHER_WS}', '${OTHER_REVISION}', '${OTHER_RECORD}', '00000000-0000-4000-8000-000000001821', 'revision', '{"blockId":"blk-2"}'::jsonb, 'Secret dilution note', '${OUTSIDER}')`,
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

describe('api.search_comments', () => {
  it('finds a comment with its record identity, anchor, author and time', async () => {
    const member = await asAuthenticated(MEMBER, WS)
    const { rows } = await member.query<{
      identifier: string
      target_kind: string
      anchor: { blockId: string }
      body: string
      author_user_id: string
      created_at: Date
    }>(`SELECT * FROM api.search_comments('dilution', 20)`)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      identifier: 'EXP-C1',
      target_kind: 'revision',
      anchor: { blockId: 'blk-1' },
      author_user_id: MEMBER,
    })
    expect(rows[0]?.body).toContain('1:5 dilution')
    expect(rows[0]?.created_at).toBeInstanceOf(Date)
  })

  it('lets a workspace viewer read comments', async () => {
    const viewer = await asAuthenticated(VIEWER, WS)
    const { rows } = await viewer.query(
      `SELECT comment_id FROM api.search_comments('dilution', 20)`,
    )
    expect(rows).toHaveLength(1)
  })

  it('shows an outsider from another workspace nothing', async () => {
    const outsider = await asAuthenticated(OUTSIDER, OTHER_WS)
    const { rows } = await outsider.query(
      `SELECT comment_id FROM api.search_comments('dilution', 20)`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveProperty('comment_id')
    // The outsider only sees their own workspace's comment, not EXP-C1.
    const { rows: own } = await outsider.query<{ identifier: string }>(
      `SELECT identifier FROM api.search_comments('dilution', 20)`,
    )
    expect(own.map((row) => row.identifier)).toEqual(['EXP-C2'])
  })

  it('returns nothing when the outsider claims the other workspace', async () => {
    const outsider = await asAuthenticated(OUTSIDER, WS)
    const { rows } = await outsider.query(
      `SELECT comment_id FROM api.search_comments('dilution', 20)`,
    )
    expect(rows).toEqual([])
  })
})
