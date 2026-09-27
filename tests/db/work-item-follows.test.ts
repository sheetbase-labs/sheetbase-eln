/**
 * WORK-01.3 — following a record is per-user and permission-safe: the follower
 * sees their own rows only, a non-member is refused, and unfollow is idempotent.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000060a'
const OTHER_WS = '00000000-0000-4000-8000-00000000060b'
const PROJECT = '00000000-0000-4000-8000-00000000060c'
const RECORD = '00000000-0000-4000-8000-00000000060d'
const FOREIGN_RECORD = '00000000-0000-4000-8000-00000000060e'
const OWNER = 'follow-owner'
const OTHER = 'follow-other'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Array<Client> = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
      ('${OWNER}', 'Follow Owner', 'follow-owner@sheetbase.test', true),
      ('${OTHER}', 'Follow Other', 'follow-other@sheetbase.test', true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES
      ('${WS}', 'follow-ws', 'Follow WS'),
      ('${OTHER_WS}', 'follow-other-ws', 'Follow other WS')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS}', '${OWNER}', 'member')`,
  )
  await migrator.query(
    `INSERT INTO api.projects (id, workspace_id, key, title) VALUES ('${PROJECT}', '${WS}', 'fol', 'Follow project')`,
  )
  await migrator.query(
    `INSERT INTO api.records (id, workspace_id, project_id, kind, identifier, title, created_by_user_id) VALUES
      ('${RECORD}', '${WS}', '${PROJECT}', 'experiment', 'EXP-F1', 'Followed record', '${OWNER}'),
      ('${FOREIGN_RECORD}', '${OTHER_WS}', NULL, 'experiment', 'EXP-F2', 'Foreign record', '${OWNER}')`,
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

describe('api.follow_record', () => {
  it('records the follow for the caller', async () => {
    const owner = await asAuthenticated(OWNER)
    const first = await owner.query<{ created_at: Date }>(
      `SELECT api.follow_record('${RECORD}') AS created_at`,
    )
    expect(first.rows[0]?.created_at).toBeInstanceOf(Date)

    const rows = await owner.query(
      `SELECT record_id FROM api.work_item_follows`,
    )
    expect(rows.rows).toEqual([{ record_id: RECORD }])

    // Re-following is idempotent and keeps the original follow time.
    const again = await owner.query<{ created_at: Date }>(
      `SELECT api.follow_record('${RECORD}') AS created_at`,
    )
    expect(again.rows[0]?.created_at.getTime()).toBe(
      first.rows[0]?.created_at.getTime(),
    )
  })

  it('is invisible to another user', async () => {
    const other = await asAuthenticated(OTHER)
    const rows = await other.query(
      `SELECT record_id FROM api.work_item_follows`,
    )
    expect(rows.rows).toEqual([])
  })

  it('refuses a record in a workspace the caller is not in', async () => {
    const owner = await asAuthenticated(OWNER)
    await expectDenied(
      owner.query(`SELECT api.follow_record('${FOREIGN_RECORD}')`),
      '42501',
    )
  })
})

describe('api.unfollow_record', () => {
  it('removes the caller-owned follow and is idempotent', async () => {
    const owner = await asAuthenticated(OWNER)
    await owner.query(`SELECT api.unfollow_record('${RECORD}')`)
    const rows = await owner.query(
      `SELECT record_id FROM api.work_item_follows`,
    )
    expect(rows.rows).toEqual([])
    await owner.query(`SELECT api.unfollow_record('${RECORD}')`)
  })
})
