/**
 * Out of office with a delegate (migration 0091).
 *
 * Proves, against a freshly migrated database:
 *  - going away with a delegate adds the delegate to the reviews waiting on the
 *    person, records whom they cover, and a review submitted during the absence
 *    is covered from the start;
 *  - the delegate is not added to a review they wrote or in a project they
 *    cannot review in;
 *  - the delegate can make the review decision, as themselves;
 *  - cancelling or finishing the absence takes the delegate off reviews they
 *    have not acted on, and leaves them on those they have;
 *  - the Inbox says whom the delegate is covering;
 *  - people set their own absence, members managers set anyone's, and nobody
 *    else sets another person's;
 *  - the colleague covering has to be an active member who can do work.
 */
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  expectDenied,
  grantProjectAccess,
  prepareTestDatabase,
  setActorJwt,
} from './helpers'

const WS = '00000000-0000-4000-8000-00000009b000'
const OPEN = '00000000-0000-4000-8000-00000009b001'
const NO_REVIEW = '00000000-0000-4000-8000-00000009b002'
const AWAY = 'ooo-away'
const COVER = 'ooo-cover'
const LEAD = 'ooo-lead'
const OTHER = 'ooo-other'
const VIEWER = 'ooo-viewer'
const AUTHOR = 'ooo-author'
const SUSPENDED = 'ooo-suspended'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function asAuthenticated(userId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await setActorJwt(client, userId, WS, { session_id: `session-${userId}` })
  return client
}

const id = (group: string, n: number) =>
  `00000000-0000-4000-${group}-${n.toString(16).padStart(12, '0')}`
const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)

async function addReview(
  n: number,
  opts: { project?: string; submitter?: string; reviewers?: string[] } = {},
): Promise<string> {
  const project = opts.project ?? OPEN
  const submitter = opts.submitter ?? AUTHOR
  const reviewers = opts.reviewers ?? [AWAY]
  await migrator.query(
    `INSERT INTO api.records
       (id, workspace_id, project_id, kind, identifier, title, status, created_by_user_id)
     VALUES ($1,$2,$3,'experiment',$4,$5,'in_progress',$6)`,
    [id('9b01', n), WS, project, `OOO-${n}`, `Review ${n}`, submitter],
  )
  await migrator.query(
    `INSERT INTO api.revisions
       (id, record_id, workspace_id, structure_version, metadata_version,
        metadata_snapshot, block_snapshot, integrity_digest, reason, created_by_user_id)
     VALUES ($1,$2,$3,1,2,'{}','[]',repeat('d',64),'submit',$4)`,
    [id('9b02', n), id('9b01', n), WS, submitter],
  )
  await migrator.query(
    `INSERT INTO api.review_submissions
       (id, workspace_id, record_id, revision_id, workflow_definition_key,
        workflow_definition_version, assigned_reviewer_user_ids,
        submitted_by_user_id, submitted_session_id, submitted_role,
        submitted_at, idempotency_key)
     VALUES ($1,$2,$3,$4,'default-review',1,$5::text[],$6,'s','authenticated',now(),$7)`,
    [
      id('9b03', n),
      WS,
      id('9b01', n),
      id('9b02', n),
      reviewers,
      submitter,
      `ooo-${n}`,
    ],
  )
  return id('9b03', n)
}

