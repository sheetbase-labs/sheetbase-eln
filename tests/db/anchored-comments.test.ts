/**
 * REV-004 database contract: anchored comments on immutable revisions with
 * replies, resolution, workspace isolation, anchoring stability, live events
 * and honest departed-user rendering.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS_A = '95000000-0000-4000-8000-000000000001'
const WS_B = '95000000-0000-4000-8000-000000000002'
const PROJECT_A = '96000000-0000-4000-8000-000000000001'
const PROJECT_B = '96000000-0000-4000-8000-000000000002'
const RECORD_A = '97000000-0000-4000-8000-000000000001'
const RECORD_B = '97000000-0000-4000-8000-000000000002'
const BLOCK_A_ID = '98000000-0000-4000-8000-000000000001'
const OWNER_A = 'rev4-owner-a'
const REVIEWER_A = 'rev4-reviewer-a'
const COMMENTER_A = 'rev4-commenter-a'
const OWNER_B = 'rev4-owner-b'

let migrator: Client | undefined
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

function claims(
  userId: string,
  workspaceId: string,
  clientId?: string,
): string {
  const base: Record<string, unknown> = {
    sub: userId,
    workspace_id: workspaceId,
    role: 'authenticated',
    session_id: `session-${userId}`,
  }
  if (clientId) base.client_id = clientId
  return JSON.stringify(base)
}

async function asUser(
  userId: string,
  workspaceId: string,
  clientId?: string,
): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query(`SELECT set_config('request.jwt.claims', $1, false)`, [
    claims(userId, workspaceId, clientId),
  ])
  return client
}

async function preview(client: Client, recordId = RECORD_A) {
  const { rows } = await client.query(
    `SELECT api.preview_submission_digest($1) AS result`,
    [recordId],
  )
  return rows[0].result as { sourceDigest: string }
}

async function submit(
  client: Client,
  sourceDigest: string,
  idempotencyKey: string,
  recordId = RECORD_A,
) {
  // An open comment thread blocks submission (EXP-02.1), so a fixture that has
  // been anchoring comments resolves them before it submits again.
  await migrator!.query(
    `UPDATE api.comments SET state='resolved', resolved_at=now(), resolved_by_user_id=$2
      WHERE record_id=$1 AND state='open'`,
    [recordId, OWNER_A],
  )
  const { rows } = await client.query(
    `SELECT api.submit_record_revision(
       $1, $2, 'default-scientific-review', 1, ARRAY[$3]::text[], true, $4
     ) AS result`,
    [recordId, sourceDigest, REVIEWER_A, idempotencyKey],
  )
  return rows[0].result as {
    revision: { id: string; integrityDigest: string }
    submission: { id: string; state: string }
    idempotent: boolean
  }
}

async function createComment(
  client: Client,
  revisionId: string,
  targetKind: string,
  target: Record<string, unknown>,
  body: string,
  mentions: string[] = [],
) {
  const { rows } = await client.query(
    `SELECT api.create_comment($1, $2, $3::jsonb, $4, $5::text[]) AS result`,
    [revisionId, targetKind, JSON.stringify(target), body, mentions],
  )
  return rows[0].result as {
    id: string
    rootId: string
    parentId: string | null
    targetKind: string
    state: string
    authorUserId: string | null
  }
}

async function reply(
  client: Client,
  parentId: string,
  body: string,
  mentions: string[] = [],
) {
  const { rows } = await client.query(
    `SELECT api.reply_to_comment($1, $2, $3::text[]) AS result`,
    [parentId, body, mentions],
  )
  return rows[0].result as {
    id: string
    rootId: string
    parentId: string
    state: string
  }
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())

  await migrator!.query(
    `INSERT INTO internal."user" (id,name,email,"emailVerified") VALUES
       ($1,'Owner A','owner-a@rev4.test',true),
       ($2,'Reviewer A','reviewer-a@rev4.test',true),
       ($3,'Commenter A','commenter-a@rev4.test',true),
       ($4,'Owner B','owner-b@rev4.test',true)`,
    [OWNER_A, REVIEWER_A, COMMENTER_A, OWNER_B],
  )
  // Exploratory review still requires a genuine active session, but no author
  // signing grant. Keep these tests on their original default workflow.
  for (const userId of [OWNER_A, REVIEWER_A, COMMENTER_A, OWNER_B]) {
    await migrator!.query(
      `INSERT INTO internal.session(id,token,"userId","expiresAt") VALUES($1,$1,$2,now()+interval '1 hour')`,
      [`session-${userId}`, userId],
    )
  }
  await migrator!.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES
       ($1,'rev4-a','Revision4 A'),($2,'rev4-b','Revision4 B')`,
    [WS_A, WS_B],
  )
  await migrator!.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES
       ($1,$2,'owner'),($1,$3,'member'),($1,$4,'member'),($5,$6,'owner')`,
    [WS_A, OWNER_A, REVIEWER_A, COMMENTER_A, WS_B, OWNER_B],
  )
  await migrator!.query(
    `INSERT INTO api.projects(id,workspace_id,key,title) VALUES
       ($1,$2,'R4A','Revision4 A'),($3,$4,'R4B','Revision4 B')`,
    [PROJECT_A, WS_A, PROJECT_B, WS_B],
  )
  // Workspace roles alone are not project assignments. Give each participant
  // only the explicit rights this comment/review fixture exercises.
  await migrator!.query(
    `INSERT INTO api.project_access(workspace_id,project_id,user_id,can_view,can_edit,can_review,can_manage,granted_by_user_id) VALUES
       ($1,$2,$3,true,true,true,true,$3),($1,$2,$4,true,false,true,false,$3),
       ($1,$2,$5,true,false,false,false,$3),($6,$7,$8,true,true,true,true,$8)`,
    [
      WS_A,
      PROJECT_A,
      OWNER_A,
      REVIEWER_A,
      COMMENTER_A,
      WS_B,
      PROJECT_B,
      OWNER_B,
    ],
  )
  await migrator!.query(
    `INSERT INTO api.records
       (id,workspace_id,project_id,kind,identifier,title,status,created_by_user_id)
     VALUES
       ($1,$2,$3,'experiment','EXP-R4-A','Anchored experiment','in_progress',$4),
       ($5,$6,$7,'experiment','EXP-R4-B','Other workspace','in_progress',$8)`,
    [RECORD_A, WS_A, PROJECT_A, OWNER_A, RECORD_B, WS_B, PROJECT_B, OWNER_B],
  )
  await migrator!.query(
    `INSERT INTO api.blocks(id,record_id,type,payload,"order",created_by_user_id)
     VALUES ($1,$2,'rich_text','{"doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Stable block"}]}]}}',100,$3)`,
    [BLOCK_A_ID, RECORD_A, OWNER_A],
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator?.end()
})

async function latestRevisionId(client: Client): Promise<string> {
  const { rows } = await client.query(
    `SELECT id FROM api.revisions ORDER BY created_at DESC LIMIT 1`,
  )
  return rows[0].id as string
}

async function changeEventsFor(
  client: Client,
  entityType: string,
): Promise<
  Array<{
    operation: string
    entity_uuid: string
    payload: Record<string, unknown>
  }>
> {
  const { rows } = await client.query(
    `SELECT operation, entity_uuid, payload FROM api.change_events
     WHERE entity_type = $1 ORDER BY sequence ASC`,
    [entityType],
  )
  return rows as Array<{
    operation: string
    entity_uuid: string
    payload: Record<string, unknown>
  }>
}

describe('REV-004 anchored comments contract', () => {
  it('creates a comment anchored to a revision target and emits a change event', async () => {
    const owner = await asUser(OWNER_A, WS_A)
    const source = await preview(owner)
    const submitted = await submit(owner, source.sourceDigest, 'rev4-base')
    const revisionId = submitted.revision.id

    const created = await createComment(
      owner,
      revisionId,
      'revision',
      {},
      'Looks good overall',
    )
    expect(created.id).toBeTruthy()
    expect(created.rootId).toBe(created.id)
    expect(created.parentId).toBeNull()
    expect(created.state).toBe('open')
    expect(created.authorUserId).toBe(OWNER_A)

    const { rows } = await owner.query(
      `SELECT target_kind, target, body, state, author_user_id, root_id, parent_id
       FROM api.comments WHERE id = $1`,
      [created.id],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      target_kind: 'revision',
      state: 'open',
      author_user_id: OWNER_A,
      parent_id: null,
    })
    expect(rows[0].root_id).toBe(created.id)

    const events = await changeEventsFor(owner, 'comment')
    expect(events.length).toBeGreaterThanOrEqual(1)
    const createEvent = events.find((e) => e.entity_uuid === created.id)
    expect(createEvent).toBeDefined()
    expect(createEvent!.operation).toBe('create')
    expect(createEvent!.payload).toMatchObject({
      revisionId,
      threadRootId: created.id,
      targetKind: 'revision',
      state: 'open',
    })
  })

  it('anchors a comment to a block by stable snapshot id', async () => {
    const owner = await asUser(OWNER_A, WS_A)
    const revisionId = await latestRevisionId(owner)
    const created = await createComment(
      owner,
      revisionId,
      'block',
      {
        blockId: BLOCK_A_ID,
      },
      'Question about this block',
    )
    expect(created.id).toBeTruthy()

    const { rows } = await owner.query(
      `SELECT target->>'blockId' block_id FROM api.comments WHERE id = $1`,
      [created.id],
    )
    expect(rows[0].block_id).toBe(BLOCK_A_ID)
  })

  it('rejects a block target that is not present in the revision snapshot', async () => {
    const owner = await asUser(OWNER_A, WS_A)
    const revisionId = await latestRevisionId(owner)
    await expect(
      createComment(
        owner,
        revisionId,
        'block',
        {
          blockId: '00000000-0000-0000-0000-0000000000ff',
        },
        'Anchored to a ghost',
      ),
    ).rejects.toMatchObject({ code: 'SB002' })
  })

  it('rejects a table_region target absent from the snapshot', async () => {
    const owner = await asUser(OWNER_A, WS_A)
    const revisionId = await latestRevisionId(owner)
    await expect(
      createComment(
        owner,
        revisionId,
        'table_region',
        {
          tableId: '00000000-0000-4000-8000-0000000000aa',
        },
        'On a missing table',
      ),
    ).rejects.toMatchObject({ code: 'SB002' })
  })

  it('anchors a diff comment to a comparison revision in the same record', async () => {
    const owner = await asUser(OWNER_A, WS_A)
    const source = await preview(owner)
    const second = await submit(owner, source.sourceDigest, 'rev4-second')
    const first = await latestRevisionId(owner)
    // Submit again to get a stable comparison revision distinct from the latest.
    const third = await submit(owner, source.sourceDigest, 'rev4-third')
    const latest = third.revision.id

    const created = await createComment(
      owner,
      latest,
      'diff',
      {
        comparisonRevisionId: first,
        changeId: 'metadata:record:title:modified',
        area: 'metadata',
        identity: 'record',
      },
      'This title diff needs review',
    )
    expect(created.id).toBeTruthy()
    const { rows } = await owner.query(
      `SELECT target->>'comparisonRevisionId' cmp, target->>'changeId' chg
       FROM api.comments WHERE id = $1`,
      [created.id],
    )
    expect(rows[0].cmp).toBe(first)
    expect(rows[0].chg).toBe('metadata:record:title:modified')
    // second revision id is referenced indirectly; keep it used to avoid
    // a linter unused-variable complaint while documenting the chain.
    expect(second.revision.id).not.toBe(latest)
  })

  it('rejects a diff comparison revision from another record/workspace', async () => {
    const ownerB = await asUser(OWNER_B, WS_B)
    const sourceB = await preview(ownerB, RECORD_B)
    const submittedB = await ownerB.query(
      `SELECT api.submit_record_revision(
         $1, $2, 'default-scientific-review', 1, ARRAY[$3]::text[], true, $4
       ) AS result`,
      [RECORD_B, sourceB.sourceDigest, OWNER_B, 'rev4-cross'],
    )
    const otherRevisionId = (
      submittedB.rows[0].result as {
        revision: { id: string }
      }
    ).revision.id
    const owner = await asUser(OWNER_A, WS_A)
    const revisionId = await latestRevisionId(owner)
    await expect(
      createComment(
        owner,
        revisionId,
        'diff',
        {
          comparisonRevisionId: otherRevisionId,
          changeId: 'metadata:record:title:modified',
        },
        'Cross-workspace diff',
      ),
    ).rejects.toMatchObject({ code: 'SB002' })
  })

  it('keeps a comment anchored after later draft edits move the live block', async () => {
    const owner = await asUser(OWNER_A, WS_A)
    const revisionId = await latestRevisionId(owner)
    const created = await createComment(
      owner,
      revisionId,
      'block',
      {
        blockId: BLOCK_A_ID,
      },
      'Anchored before live drift',
    )

    // Later draft edit: delete the live block and add a new one.
    await owner.query(`DELETE FROM api.blocks WHERE id = $1`, [BLOCK_A_ID])

    const { rows } = await owner.query(
      `SELECT target->>'blockId' block_id, revision_id
       FROM api.comments WHERE id = $1`,
      [created.id],
    )
    expect(rows[0].block_id).toBe(BLOCK_A_ID)
    expect(rows[0].revision_id).toBe(revisionId)
    // The block still exists in the immutable revision snapshot.
    const snap = await owner.query(
      `SELECT EXISTS(
         SELECT 1 FROM jsonb_array_elements(canonical_snapshot->'blocks') b
         WHERE b->>'id' = $2
       ) present FROM api.revisions WHERE id = $1`,
      [revisionId, BLOCK_A_ID],
    )
    expect(snap.rows[0].present).toBe(true)
  })

  it('supports replies that inherit the thread root and anchor', async () => {
    const owner = await asUser(OWNER_A, WS_A)
    const reviewer = await asUser(REVIEWER_A, WS_A)
    const revisionId = await latestRevisionId(owner)
    const root = await createComment(
      owner,
      revisionId,
      'revision',
      {},
      'Thread root',
    )
    const reply1 = await reply(reviewer, root.id, 'Reply from reviewer', [
      OWNER_A,
    ])
    expect(reply1.rootId).toBe(root.id)
    expect(reply1.parentId).toBe(root.id)
    expect(reply1.state).toBe('open')

    const reply2 = await reply(owner, reply1.id, 'Nested reply')
    expect(reply2.rootId).toBe(root.id)
    expect(reply2.parentId).toBe(reply1.id)

    const { rows } = await owner.query(
      `SELECT id, root_id, parent_id, mentions FROM api.comments
       WHERE root_id = $1 ORDER BY created_at ASC`,
      [root.id],
    )
    expect(rows).toHaveLength(3)
    expect(rows[0].id).toBe(root.id)
    expect(rows[1].mentions).toEqual([OWNER_A])
  })

  it('normalises mentions to workspace members only', async () => {
    const owner = await asUser(OWNER_A, WS_A)
    const revisionId = await latestRevisionId(owner)
    const created = await createComment(
      owner,
      revisionId,
      'revision',
      {},
      'Mentioning people',
      [REVIEWER_A, OWNER_B, 'unknown-user'],
    )
    const { rows } = await owner.query(
      `SELECT mentions FROM api.comments WHERE id = $1`,
      [created.id],
    )
    // OWNER_B and unknown-user are not members of WS_A; only REVIEWER_A kept.
    expect(rows[0].mentions).toEqual([REVIEWER_A])
  })

  it('resolves and reopens a thread at the root, emitting state events', async () => {
    const owner = await asUser(OWNER_A, WS_A)
    const reviewer = await asUser(REVIEWER_A, WS_A)
    const revisionId = await latestRevisionId(owner)
    const root = await createComment(
      owner,
      revisionId,
      'revision',
      {},
      'Resolve me',
    )
    await reply(reviewer, root.id, 'Agreed, resolving')

    const resolved = await owner.query(
      `SELECT api.resolve_comment_thread($1) AS result`,
      [root.id],
    )
    expect(resolved.rows[0].result.state).toBe('resolved')
    expect(resolved.rows[0].result.resolvedByUserId).toBe(OWNER_A)

    const { rows } = await owner.query(
      `SELECT state, resolved_at, resolved_by_user_id FROM api.comments WHERE id = $1`,
      [root.id],
    )
    expect(rows[0].state).toBe('resolved')
    expect(rows[0].resolved_by_user_id).toBe(OWNER_A)
    expect(rows[0].resolved_at).toBeInstanceOf(Date)

    // Reopening via a reply id resolves the thread root.
    const reopened = await reviewer.query(
      `SELECT api.reopen_comment_thread($1) AS result`,
      [root.id],
    )
    expect(reopened.rows[0].result.state).toBe('open')

    const events = await changeEventsFor(owner, 'comment')
    const rootEvents = events.filter((e) => e.entity_uuid === root.id)
    expect(rootEvents.map((e) => e.operation)).toEqual(
      expect.arrayContaining(['create', 'resolve', 'reopen']),
    )
  })

  it('rejects resolving an already-resolved thread and reopening an open one', async () => {
    const owner = await asUser(OWNER_A, WS_A)
    const revisionId = await latestRevisionId(owner)
    const root = await createComment(owner, revisionId, 'revision', {}, 'Edge')
    await owner.query(`SELECT api.resolve_comment_thread($1)`, [root.id])
    await expect(
      owner.query(`SELECT api.resolve_comment_thread($1)`, [root.id]),
    ).rejects.toMatchObject({ code: 'SB003' })
    await owner.query(`SELECT api.reopen_comment_thread($1)`, [root.id])
    await expect(
      owner.query(`SELECT api.reopen_comment_thread($1)`, [root.id]),
    ).rejects.toMatchObject({ code: 'SB003' })
  })

  it('isolates comments by workspace (cross-workspace denied)', async () => {
    const ownerA = await asUser(OWNER_A, WS_A)
    const ownerB = await asUser(OWNER_B, WS_B)
    const revisionId = await latestRevisionId(ownerA)
    const created = await createComment(
      ownerA,
      revisionId,
      'revision',
      {},
      'Private',
    )

    // B cannot read A's comments.
    const visible = await ownerB.query(`SELECT id FROM api.comments`)
    expect(visible.rows).toHaveLength(0)

    // B cannot reply to A's comment.
    await expect(reply(ownerB, created.id, 'Intruder')).rejects.toMatchObject({
      code: '42501',
    })
    // B cannot resolve A's thread.
    await expect(
      ownerB.query(`SELECT api.resolve_comment_thread($1)`, [created.id]),
    ).rejects.toMatchObject({ code: '42501' })
    // B cannot create a comment on A's revision.
    await expect(
      createComment(ownerB, revisionId, 'revision', {}, 'Cross workspace'),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('prevents direct DML on comments by request roles', async () => {
    const owner = await asUser(OWNER_A, WS_A)
    const revisionId = await latestRevisionId(owner)
    const created = await createComment(
      owner,
      revisionId,
      'revision',
      {},
      'To protect',
    )
    await expect(
      owner.query(
        `INSERT INTO api.comments
           (id,workspace_id,revision_id,record_id,root_id,target_kind,body,author_user_id)
         VALUES ($1,$2,$3,$4,$1,'revision','forged',$5)`,
        [
          '99000000-0000-4000-8000-000000000001',
          WS_A,
          revisionId,
          RECORD_A,
          OWNER_A,
        ],
      ),
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      owner.query(`UPDATE api.comments SET state='resolved' WHERE id=$1`, [
        created.id,
      ]),
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      owner.query(`DELETE FROM api.comments WHERE id=$1`, [created.id]),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('renders departed authors honestly: author_user_id is null after deletion', async () => {
    const commenter = await asUser(COMMENTER_A, WS_A)
    const owner = await asUser(OWNER_A, WS_A)
    const revisionId = await latestRevisionId(commenter)
    const created = await createComment(
      commenter,
      revisionId,
      'revision',
      {},
      'I will leave',
    )
    expect(created.authorUserId).toBe(COMMENTER_A)

    // COMMENTER_A has no RESTRICT FK elsewhere (no revisions), so the only FKs
    // are comments (SET NULL) and memberships (CASCADE).
    await migrator!.query(`DELETE FROM internal."user" WHERE id = $1`, [
      COMMENTER_A,
    ])

    // Read as a still-member viewer; the departed author is no longer a
    // member so their own session cannot see the workspace.
    const { rows } = await owner.query(
      `SELECT author_user_id, body FROM api.comments WHERE id = $1`,
      [created.id],
    )
    expect(rows[0].author_user_id).toBeNull()
    expect(rows[0].body).toBe('I will leave')
  })
})
