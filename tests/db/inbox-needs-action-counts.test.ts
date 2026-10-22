/**
 * QA4-Home-Count — `api.inbox_needs_action_counts()` states Home's Inbox total
 * as a server-side count over every row the caller can see, seen state
 * included. A `limit=200` preview of the same read model cannot answer it: the
 * fixture below holds more waiting items than the preview returns, so a
 * preview-length number would read 200 here while the count reads all of them.
 */
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  grantProjectAccess,
  prepareTestDatabase,
  setActorJwt,
  testDatabaseName,
} from './helpers'

const WS = '00000000-0000-4000-8000-000000004a0a'
const OTHER_WS = '00000000-0000-4000-8000-000000004a0b'
const PROJECT = '00000000-0000-4000-8000-000000004a0c'
const USER = 'inbox-count-user'
const SUBMITTER = 'inbox-count-submitter'
const OUTSIDER = 'inbox-count-outsider'

/** More waiting items than `WORK_ITEMS_FETCH_LIMIT` transfers. */
const BULK = 250
/** The review items on top of the bulk, to exercise the reviews subset. */
const REVIEWS = 3

/**
 * A deterministic id per fixture row, the same expression the inserts use, so
 * a row and the Inbox item key it produces can be paired without a read.
 */
function itemId(group: string, index: number): string {
  return `00000000-0000-4000-${group}-${index.toString(16).padStart(12, '0')}`
}

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal."user" (id,name,email,"emailVerified") VALUES
      ('${USER}','Inbox owner','inbox-count-user@test.invalid',true),
      ('${SUBMITTER}','Submitter','inbox-count-submitter@test.invalid',true),
      ('${OUTSIDER}','Outsider','inbox-count-outsider@test.invalid',true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspaces (id,slug,name) VALUES
      ('${WS}','inbox-count','Inbox count'),
      ('${OTHER_WS}','inbox-count-other','Other')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id,user_id,role) VALUES
      ('${WS}','${USER}','steward'),
      ('${WS}','${SUBMITTER}','member'),
      ('${OTHER_WS}','${OUTSIDER}','owner')`,
  )
  await migrator.query(
    `INSERT INTO api.projects (id,workspace_id,key,title,lead_user_id)
     VALUES ('${PROJECT}','${WS}','inbox-count','Inbox count','${SUBMITTER}')`,
  )
  await grantProjectAccess(migrator, {
    workspaceId: WS,
    projectId: PROJECT,
    userId: USER,
    canView: true,
    canEdit: true,
  })

  // The bulk: one parser-failure work item per retained import file. Each item
  // is keyed by its source file, the same `data_issue:<source_id>` the Inbox
  // list marks seen.
  await migrator.query(
    `INSERT INTO api.dataset_import_files
       (id, workspace_id, filename, byte_size, checksum, storage_key, format,
        status, created_by_user_id, parser_failure)
     SELECT ('00000000-0000-4000-8000-' || lpad(to_hex(i), 12, '0'))::uuid,
            '${WS}', 'bulk-' || i || '.csv', 12, repeat('a', 64),
            'bulk/' || i || '.csv', 'csv', 'failed', '${USER}',
            jsonb_build_object('message', 'Missing required header',
                               'failedAt', '2026-10-01T09:00:00Z')
       FROM generate_series(1, ${BULK}) AS i`,
  )

  await migrator.query(
    `INSERT INTO internal.review_workflow_definitions (definition_key, version, definition)
     VALUES ('default-review', 1, '{"steps":[]}'::jsonb) ON CONFLICT DO NOTHING`,
  )
  await migrator.query(
    `INSERT INTO api.records
       (id, workspace_id, project_id, kind, identifier, title, status, created_by_user_id)
     SELECT ('00000000-0000-4000-9000-' || lpad(to_hex(i), 12, '0'))::uuid,
            '${WS}', '${PROJECT}', 'experiment', 'EXP-C' || i, 'Awaiting review ' || i,
            'in_progress', '${SUBMITTER}'
       FROM generate_series(1, ${REVIEWS}) AS i`,
  )
  await migrator.query(
    `INSERT INTO api.revisions
       (id, record_id, workspace_id, structure_version, metadata_version,
        metadata_snapshot, block_snapshot, integrity_digest, reason, created_by_user_id)
     SELECT ('00000000-0000-4000-a000-' || lpad(to_hex(i), 12, '0'))::uuid,
            ('00000000-0000-4000-9000-' || lpad(to_hex(i), 12, '0'))::uuid,
            '${WS}', 1, 2, '{}'::jsonb, '[]'::jsonb, repeat('b', 64),
            'submit', '${SUBMITTER}'
       FROM generate_series(1, ${REVIEWS}) AS i`,
  )
  await migrator.query(
    `INSERT INTO api.review_submissions
       (id, workspace_id, record_id, revision_id, workflow_definition_key,
        workflow_definition_version, assigned_reviewer_user_ids,
        submitted_by_user_id, submitted_session_id, submitted_role,
        submitted_at, idempotency_key)
     SELECT ('00000000-0000-4000-b000-' || lpad(to_hex(i), 12, '0'))::uuid,
            '${WS}',
            ('00000000-0000-4000-9000-' || lpad(to_hex(i), 12, '0'))::uuid,
            ('00000000-0000-4000-a000-' || lpad(to_hex(i), 12, '0'))::uuid,
            'default-review', 1, ARRAY['${USER}']::text[], '${SUBMITTER}',
            'sess', 'authenticated', now(), 'inbox-count-' || i
       FROM generate_series(1, ${REVIEWS}) AS i`,
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
  await setActorJwt(client, userId, workspaceId)
  return client
}

/**
 * The app connection the shell's server count runs on (`DATABASE_URL`): it owns
 * the tables, so it bypasses the `work_item_views` policy, and it is not the
 * `authenticated` role PostgREST switches to for the browser. The claims it
 * carries are then the only thing scoping the read, which is exactly what the
 * count has to be correct on.
 */
async function asAppConnection(userId: string): Promise<Client> {
  const url = new URL(process.env.DATABASE_URL!)
  url.pathname = `/${testDatabaseName()}`
  const client = new Client({ connectionString: url.toString() })
  await client.connect()
  clients.push(client)
  await setActorJwt(client, userId, WS)
  return client
}

interface Counts {
  total: number
  reviews: number
}

async function countsFor(client: Client): Promise<Counts> {
  const { rows } = await client.query<Counts>(
    'SELECT total, reviews FROM api.inbox_needs_action_counts()',
  )
  return rows[0]
}

describe('api.inbox_needs_action_counts', () => {
  it('counts every waiting item, past the 200-row preview the list reads', async () => {
    const user = await asAuthenticated(USER)

    // The read model holds more than the preview transfers...
    const { rows: preview } = await user.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM (SELECT 1 FROM api.my_work_items LIMIT 200) p`,
    )
    expect(preview[0].n).toBe(200)

    // ...and the count states the whole set, which a preview length cannot.
    expect(await countsFor(user)).toEqual({
      total: BULK + REVIEWS,
      reviews: REVIEWS,
    })
  })

  it('honours the caller seen state for the total and the reviews subset', async () => {
    const user = await asAuthenticated(USER)
    await user.query('SELECT api.mark_work_items_seen($1::text[])', [
      [
        `data_issue:${itemId('8000', 1)}`,
        `review_requested:${itemId('9000', 1)}`,
      ],
    ])

    // One bulk item and one review are marked seen; the review leaves the
    // reviews subset with it.
    expect(await countsFor(user)).toEqual({
      total: BULK + REVIEWS - 2,
      reviews: REVIEWS - 1,
    })
  })

  it('keeps each person seen state their own', async () => {
    const submitter = await asAuthenticated(SUBMITTER)
    await submitter.query('SELECT api.mark_work_items_seen($1::text[])', [
      [`data_issue:${itemId('8000', 2)}`],
    ])

    const user = await asAuthenticated(USER)
    expect(await countsFor(user)).toEqual({
      total: BULK + REVIEWS - 2,
      reviews: REVIEWS - 1,
    })
  })

  it('counts nothing outside the caller workspace or visibility', async () => {
    const outsider = await asAuthenticated(OUTSIDER, OTHER_WS)
    expect(await countsFor(outsider)).toEqual({ total: 0, reviews: 0 })

    // A plain member sees only items in the view that are addressed to them:
    // the bulk files were authored by someone else, and the reviews are
    // assigned to someone else.
    const submitter = await asAuthenticated(SUBMITTER)
    expect(await countsFor(submitter)).toEqual({ total: 0, reviews: 0 })
  })

  it('agrees with the predicate the list and the badge run', async () => {
    const user = await asAuthenticated(USER)
    // Restate the Inbox predicate in TypeScript over the same rows and the
    // same key expression, and check the count answers the same number.
    const { rows } = await user.query<{
      item_key: string
      kind: string
      state: string
    }>(
      `SELECT kind || ':' || coalesce(source_id::text, record_id::text,
                                     identifier, title, 'Untitled') AS item_key,
              kind, state
         FROM api.my_work_items`,
    )
    const { rows: seen } = await user.query<{ item_key: string }>(
      'SELECT item_key FROM api.work_item_views',
    )
    const seenKeys = new Set(seen.map((row) => row.item_key))
    const waiting = rows.filter(
      (row) =>
        (row.state === 'needs_action' || row.state === 'overdue') &&
        !seenKeys.has(row.item_key),
    )

    const expected = {
      total: waiting.length,
      reviews: waiting.filter(
        (row) =>
          row.kind === 'review_requested' || row.kind === 'witness_requested',
      ).length,
    }
    expect(await countsFor(user)).toEqual(expected)
  })

  it('counts the caller read state on the shell connection, whatever RLS is doing', async () => {
    const user = await asAuthenticated(USER)
    const before = await countsFor(user)

    // A colleague acknowledges an item of their own, on the same rows the two
    // people both see.
    const submitter = await asAuthenticated(SUBMITTER)
    await submitter.query('SELECT api.mark_work_items_seen($1::text[])', [
      [`data_issue:${itemId('8000', 3)}`],
    ])
    expect(await countsFor(submitter)).toEqual({ total: 0, reviews: 0 })

    // The shell's connection owns the table, so it reads every row in
    // `api.work_item_views`: with row-level security bypassed, only the
    // caller's own claims keep that acknowledgement out of this number.
    const shell = await asAppConnection(USER)
    expect(await countsFor(shell)).toEqual(before)

    // The shell count then assumes the caller's role inside its transaction,
    // which is the posture the browser's own read has. Same number.
    await shell.query('begin')
    await shell.query('set local role authenticated')
    const scoped = await countsFor(shell)
    await shell.query('commit')
    expect(scoped).toEqual(before)
  })

  it('pages all unseen actions after 210 seen items, with following isolated and exact counts', async () => {
    const user = await asAuthenticated(USER)
    await user.query('BEGIN')
    try {
      await user.query('SELECT api.mark_work_items_seen($1::text[])', [
        Array.from(
          { length: 210 },
          (_, i) => `data_issue:${itemId('8000', i + 1)}`,
        ),
      ])
      // Add enough unseen work to require several pages, with equal dates so
      // the stable identity tie-breaker is necessary to visit every item once.
      await migrator.query(`INSERT INTO api.dataset_import_files
        (id,workspace_id,filename,byte_size,checksum,storage_key,format,status,created_by_user_id,parser_failure,created_at)
        SELECT ('00000000-0000-4000-c000-'||lpad(to_hex(i),12,'0'))::uuid,
          '${WS}','page-'||i||'.csv',12,repeat('a',64),'page/'||i,'csv','failed','${USER}',
          '{"message":"Page regression","failedAt":"2026-10-01T09:00:00Z"}'::jsonb,'2026-10-01T09:00:00Z'
        FROM generate_series(1,300) i`)
      await migrator.query(`INSERT INTO api.records (id,workspace_id,project_id,kind,identifier,title,status,created_by_user_id)
        SELECT ('00000000-0000-4000-d000-'||lpad(to_hex(i),12,'0'))::uuid,'${WS}','${PROJECT}',
          'sample','SMP-PAGE-'||i,'Following sample '||i,'available','${USER}' FROM generate_series(1,5) i`)
      await migrator.query(`INSERT INTO api.work_item_follows(workspace_id,user_id,record_id)
        SELECT '${WS}','${USER}',id FROM api.records WHERE identifier LIKE 'SMP-PAGE-%'`)
      const keys: string[] = []
      for (let offset = 0; offset < 342; offset += 100) {
        const page = (
          await user.query(
            'SELECT api.inbox_work_items_page($1,$2,100,$3) result',
            ['needs-action', null, offset],
          )
        ).rows[0].result
        expect(page.total).toBe(342)
        expect(page.tabs).toEqual({
          'needs-action': 342,
          'done-today': 211,
          following: 5,
        })
        expect(page.types).toEqual({ data: 340, reviews: 2 })
        keys.push(
          ...page.items.map((item: { item_key: string }) => item.item_key),
        )
      }
      expect(keys).toHaveLength(342)
      expect(new Set(keys).size).toBe(342)
      expect(keys).toContain(`data_issue:${itemId('8000', 250)}`)
      expect(keys).not.toContain(`data_issue:${itemId('8000', 210)}`)
      const reviews = (
        await user.query(
          "SELECT api.inbox_work_items_page('needs-action','reviews',1,0) result",
        )
      ).rows[0].result
      expect(reviews.total).toBe(2)
      expect(reviews.items).toHaveLength(1)
      expect(reviews.items[0].kind).toBe('review_requested')
      expect(await countsFor(user)).toEqual({ total: 342, reviews: 2 })
      await user.query('SELECT api.mark_work_items_seen($1::text[])', [keys])
      const empty = (
        await user.query('SELECT api.inbox_work_items_page() result')
      ).rows[0].result
      expect(empty.items).toEqual([])
      expect(empty.total).toBe(0)
      expect(await countsFor(user)).toEqual({ total: 0, reviews: 0 })
      const outsider = await asAuthenticated(OUTSIDER, OTHER_WS)
      expect(
        (await outsider.query('SELECT api.inbox_work_items_page() result'))
          .rows[0].result.total,
      ).toBe(0)
    } finally {
      await user.query('ROLLBACK')
      await migrator.query(
        `DELETE FROM api.dataset_import_files WHERE workspace_id='${WS}' AND storage_key LIKE 'page/%'`,
      )
      await migrator.query(`DELETE FROM api.work_item_follows WHERE workspace_id='${WS}' AND record_id IN
        (SELECT id FROM api.records WHERE identifier LIKE 'SMP-PAGE-%')`)
      await migrator.query(
        `DELETE FROM api.records WHERE workspace_id='${WS}' AND identifier LIKE 'SMP-PAGE-%'`,
      )
    }
  })
})
