/**
 * Phase 4: every state where one person waits on another is a work item.
 * `my_work_items` exposes the returned review, the unsigned approval, access
 * requests and their decisions, accepted invitations, quarantined and
 * past-hold samples and overdue calibrations, each to the person who is
 * waiting or who has to act, and to nobody else.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { grantProjectAccess, prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-000000004f0a'
const AUTHOR = 'iw-author'
const REVIEWER = 'iw-reviewer'
const OWNER = 'iw-owner'
const PROJECT = '00000000-0000-4000-8000-000000004f10'
const RECORD = '00000000-0000-4000-8000-000000004f11'
const SAMPLE_Q = '00000000-0000-4000-8000-000000004f12'
const SAMPLE_H = '00000000-0000-4000-8000-000000004f13'
const INSTRUMENT = '00000000-0000-4000-8000-000000004f14'
const RECORD_APPROVED = '00000000-0000-4000-8000-000000004f15'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function submission(
  record: string,
  state: string,
  key: string,
): Promise<string> {
  const revision = await migrator.query<{ id: string }>(
    `insert into api.revisions(record_id,workspace_id,structure_version,metadata_version,metadata_snapshot,
                               block_snapshot,reason,created_by_user_id,updated_at)
     values($1,$3,1,1,'{}'::jsonb,'[]'::jsonb,'submit',$2,now()) returning id`,
    [record, AUTHOR, WS],
  )
  const row = await migrator.query<{ id: string }>(
    `insert into api.review_submissions(workspace_id,record_id,revision_id,workflow_definition_key,
                                        workflow_definition_version,assigned_reviewer_user_ids,
                                        submitted_by_user_id,submitted_session_id,submitted_role,
                                        submitted_at,idempotency_key)
     values($1,$2,$3,'default-scientific-review',1,array[$4],$5,'sess','author',now(),$6)
     returning id`,
    [WS, record, revision.rows[0]!.id, REVIEWER, AUTHOR, key],
  )
  await migrator.query(
    `update api.review_submissions set state=$2 where id=$1`,
    [row.rows[0]!.id, state],
  )
  return row.rows[0]!.id
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  for (const user of [AUTHOR, REVIEWER, OWNER]) {
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values($1,$1,$2,true)`,
      [user, `${user}@test.invalid`],
    )
  }
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values($1,'iw','IW')`,
    [WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values
     ($1,$2,'scientist'),($1,$3,'reviewer'),($1,$4,'owner')`,
    [WS, AUTHOR, REVIEWER, OWNER],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,lead_user_id) values($1,$2,'IW','Waiting',$3)`,
    [PROJECT, WS, OWNER],
  )
  for (const userId of [AUTHOR, REVIEWER]) {
    await grantProjectAccess(migrator, {
      workspaceId: WS,
      projectId: PROJECT,
      userId,
      canView: true,
      canEdit: userId === AUTHOR,
      canReview: userId === REVIEWER,
    })
  }
  for (const [id, identifier] of [
    [RECORD, 'EXP-IW1'],
    [RECORD_APPROVED, 'EXP-IW2'],
  ]) {
    await migrator.query(
      // A draft experiment is private to its author, so these are in progress.
      `insert into api.records(id,workspace_id,project_id,kind,identifier,title,status,created_by_user_id)
       values($1,$2,$3,'experiment',$4,'Waiting record','in_progress',$5)`,
      [id, WS, PROJECT, identifier, AUTHOR],
    )
  }
  await submission(RECORD, 'returned', 'iw-returned')
  await submission(RECORD_APPROVED, 'approved', 'iw-approved')

  await migrator.query(
    `insert into api.records(id,workspace_id,project_id,kind,identifier,title,status,created_by_user_id)
     values($1,$3,$4,'sample','SMP-IWQ','Quarantined','quarantined',$5),
           ($2,$3,$4,'sample','SMP-IWH','Past hold','hold_exceeded',$5)`,
    [SAMPLE_Q, SAMPLE_H, WS, PROJECT, AUTHOR],
  )
  await migrator.query(
    `insert into api.instruments(id,workspace_id,name,created_by_user_id) values($1,$2,'Plate reader',$3)`,
    [INSTRUMENT, WS, AUTHOR],
  )
  await migrator.query(
    `insert into api.instrument_calibrations(workspace_id,instrument_id,performed_at,due_at)
     values($1,$2,now()-interval '90 days',now()-interval '1 day')`,
    [WS, INSTRUMENT],
  )
  await migrator.query(
    `insert into api.project_access_requests(workspace_id,project_id,user_id,reason)
     values($1,$2,$3,'I need to edit the plate map')`,
    [WS, PROJECT, AUTHOR],
  )
  await migrator.query(
    `insert into api.workspace_invitations(workspace_id,email,role,token_hash,status,expires_at,
                                           accepted_at,accepted_by_user_id,created_by_user_id)
     values($1,'new@test.invalid','member','h','accepted',now()+interval '1 day',now(),$2,$3)`,
    [WS, REVIEWER, OWNER],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

async function kindsFor(user: string): Promise<string[]> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('set role authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ sub: user, workspace_id: WS, role: 'authenticated' }),
  ])
  const { rows } = await client.query<{ kind: string }>(
    'select kind from api.my_work_items',
  )
  return rows.map((row) => row.kind)
}

describe('my_work_items waiting states', () => {
  it('tells the author their review came back, a sample is quarantined or past hold, and a calibration is overdue', async () => {
    const kinds = await kindsFor(AUTHOR)
    expect(kinds).toContain('review_returned')
    expect(kinds).toContain('sample_awaiting_release')
    expect(kinds).toContain('sample_hold_exceeded')
    expect(kinds).toContain('calibration_overdue')
  })

  it('asks the approving reviewer to sign, and only the reviewer', async () => {
    expect(await kindsFor(REVIEWER)).toContain('approval_unsigned')
    expect(await kindsFor(AUTHOR)).not.toContain('approval_unsigned')
  })

  it('does not hand the returned review to the reviewer', async () => {
    expect(await kindsFor(REVIEWER)).not.toContain('review_returned')
  })

  it('asks the project lead to decide an access request, not the requester', async () => {
    expect(await kindsFor(OWNER)).toContain('access_requested')
    expect(await kindsFor(AUTHOR)).not.toContain('access_requested')
  })

  it('tells the requester how the access request was decided', async () => {
    await migrator.query(
      `update api.project_access_requests set status='approved', decided_by_user_id=$1`,
      [OWNER],
    )
    const requester = await kindsFor(AUTHOR)
    expect(requester).toContain('access_decided')
    expect(await kindsFor(OWNER)).not.toContain('access_requested')
  })

  it('tells the inviter their invitation was accepted', async () => {
    expect(await kindsFor(OWNER)).toContain('invitation_accepted')
  })

  it('stops showing a returned review once a newer submission exists', async () => {
    await submission(RECORD, 'submitted', 'iw-resubmitted')
    await migrator.query(
      `update api.review_submissions set submitted_at=now()+interval '1 minute'
        where idempotency_key='iw-resubmitted'`,
    )
    expect(await kindsFor(AUTHOR)).not.toContain('review_returned')
  })

  it('names the revision under review on a review request', async () => {
    const client = await asRole('authenticator')
    clients.push(client)
    await client.query('set role authenticated')
    await client.query(`select set_config('request.jwt.claims',$1,false)`, [
      JSON.stringify({
        sub: REVIEWER,
        workspace_id: WS,
        role: 'authenticated',
      }),
    ])
    const { rows } = await client.query<{ revision_id: string | null }>(
      `select revision_id from api.my_work_items where kind='review_requested'`,
    )
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) expect(row.revision_id).not.toBeNull()
  })

  it('counts the review kinds in the Reviews subset', async () => {
    const client = await asRole('authenticator')
    clients.push(client)
    await client.query('set role authenticated')
    await client.query(`select set_config('request.jwt.claims',$1,false)`, [
      JSON.stringify({
        sub: REVIEWER,
        workspace_id: WS,
        role: 'authenticated',
      }),
    ])
    const { rows } = await client.query<{ total: number; reviews: number }>(
      'select total, reviews from api.inbox_needs_action_counts()',
    )
    // The approved review awaiting this reviewer's signature, and the
    // resubmitted review awaiting their decision.
    expect(rows[0]!.reviews).toBeGreaterThanOrEqual(2)
    expect(rows[0]!.total).toBeGreaterThanOrEqual(rows[0]!.reviews)
  })
})

describe('my_work_items signature identity verification', () => {
  it('asks an administrator to verify, and tells the requester once it is done', async () => {
    await migrator.query(
      `insert into api.user_signature_certifications(workspace_id,user_id,statement_version,credential_session_id)
       values($1,$2,1,'iw-session')`,
      [WS, AUTHOR],
    )
    expect(await kindsFor(OWNER)).toContain('verification_requested')
    expect(await kindsFor(AUTHOR)).not.toContain('verification_requested')
    expect(await kindsFor(REVIEWER)).not.toContain('verification_requested')

    await migrator.query(
      `update api.user_signature_certifications
          set identity_verified_at=now(), identity_verified_by=$2, certified_at=null
        where workspace_id=$1`,
      [WS, OWNER],
    )
    expect(await kindsFor(OWNER)).not.toContain('verification_requested')
    expect(await kindsFor(AUTHOR)).toContain('verification_granted')
  })
})
