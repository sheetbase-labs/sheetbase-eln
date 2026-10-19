/**
 * Phase 6 (bench): comments on a live notebook, with no review and no
 * collaboration room.
 *
 * Proves, against a freshly migrated sheetbase_test database:
 *  - a writer can start a thread on a notebook and on one of its blocks;
 *  - a reply, a resolve and a reopen work on those threads;
 *  - a block that belongs to another notebook, an unknown anchor kind, and an
 *    empty body are refused;
 *  - a viewer cannot comment, and nobody can comment on an archived notebook;
 *  - only workspace members survive as mentions, and each person named gets one
 *    comment_or_mention notification (never the author).
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { grantProjectAccess, prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-0000000491aa'
const PROJ = '00000000-0000-4000-8000-0000000491ab'
const NOTEBOOK = '00000000-0000-4000-8000-0000000491ac'
const OTHER_NOTEBOOK = '00000000-0000-4000-8000-0000000491ad'
const ARCHIVED_NOTEBOOK = '00000000-0000-4000-8000-0000000491ae'
const BLOCK = '00000000-0000-4000-8000-0000000491af'
const OTHER_BLOCK = '00000000-0000-4000-8000-0000000491b0'
const AUTHOR = 'live491-author'
const COLLEAGUE = 'live491-colleague'
const VIEWER = 'live491-viewer'
const OUTSIDER = 'live491-outsider'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function as(userId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query("SELECT set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: userId, workspace_id: WS, role: 'authenticated' }),
  ])
  return client
}

async function comment(
  client: Client,
  recordId: string,
  kind: string,
  target: Record<string, unknown>,
  body: string,
  mentions: string[] = [],
): Promise<Record<string, any>> {
  const { rows } = await client.query(
    `SELECT api.create_record_comment($1, $2, $3::jsonb, $4, $5::text[]) AS result`,
    [recordId, kind, JSON.stringify(target), body, mentions],
  )
  return rows[0].result
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
      ('${AUTHOR}', 'Author', 'live491-author@sheetbase.test', true),
      ('${COLLEAGUE}', 'Colleague', 'live491-colleague@sheetbase.test', true),
      ('${VIEWER}', 'Viewer', 'live491-viewer@sheetbase.test', true),
      ('${OUTSIDER}', 'Outsider', 'live491-outsider@sheetbase.test', true);
     INSERT INTO api.workspaces (id, slug, name) VALUES ('${WS}', 'live491', 'Live 491');
     INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS}', '${AUTHOR}', 'owner'),
      ('${WS}', '${COLLEAGUE}', 'member'),
      ('${WS}', '${VIEWER}', 'viewer');
     INSERT INTO api.projects (id, workspace_id, key, title, lead_user_id)
      VALUES ('${PROJ}', '${WS}', 'live491', 'Live 491', '${AUTHOR}')`,
  )
  await grantProjectAccess(migrator, {
    workspaceId: WS,
    projectId: PROJ,
    userId: VIEWER,
    canView: true,
    canEdit: false,
  })
  await grantProjectAccess(migrator, {
    workspaceId: WS,
    projectId: PROJ,
    userId: COLLEAGUE,
    canView: true,
    canEdit: true,
  })
  await migrator.query(
    `INSERT INTO api.records
       (id, workspace_id, project_id, kind, identifier, title, status, created_by_user_id)
     VALUES
       ('${NOTEBOOK}', '${WS}', '${PROJ}', 'experiment', 'EXP-L491-1', 'Notebook one', 'in_progress', '${AUTHOR}'),
       ('${OTHER_NOTEBOOK}', '${WS}', '${PROJ}', 'experiment', 'EXP-L491-2', 'Notebook two', 'in_progress', '${AUTHOR}'),
       ('${ARCHIVED_NOTEBOOK}', '${WS}', '${PROJ}', 'experiment', 'EXP-L491-3', 'Notebook three', 'in_progress', '${AUTHOR}')`,
  )
  await migrator.query(
    `INSERT INTO api.blocks (id, record_id, type, payload, "order", created_by_user_id) VALUES
      ('${BLOCK}', '${NOTEBOOK}', 'rich_text', '{}', 100, '${AUTHOR}'),
      ('${OTHER_BLOCK}', '${OTHER_NOTEBOOK}', 'rich_text', '{}', 100, '${AUTHOR}')`,
  )
  await migrator.query(
    `UPDATE api.records SET archived_at = now() WHERE id = '${ARCHIVED_NOTEBOOK}'`,
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

describe('create_record_comment', () => {
  it('starts a thread on the notebook and on one of its blocks', async () => {
    const author = await as(AUTHOR)
    const whole = await comment(
      author,
      NOTEBOOK,
      'record',
      {},
      'Whole notebook',
    )
    expect(whole.revisionId).toBeNull()
    expect(whole.rootId).toBe(whole.id)
    const block = await comment(
      author,
      NOTEBOOK,
      'block',
      { blockId: BLOCK },
      'This block',
    )
    expect(block.target.blockId).toBe(BLOCK)

    const { rows } = await author.query(
      `SELECT id, target_kind FROM api.record_comments($1) ORDER BY created_at`,
      [NOTEBOOK],
    )
    expect(rows.map((r) => r.target_kind)).toEqual(['record', 'block'])
  })

  it('lets a colleague reply, resolve and reopen', async () => {
    const author = await as(AUTHOR)
    const root = await comment(author, NOTEBOOK, 'record', {}, 'Please check')
    const colleague = await as(COLLEAGUE)
    const { rows: reply } = await colleague.query(
      `SELECT api.reply_to_comment($1, 'Checked', ARRAY[]::text[]) AS result`,
      [root.id],
    )
    expect(reply[0].result.parentId).toBe(root.id)
    expect(reply[0].result.rootId).toBe(root.id)

    const resolved = await colleague.query(
      `SELECT api.resolve_comment_thread($1) AS result`,
      [root.id],
    )
    expect(resolved.rows[0].result.state).toBe('resolved')
    const reopened = await colleague.query(
      `SELECT api.reopen_comment_thread($1) AS result`,
      [root.id],
    )
    expect(reopened.rows[0].result.state).toBe('open')
  })

  it('refuses a foreign block, an unknown anchor and an empty body', async () => {
    const author = await as(AUTHOR)
    await expect(
      comment(author, NOTEBOOK, 'block', { blockId: OTHER_BLOCK }, 'Wrong'),
    ).rejects.toMatchObject({ code: 'SB002' })
    await expect(
      comment(author, NOTEBOOK, 'diff', {}, 'Wrong kind'),
    ).rejects.toMatchObject({ code: '22023' })
    await expect(
      comment(author, NOTEBOOK, 'record', {}, ''),
    ).rejects.toMatchObject({ code: '22023' })
  })

  it('refuses a viewer and an archived notebook', async () => {
    const viewer = await as(VIEWER)
    await expect(
      comment(viewer, NOTEBOOK, 'record', {}, 'Viewer comment'),
    ).rejects.toMatchObject({ code: '42501' })
    const author = await as(AUTHOR)
    await expect(
      comment(author, ARCHIVED_NOTEBOOK, 'record', {}, 'On archived'),
    ).rejects.toMatchObject({ code: 'SB004' })
  })

  it('keeps only workspace members as mentions and notifies each once', async () => {
    const author = await as(AUTHOR)
    const created = await comment(
      author,
      NOTEBOOK,
      'record',
      {},
      '@Colleague can you look?',
      [COLLEAGUE, OUTSIDER, AUTHOR, COLLEAGUE],
    )
    expect(created.mentions).toEqual([AUTHOR, COLLEAGUE].sort())

    const { rows } = await migrator.query(
      `SELECT user_id, title FROM internal.notifications
        WHERE event_type = 'comment_or_mention' AND record_id = $1
          AND title = 'You were mentioned in a comment'
        ORDER BY user_id`,
      [NOTEBOOK],
    )
    // The author is never notified of their own comment; the outsider is not a
    // member so was dropped before the event; the colleague is told once.
    expect(rows.map((r) => r.user_id)).toEqual([COLLEAGUE])
  })
})
