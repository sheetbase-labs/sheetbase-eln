/**
 * Account basics: following (projects, auto-follow on comment or mention,
 * follower notifications), the lab logo's admin-only writes, and leaving a
 * workspace with its guards.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  expectDenied,
  grantProjectAccess,
  prepareTestDatabase,
} from './helpers'

const WS = '00000000-0000-4000-8000-00000000a501'
const OTHER_WS = '00000000-0000-4000-8000-00000000a502'
const PROJECT = '00000000-0000-4000-8000-00000000a503'
const RECORD = '00000000-0000-4000-8000-00000000a504'
const OWNER = 'ab-owner'
const MEMBER = 'ab-member'
const MENTIONED = 'ab-mentioned'
const FOLLOWER = 'ab-follower'
const STRANGER = 'ab-stranger'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function as(userId: string, workspaceId = WS): Promise<Client> {
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

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  for (const id of [OWNER, MEMBER, MENTIONED, FOLLOWER, STRANGER]) {
    await migrator.query(
      `INSERT INTO internal."user" (id, name, email, "emailVerified")
       VALUES ($1, $1, $1 || '@ab.test', true)`,
      [id],
    )
  }
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES
      ('${WS}', 'ab-ws', 'AB workspace'), ('${OTHER_WS}', 'ab-other', 'AB other')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS}', '${OWNER}', 'owner'),
      ('${WS}', '${MEMBER}', 'member'),
      ('${WS}', '${MENTIONED}', 'member'),
      ('${WS}', '${FOLLOWER}', 'member'),
      ('${OTHER_WS}', '${OWNER}', 'owner'),
      ('${OTHER_WS}', '${MEMBER}', 'owner')`,
  )
  await migrator.query(
    `INSERT INTO api.projects (id, workspace_id, key, title, display_id, lead_user_id)
     VALUES ('${PROJECT}', '${WS}', 'ab-project', 'AB project', 'PRJ-9001', '${OWNER}')`,
  )
  // A project is private to its lead until someone is given access.
  for (const userId of [MEMBER, MENTIONED, FOLLOWER]) {
    await grantProjectAccess(migrator, {
      workspaceId: WS,
      projectId: PROJECT,
      userId,
    })
  }
  await migrator.query(
    `INSERT INTO api.records (id, workspace_id, project_id, kind, identifier, title, created_by_user_id)
     VALUES ('${RECORD}', '${WS}', '${PROJECT}', 'experiment', 'EXP-A1', 'AB record', '${OWNER}')`,
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

describe('following a project', () => {
  it('follows, lists in the Inbox as a Following row, and unfollows', async () => {
    const member = await as(MEMBER)
    await member.query(`SELECT api.follow_project('${PROJECT}')`)
    // Following twice is harmless.
    await member.query(`SELECT api.follow_project('${PROJECT}')`)
    const rows = await member.query(
      `SELECT project_id FROM api.project_follows`,
    )
    expect(rows.rows).toEqual([{ project_id: PROJECT }])

    const inbox = await member.query(
      `SELECT kind, state, identifier, title, project_id
         FROM api.my_work_items WHERE kind = 'project_following'`,
    )
    expect(inbox.rows).toEqual([
      {
        kind: 'project_following',
        state: 'following',
        identifier: 'PRJ-9001',
        title: 'AB project',
        project_id: PROJECT,
      },
    ])

    await member.query(`SELECT api.unfollow_project('${PROJECT}')`)
    const after = await member.query(
      `SELECT 1 FROM api.my_work_items WHERE kind = 'project_following'`,
    )
    expect(after.rows).toEqual([])
  })

  it('is invisible to another person and refused to a stranger', async () => {
    const member = await as(MEMBER)
    await member.query(`SELECT api.follow_project('${PROJECT}')`)
    const owner = await as(OWNER)
    const seen = await owner.query(`SELECT 1 FROM api.project_follows`)
    expect(seen.rows).toEqual([])
    const stranger = await as(STRANGER)
    await expectDenied(
      stranger.query(`SELECT api.follow_project('${PROJECT}')`),
      '42501',
    )
    await member.query(`SELECT api.unfollow_project('${PROJECT}')`)
  })
})

describe('comments follow the record', () => {
  it('follows the author and anyone mentioned, and tells other followers', async () => {
    await migrator.query(
      `INSERT INTO api.work_item_follows (workspace_id, user_id, record_id)
       VALUES ('${WS}', '${FOLLOWER}', '${RECORD}')`,
    )
    const commenter = await as(MEMBER)
    await commenter.query(
      `SELECT api.create_record_comment($1, 'record', '{}'::jsonb, 'Looks good', $2::text[])`,
      [RECORD, [MENTIONED]],
    )
    const follows = await migrator.query<{ user_id: string }>(
      `SELECT user_id FROM api.work_item_follows
        WHERE record_id = '${RECORD}' ORDER BY user_id`,
    )
    expect(follows.rows.map((row) => row.user_id)).toEqual([
      FOLLOWER,
      MEMBER,
      MENTIONED,
    ])

    const notices = await migrator.query<{ user_id: string; title: string }>(
      `SELECT user_id, title FROM internal.notifications
        WHERE record_id = '${RECORD}' AND event_type = 'comment_or_mention'
        ORDER BY user_id`,
    )
    // The follower hears; the author does not; the owner and the mentioned
    // person are told by the existing comment notices, once.
    expect(
      notices.rows.filter((row) => row.title.includes('you follow')),
    ).toEqual([
      { user_id: FOLLOWER, title: 'New comment on a record you follow' },
    ])
    expect(notices.rows.some((row) => row.user_id === MEMBER)).toBe(false)
    expect(
      notices.rows.filter((row) => row.user_id === MENTIONED),
    ).toHaveLength(1)
  })
})

describe('lab logo', () => {
  const KEY = `logos/${WS}/${'a'.repeat(32)}`

  it('lets an owner set and clear it, and refuses a member', async () => {
    const member = await as(MEMBER)
    await expectDenied(
      member.query(`SELECT api.set_workspace_logo($1, $2, 'image/png')`, [
        WS,
        KEY,
      ]),
      '42501',
    )
    const owner = await as(OWNER)
    const first = await owner.query<{ previous: string | null }>(
      `SELECT api.set_workspace_logo($1, $2, 'image/png') AS previous`,
      [WS, KEY],
    )
    expect(first.rows[0]?.previous).toBeNull()

    // Every member of the workspace can read where it is kept.
    const seen = await member.query(
      `SELECT storage_key, media_type FROM api.workspace_logo()`,
    )
    expect(seen.rows).toEqual([{ storage_key: KEY, media_type: 'image/png' }])

    const cleared = await owner.query<{ previous: string }>(
      `SELECT api.clear_workspace_logo($1) AS previous`,
      [WS],
    )
    expect(cleared.rows[0]?.previous).toBe(KEY)
    const gone = await member.query(`SELECT 1 FROM api.workspace_logo()`)
    expect(gone.rows).toEqual([])
  })

  it('only keeps a key that names its own workspace', async () => {
    const owner = await as(OWNER)
    await expect(
      owner.query(`SELECT api.set_workspace_logo($1, $2, 'image/png')`, [
        WS,
        `logos/${OTHER_WS}/${'b'.repeat(32)}`,
      ]),
    ).rejects.toThrow()
  })
})

describe('leaving a workspace', () => {
  it('refuses the last owner', async () => {
    const owner = await as(OWNER)
    await expectDenied(
      owner.query(`SELECT api.leave_workspace('${WS}')`),
      'SB051',
    )
  })

  it('refuses leaving the only workspace', async () => {
    const mentioned = await as(MENTIONED)
    await expectDenied(
      mentioned.query(`SELECT api.leave_workspace('${WS}')`),
      'SB400',
    )
  })

  it('removes the membership and the follows of a member with somewhere else to be', async () => {
    await migrator.query(
      `INSERT INTO api.workspace_memberships (workspace_id, user_id, role)
       VALUES ('${OTHER_WS}', '${MEMBER}', 'member')
       ON CONFLICT DO NOTHING`,
    )
    const member = await as(MEMBER)
    await member.query(`SELECT api.follow_project('${PROJECT}')`)
    await member.query(`SELECT api.leave_workspace('${WS}')`)
    const left = await migrator.query(
      `SELECT 1 FROM api.workspace_memberships
        WHERE workspace_id = '${WS}' AND user_id = '${MEMBER}'`,
    )
    expect(left.rows).toEqual([])
    const follows = await migrator.query(
      `SELECT 1 FROM api.project_follows WHERE user_id = '${MEMBER}'
       UNION ALL SELECT 1 FROM api.work_item_follows
        WHERE user_id = '${MEMBER}' AND workspace_id = '${WS}'`,
    )
    expect(follows.rows).toEqual([])
  })

  it('lets an owner go once another owner exists', async () => {
    await migrator.query(
      `UPDATE api.workspace_memberships SET role = 'owner'
        WHERE workspace_id = '${WS}' AND user_id = '${FOLLOWER}'`,
    )
    const owner = await as(OWNER)
    await owner.query(`SELECT api.leave_workspace('${WS}')`)
    const left = await migrator.query(
      `SELECT 1 FROM api.workspace_memberships
        WHERE workspace_id = '${WS}' AND user_id = '${OWNER}'`,
    )
    expect(left.rows).toEqual([])
  })
})