async function reviewers(submission: string): Promise<string[]> {
  const { rows } = await migrator.query(
    `SELECT assigned_reviewer_user_ids AS r FROM api.review_submissions WHERE id = $1`,
    [submission],
  )
  return rows[0].r
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal."user" (id,name,email,"emailVerified") VALUES
      ('${AWAY}','Away Person','ooo-away@test.invalid',true),
      ('${COVER}','Cover Person','ooo-cover@test.invalid',true),
      ('${LEAD}','Lead','ooo-lead@test.invalid',true),
      ('${OTHER}','Other','ooo-other@test.invalid',true),
      ('${VIEWER}','Viewer','ooo-viewer@test.invalid',true),
      ('${AUTHOR}','Author','ooo-author@test.invalid',true),
      ('${SUSPENDED}','Suspended','ooo-suspended@test.invalid',true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspaces (id,slug,name) VALUES ('${WS}','ooo','Out of office')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id,user_id,role,suspended_at) VALUES
      ('${WS}','${AWAY}','scientist',NULL),
      ('${WS}','${COVER}','scientist',NULL),
      ('${WS}','${LEAD}','owner',NULL),
      ('${WS}','${OTHER}','scientist',NULL),
      ('${WS}','${VIEWER}','viewer',NULL),
      ('${WS}','${AUTHOR}','scientist',NULL),
      ('${WS}','${SUSPENDED}','scientist',now())`,
  )
  await migrator.query(
    `INSERT INTO api.projects (id,workspace_id,key,title,lead_user_id) VALUES
      ('${OPEN}','${WS}','open','Open project','${LEAD}'),
      ('${NO_REVIEW}','${WS}','noreview','No reviewer project','${LEAD}')`,
  )
  for (const user of [AWAY, AUTHOR, COVER]) {
    await grantProjectAccess(migrator, {
      workspaceId: WS,
      projectId: OPEN,
      userId: user,
      canView: true,
      canEdit: true,
      canReview: true,
    })
  }
  // The colleague can see but not review the second project.
  await grantProjectAccess(migrator, {
    workspaceId: WS,
    projectId: NO_REVIEW,
    userId: AWAY,
    canView: true,
    canEdit: true,
    canReview: true,
  })
  await grantProjectAccess(migrator, {
    workspaceId: WS,
    projectId: NO_REVIEW,
    userId: COVER,
    canView: true,
    canEdit: true,
    canReview: false,
  })
  await migrator.query(
    `INSERT INTO internal.review_workflow_definitions (definition_key, version, definition)
     VALUES ('default-review', 1, '{"steps":[]}'::jsonb) ON CONFLICT DO NOTHING`,
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

describe('set_member_absence', () => {
  it('lets a person set their own absence and refuses everyone else', async () => {
    const other = await asAuthenticated(OTHER)
    await expectDenied(
      other.query(
        `SELECT * FROM api.set_member_absence($1::uuid, $2::date, $3::date, NULL, NULL, $4)`,
        [WS, day(1), day(2), AWAY],
      ),
      'SB052',
    )
    const own = await asAuthenticated(OTHER)
    const { rows } = await own.query(
      `SELECT * FROM api.set_member_absence($1::uuid, $2::date, $3::date, $4, 'Conference')`,
      [WS, day(10), day(12), COVER],
    )
    expect(rows[0]).toMatchObject({
      user_id: OTHER,
      delegate_user_id: COVER,
      note: 'Conference',
    })
  })

  it('refuses a colleague who cannot do the work, or dates that make no sense', async () => {
    const away = await asAuthenticated(AWAY)
    for (const delegate of [VIEWER, SUSPENDED, AWAY, 'nobody']) {
      await expectDenied(
        away.query(
          `SELECT * FROM api.set_member_absence($1::uuid, $2::date, $3::date, $4)`,
          [WS, day(0), day(3), delegate],
        ),
        '22023',
      )
    }
    await expectDenied(
      away.query(
        `SELECT * FROM api.set_member_absence($1::uuid, $2::date, $3::date, $4)`,
        [WS, day(5), day(3), COVER],
      ),
      '22023',
    )
    await expectDenied(
      away.query(
        `SELECT * FROM api.set_member_absence($1::uuid, $2::date, $3::date, $4)`,
        [WS, day(-9), day(-7), COVER],
      ),
      '22023',
    )
  })

  it('lets a members manager set an absence for someone else', async () => {
    const lead = await asAuthenticated(LEAD)
    const { rows } = await lead.query(
      `SELECT * FROM api.set_member_absence($1::uuid, $2::date, $3::date, $4, NULL, $5)`,
      [WS, day(20), day(22), COVER, VIEWER],
    )
    expect(rows[0].user_id).toBe(VIEWER)
  })
})

describe('cover for reviews', () => {
  let waiting: string
  let wrote: string
  let uncovered: string

  it('adds the colleague to reviews waiting on the person who is away', async () => {
    waiting = await addReview(1)
    wrote = await addReview(2, { submitter: COVER })
    uncovered = await addReview(3, { project: NO_REVIEW })
    const away = await asAuthenticated(AWAY)
    await away.query(
      `SELECT * FROM api.set_member_absence($1::uuid, $2::date, $3::date, $4, 'Holiday')`,
      [WS, day(0), day(7), COVER],
    )
    expect(await reviewers(waiting)).toEqual([AWAY, COVER])
    // Not the colleague's own review, and not where they cannot review.
    expect(await reviewers(wrote)).toEqual([AWAY])
    expect(await reviewers(uncovered)).toEqual([AWAY])
    const { rows } = await migrator.query(
      `SELECT absent_user_id, delegate_user_id, ended_at FROM api.review_cover WHERE submission_id = $1`,
      [waiting],
    )
    expect(rows).toEqual([
      { absent_user_id: AWAY, delegate_user_id: COVER, ended_at: null },
    ])
  })

  it('covers a review submitted during the absence', async () => {
    const fresh = await addReview(4)
    expect(await reviewers(fresh)).toEqual([AWAY, COVER])
  })

  it('shows the colleague whom they are covering in the Inbox', async () => {
    const cover = await asAuthenticated(COVER)
    const { rows } = await cover.query(
      `SELECT identifier, reason FROM api.my_work_items WHERE kind = 'review_requested' ORDER BY identifier`,
    )
    expect(rows.find((r) => r.identifier === 'OOO-1')?.reason).toBe(
      'Covering for Away Person',
    )
  })

  it('lets the colleague decide the review as themselves', async () => {
    const cover = await asAuthenticated(COVER)
    await cover.query(`SELECT api.approve_review($1,NULL,'submitted',$2)`, [
      waiting,
      'd'.repeat(64),
    ])
    const { rows } = await migrator.query(
      `SELECT actor_user_id, decision FROM api.review_decisions WHERE submission_id = $1`,
      [waiting],
    )
    expect(rows).toEqual([{ actor_user_id: COVER, decision: 'approve' }])
  })

  it('takes the colleague off unacted reviews when the absence is cancelled', async () => {
    const away = await asAuthenticated(AWAY)
    const { rows: open } = await migrator.query(
      `SELECT id FROM api.member_absences WHERE user_id = $1 AND cancelled_at IS NULL`,
      [AWAY],
    )
    const fresh = id('9b03', 4)
    await away.query(`SELECT * FROM api.cancel_member_absence($1)`, [
      open[0].id,
    ])
    expect(await reviewers(fresh)).toEqual([AWAY])
    const { rows } = await migrator.query(
      `SELECT ended_at FROM api.review_cover WHERE submission_id = $1`,
      [fresh],
    )
    expect(rows[0].ended_at).not.toBeNull()
  })

  it('keeps the colleague on a review they acted on when the absence ends', async () => {
    const away = await asAuthenticated(AWAY)
    await away.query(
      `SELECT * FROM api.set_member_absence($1::uuid, $2::date, $3::date, $4)`,
      [WS, day(0), day(3), COVER],
    )
    const acted = await addReview(6)
    expect(await reviewers(acted)).toEqual([AWAY, COVER])
    const plain = await addReview(7)
    await migrator.query(
      `INSERT INTO api.review_decisions
         (workspace_id, submission_id, revision_id, record_id, decision,
          revision_integrity_digest, actor_user_id, actor_session_id, actor_role)
       VALUES ($1,$2,$3,$4,'request_changes',repeat('d',64),$5,'s','authenticated')`,
      [WS, acted, id('9b02', 6), id('9b01', 6), COVER],
    )
    // The absence is over.
    await migrator.query(
      `UPDATE api.member_absences SET starts_on = current_date - 9, ends_on = current_date - 1
        WHERE user_id = $1 AND cancelled_at IS NULL`,
      [AWAY],
    )
    await migrator.query(`SELECT internal.sync_absence_cover($1)`, [WS])
    expect(await reviewers(acted)).toEqual([AWAY, COVER])
    expect(await reviewers(plain)).toEqual([AWAY])
  })
})
