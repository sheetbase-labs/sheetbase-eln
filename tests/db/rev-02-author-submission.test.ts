import { createHash, createHmac, randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'

import * as schema from '#/db/schema'
import { createAuth } from '#/lib/auth'
import { handleSignatureStepUp } from '#/lib/signature-step-up.server'
import { migratorUrl, prepareTestDatabase } from './helpers'

const workspaceId = randomUUID()
const projectId = randomUUID()
const author = 'rev02-author'
const reviewer = 'rev02-reviewer'
const verifier = 'rev02-independent-admin'
const witness = 'rev02-witness'
const unassignedOwner = 'rev02-unassigned-owner'
const password = 'rev02-native-fixture-password'
let admin: Client
let actor: Client
let database: ReturnType<typeof drizzle<typeof schema>>
let authentication: ReturnType<typeof createAuth>
let asRole: (role: 'authenticator') => Promise<Client>

const claims = (userId: string) =>
  JSON.stringify({
    sub: userId,
    session_id: `rev02-${userId}`,
    workspace_id: workspaceId,
    role: 'authenticated',
  })
function headers(userId: string) {
  const secret = z.string().min(32).parse(process.env.BETTER_AUTH_SECRET)
  const token = `rev02-${userId}`
  const signature = createHmac('sha256', secret).update(token).digest('base64')
  return new Headers({
    origin: 'https://sheetbase.test',
    'content-type': 'application/json',
    cookie: `__Secure-better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`,
  })
}
async function proof(userId: string, input: object) {
  return handleSignatureStepUp(
    new Request('https://sheetbase.test/api/signatures/step-up', {
      method: 'POST',
      headers: headers(userId),
      body: JSON.stringify({ workspaceId, password, ...input }),
    }),
    { database, authentication },
  )
}
async function token(input: object, userId = author) {
  const response = await proof(userId, input)
  expect(response.status, await response.clone().text()).toBe(200)
  return z.object({ token: z.string().min(32) }).parse(await response.json())
    .token
}

beforeAll(async () => {
  const prepared = await prepareTestDatabase()
  admin = prepared.migrator
  asRole = prepared.asRole
  actor = await prepared.asRole('authenticator')
  await actor.query('set role authenticated')
  database = drizzle(migratorUrl(), { schema })
  authentication = createAuth(database)
  for (const userId of [author, reviewer, verifier, witness, unassignedOwner]) {
    await admin.query(
      'insert into internal."user"(id,name,email,"emailVerified") values($1,$1,$2,true)',
      [userId, `${userId}@sheetbase.test`],
    )
    await admin.query(
      'insert into internal.session(id,token,"userId","expiresAt") values($1,$1,$2,now()+interval \'1 hour\')',
      [`rev02-${userId}`, userId],
    )
  }
  await admin.query(
    'insert into api.workspaces(id,slug,name) values($1,$2,$2)',
    [workspaceId, `rev02-${workspaceId}`],
  )
  await admin.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values($1,$2,'member'),($1,$3,'reviewer'),($1,$4,'admin'),($1,$5,'member'),($1,$6,'owner')`,
    [workspaceId, author, reviewer, verifier, witness, unassignedOwner],
  )
  await admin.query(
    "insert into api.projects(id,workspace_id,key,title) values($1,$2,'REV02','Author signatures')",
    [projectId, workspaceId],
  )
  // Explicit SET-02 authority, independent of workspace roles and assignment.
  await admin.query(
    `insert into api.project_access(workspace_id,project_id,user_id,can_view,can_edit,can_review,granted_by_user_id)
     values($1,$2,$3,true,true,false,$3),($1,$2,$4,true,false,true,$3),($1,$2,$5,true,false,false,$3)`,
    [workspaceId, projectId, author, reviewer, witness],
  )
  for (const userId of [author, reviewer, witness, unassignedOwner]) {
    await authentication.api.setPassword({
      headers: headers(userId),
      body: { newPassword: password },
    })
    await actor.query("select set_config('request.jwt.claims',$1,false)", [
      claims(userId),
    ])
    await actor.query('select api.request_signature_identity_verification()')
    await actor.query("select set_config('request.jwt.claims',$1,false)", [
      claims(verifier),
    ])
    await actor.query('select api.verify_signature_identity($1,$2)', [
      userId,
      `${userId}@sheetbase.test`,
    ])
    await actor.query("select set_config('request.jwt.claims',$1,false)", [
      claims(userId),
    ])
    await actor.query('select api.certify_signature($1,1,$2)', [
      workspaceId,
      await token({ purpose: 'certify' }, userId),
    ])
  }
  await actor.query("select set_config('request.jwt.claims',$1,false)", [
    claims(author),
  ])
})
afterAll(async () => {
  await actor?.end()
  await admin?.end()
  await database?.$client.end()
})

async function input(workflowDefinitionKey = 'controlled-scientific-review') {
  const recordId = randomUUID()
  await admin.query(
    `insert into api.records(id,workspace_id,project_id,kind,identifier,title,status,created_by_user_id) values($1,$2,$3,'experiment',$4,'Asymmetric author evidence','draft',$5)`,
    [recordId, workspaceId, projectId, `EXP-${recordId}`, author],
  )
  const preview = await actor.query(
    "select api.preview_submission_digest($1)->>'sourceDigest' as digest",
    [recordId],
  )
  return {
    purpose: 'author-submit',
    recordId,
    revisionDigest: z.string().parse(preview.rows[0].digest),
    workflowDefinitionKey,
    workflowDefinitionVersion: 1,
    reviewerUserIds: [reviewer],
    confirmed: true,
    idempotencyKey: randomUUID(),
    dueAt: '2026-11-14T10:30:00.000Z',
  }
}
type SubmissionInput = Awaited<ReturnType<typeof input>>
async function submit(
  value: SubmissionInput,
  signingToken: string | null,
  connection = actor,
) {
  return connection.query(
    `select api.submit_record_revision($1,$2,$3,$4,$5::text[],$6,$7,$8::timestamptz,$9,$10) as result`,
    [
      value.recordId,
      value.revisionDigest,
      value.workflowDefinitionKey,
      value.workflowDefinitionVersion,
      value.reviewerUserIds,
      value.confirmed,
      value.idempotencyKey,
      value.dueAt,
      signingToken,
      author,
    ],
  )
}
async function state(recordId: string) {
  return (
    await admin.query(
      `select (select count(*)::int from api.review_submissions where record_id=$1) as submissions,
    (select count(*)::int from api.signatures where record_id=$1) as signatures`,
      [recordId],
    )
  ).rows[0]
}

describe('atomic controlled author submission', () => {
  it('denies session-only controlled submission without leaving unsigned evidence', async () => {
    const value = await input()
    await expect(submit(value, null)).rejects.toMatchObject({ code: 'SB002' })
    expect(await state(value.recordId)).toEqual({
      submissions: 0,
      signatures: 0,
    })
  })
  it('keeps exploratory submission unburdened and does not manufacture an author signature', async () => {
    const value = await input('default-scientific-review')
    await submit(value, null)
    expect(await state(value.recordId)).toEqual({
      submissions: 1,
      signatures: 0,
    })
  })
  it('freezes and signs exact digest atomically, then retries without consuming another grant', async () => {
    const value = await input()
    const signingToken = await token(value)
    const first = (await submit(value, signingToken)).rows[0].result
    expect(first.idempotent).toBe(false)
    expect(await state(value.recordId)).toEqual({
      submissions: 1,
      signatures: 1,
    })
    const evidence = (
      await admin.query('select * from api.signatures where record_id=$1', [
        value.recordId,
      ])
    ).rows[0]
    expect(evidence).toMatchObject({
      signature_meaning: 'authored',
      signer_name: author,
      signer_user_id: author,
      signer_session_id: `rev02-${author}`,
      revision_integrity_digest: value.revisionDigest,
      auth_method: 'password',
    })
    expect((await submit(value, null)).rows[0].result).toMatchObject({
      idempotent: true,
      revision: first.revision,
      signature: first.signature,
    })
    expect(await state(value.recordId)).toEqual({
      submissions: 1,
      signatures: 1,
    })
  })
  it('denies another user and a spent token on a new submission without partial evidence', async () => {
    const value = await input()
    const signingToken = await token(value)
    await actor.query("select set_config('request.jwt.claims',$1,false)", [
      claims(witness),
    ])
    try {
      await expect(submit(value, signingToken)).rejects.toMatchObject({
        // View and an explicit witness request never grant author Edit.
        code: '42501',
      })
      expect(await state(value.recordId)).toEqual({
        submissions: 0,
        signatures: 0,
      })
    } finally {
      await actor.query("select set_config('request.jwt.claims',$1,false)", [
        claims(author),
      ])
    }
    await submit(value, signingToken)
    const next = await input()
    await expect(submit(next, signingToken)).rejects.toMatchObject({
      code: 'SB002',
    })
    expect(await state(next.recordId)).toEqual({
      submissions: 0,
      signatures: 0,
    })
  })
  it('does not turn an existing unsigned controlled submission into an authored retry success', async () => {
    const value = await input()
    const exploratory = {
      ...value,
      workflowDefinitionKey: 'default-scientific-review',
      idempotencyKey: randomUUID(),
    }
    const result = (await submit(exploratory, null)).rows[0].result
    // Model an unsigned pre-existing controlled row, not a credential or grant.
    const revision = await admin.query<{ id: string }>(
      `insert into api.revisions(record_id,workspace_id,structure_version,metadata_version,
        metadata_snapshot,block_snapshot,canonical_snapshot,integrity_algorithm,reason,created_by_user_id)
       select record_id,workspace_id,structure_version,metadata_version,metadata_snapshot,
        block_snapshot,canonical_snapshot,integrity_algorithm,reason,created_by_user_id
       from api.revisions where id=$1 returning id`,
      [result.revision.id],
    )
    await admin.query(
      `insert into api.review_submissions(workspace_id,record_id,revision_id,state,
        workflow_definition_key,workflow_definition_version,assigned_reviewer_user_ids,
        submitted_by_user_id,submitted_session_id,submitted_role,submitted_at,idempotency_key,due_at)
       select workspace_id,record_id,$3,state,'controlled-scientific-review',1,
        assigned_reviewer_user_ids,submitted_by_user_id,submitted_session_id,submitted_role,
        submitted_at,$2,due_at from api.review_submissions where id=$1`,
      [result.submission.id, value.idempotencyKey, revision.rows[0].id],
    )
    await expect(submit(value, null)).rejects.toMatchObject({ code: 'SB002' })
    expect(await state(value.recordId)).toEqual({
      submissions: 2,
      signatures: 0,
    })
  })
  it('denies changed signed retry inputs without recording more signatures', async () => {
    const value = await input()
    await submit(value, await token(value))
    for (const changed of [
      { ...value, confirmed: false },
      { ...value, reviewerUserIds: [verifier] },
      { ...value, workflowDefinitionKey: 'default-scientific-review' },
      { ...value, workflowDefinitionVersion: 2 },
      { ...value, revisionDigest: '0'.repeat(64) },
    ])
      await expect(submit(changed, null)).rejects.toBeDefined()
    expect(await state(value.recordId)).toEqual({
      submissions: 1,
      signatures: 1,
    })
  })
  it.each(['dueAt', 'confirmed', 'reviewerUserIds', 'idempotencyKey'] as const)(
    'binds effective %s and rolls back token consumption on a mismatch',
    async (field) => {
      const value = await input()
      const signingToken = await token(value)
      const changed = {
        ...value,
        [field]:
          field === 'dueAt'
            ? '2026-11-15T10:30:00.000Z'
            : field === 'confirmed'
              ? false
              : field === 'reviewerUserIds'
                ? [verifier]
                : randomUUID(),
      }
      await expect(submit(changed, signingToken)).rejects.toBeDefined()
      expect(await state(value.recordId)).toEqual({
        submissions: 0,
        signatures: 0,
      })
      await submit(value, signingToken)
      expect(await state(value.recordId)).toEqual({
        submissions: 1,
        signatures: 1,
      })
    },
  )
  it('normalizes reviewers and canonical timestamp offsets while preserving exact effective arguments', async () => {
    const value = await input()
    const signingToken = await token({
      ...value,
      reviewerUserIds: [reviewer, reviewer],
      dueAt: '2026-11-14T11:30:00+01:00',
    })
    await submit(value, signingToken)
    const changed = { ...value, dueAt: '2026-11-15T10:30:00.000Z' }
    await expect(submit(changed, null)).rejects.toMatchObject({ code: '23505' })
  })
  it('stale preview leaves neither submission nor spent author grant', async () => {
    const value = await input()
    const signingToken = await token(value)
    await admin.query(
      "update api.records set title='Changed after password proof' where id=$1",
      [value.recordId],
    )
    await expect(submit(value, signingToken)).rejects.toMatchObject({
      code: 'SB001',
    })
    expect(await state(value.recordId)).toEqual({
      submissions: 0,
      signatures: 0,
    })
    expect(
      (
        await admin.query(
          `select consumed_at from internal.signature_grants where user_id=$1 and purpose='author-submit' order by created_at desc limit 1`,
          [author],
        )
      ).rows[0].consumed_at,
    ).toBeNull()
  })
  it('denies expired grants and wrong sessions without leaving partial evidence', async () => {
    const value = await input()
    const signingToken = await token(value)
    await admin.query(
      "update internal.signature_grants set expires_at=clock_timestamp()-interval '1 second' where token_hash=$1",
      [createHash('sha256').update(signingToken).digest('hex')],
    )
    await expect(submit(value, signingToken)).rejects.toMatchObject({
      code: 'SB002',
    })
    expect(await state(value.recordId)).toEqual({
      submissions: 0,
      signatures: 0,
    })
    const fresh = await token(value)
    await admin.query(
      "insert into internal.session(id,token,\"userId\",\"expiresAt\") values('other-author-session','other-author-session',$1,now()+interval '1 hour')",
      [author],
    )
    await actor.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({
        ...JSON.parse(claims(author)),
        session_id: 'other-author-session',
      }),
    ])
    try {
      await expect(submit(value, fresh)).rejects.toMatchObject({
        code: 'SB002',
      })
    } finally {
      await actor.query("select set_config('request.jwt.claims',$1,false)", [
        claims(author),
      ])
    }
    await submit(value, fresh)
  })
  it('serializes simultaneous identical submissions to one signature and a genuine signed retry', async () => {
    const value = await input()
    const signingToken = await token(value)
    const other = await asRole('authenticator')
    try {
      await other.query('set role authenticated')
      await other.query("select set_config('request.jwt.claims',$1,false)", [
        claims(author),
      ])
      const results = await Promise.all([
        submit(value, signingToken),
        submit(value, signingToken, other),
      ])
      expect(results.map((r) => r.rows[0].result.idempotent).sort()).toEqual([
        false,
        true,
      ])
      expect(results[0].rows[0].result.signature).toEqual(
        results[1].rows[0].result.signature,
      )
      expect(await state(value.recordId)).toEqual({
        submissions: 1,
        signatures: 1,
      })
    } finally {
      await other.end()
    }
  })
})

describe('four honest meanings and explicitly requested witness work', () => {
  async function submitted() {
    const value = await input()
    const result = (await submit(value, await token(value))).rows[0].result
    await actor.query("select set_config('request.jwt.claims',$1,false)", [
      claims(reviewer),
    ])
    await actor.query(
      "select api.run_revision_checks($1,'default-scientific-checks',1,true,$2)",
      [result.revision.id, randomUUID()],
    )
    return {
      value,
      submissionId: z.string().parse(result.submission.id),
      revisionId: z.string().parse(result.revision.id),
    }
  }
  async function sign(
    submissionId: string,
    digest: string,
    meaning: string,
    userId = reviewer,
  ) {
    const signingToken = await token(
      {
        purpose: 'sign',
        submissionId,
        revisionDigest: digest,
        signatureMeaning: meaning,
      },
      userId,
    )
    await actor.query("select set_config('request.jwt.claims',$1,false)", [
      claims(userId),
    ])
    return actor.query('select api.sign_revision($1,$2,$3,$4,$5)', [
      submissionId,
      meaning,
      userId,
      digest,
      signingToken,
    ])
  }
  afterAll(async () => {
    await actor.query("select set_config('request.jwt.claims',$1,false)", [
      claims(author),
    ])
  })
  it('Reviewed is not approval or a record lock; the same reviewer can later approve-and-sign independently', async () => {
    const target = await submitted()
    try {
      await sign(target.submissionId, target.value.revisionDigest, 'reviewed')
      expect(
        (
          await admin.query('select locked_at from api.records where id=$1', [
            target.value.recordId,
          ])
        ).rows[0].locked_at,
      ).toBeNull()
      expect(
        (
          await admin.query(
            'select state from api.review_submissions where id=$1',
            [target.submissionId],
          )
        ).rows[0].state,
      ).toBe('submitted')
      const notApproved = await proof(reviewer, {
        purpose: 'sign',
        submissionId: target.submissionId,
        revisionDigest: target.value.revisionDigest,
        signatureMeaning: 'reviewed-and-approved',
      })
      expect(notApproved.status).toBe(403)
      await actor.query("select api.approve_review($1,null,'submitted',$2)", [
        target.submissionId,
        target.value.revisionDigest,
      ])
      await sign(
        target.submissionId,
        target.value.revisionDigest,
        'reviewed-and-approved',
      )
      expect(
        (
          await admin.query(
            'select locked_by_revision_id from api.records where id=$1',
            [target.value.recordId],
          )
        ).rows[0].locked_by_revision_id,
      ).toBe(target.revisionId)
      expect(
        (
          await admin.query(
            'select signature_meaning from api.signatures where submission_id=$1 order by signed_at',
            [target.submissionId],
          )
        ).rows.map((r) => r.signature_meaning),
      ).toEqual(['authored', 'reviewed', 'reviewed-and-approved'])
    } finally {
      await actor.query("select set_config('request.jwt.claims',$1,false)", [
        claims(author),
      ])
    }
  })
  it('denies a witness request to an active certified owner without project View', async () => {
    const target = await submitted()
    try {
      await expect(
        actor.query('select api.request_signature_witness($1,$2,$3,null)', [
          target.submissionId,
          unassignedOwner,
          target.value.revisionDigest,
        ]),
      ).rejects.toMatchObject({ code: '42501' })
      expect(
        (
          await admin.query(
            'select id from api.signature_witness_requests where submission_id=$1',
            [target.submissionId],
          )
        ).rows,
      ).toEqual([])
    } finally {
      await actor.query("select set_config('request.jwt.claims',$1,false)", [
        claims(author),
      ])
    }
  })
  it('denies unassigned owners, authors and accidental reviewer witnesses, then derives and completes a real witness request', async () => {
    const target = await submitted()
    try {
      for (const userId of [unassignedOwner, author]) {
        const denied = await proof(userId, {
          purpose: 'sign',
          submissionId: target.submissionId,
          revisionDigest: target.value.revisionDigest,
          signatureMeaning: 'reviewed',
        })
        expect(denied.status).toBe(403)
      }
      const unrequested = await proof(reviewer, {
        purpose: 'sign',
        submissionId: target.submissionId,
        revisionDigest: target.value.revisionDigest,
        signatureMeaning: 'witnessed',
      })
      expect(unrequested.status).toBe(403)
      await actor.query('select api.request_signature_witness($1,$2,$3,null)', [
        target.submissionId,
        witness,
        target.value.revisionDigest,
      ])
      await actor.query("select set_config('request.jwt.claims',$1,false)", [
        claims(witness),
      ])
      const work = await actor.query(
        "select * from api.my_work_items where kind='witness_requested' and record_id=$1",
        [target.value.recordId],
      )
      expect(work.rows).toHaveLength(1)
      expect(work.rows[0]).toMatchObject({
        source_type: 'signature_witness_request',
        revision_id: target.revisionId,
      })
      await sign(
        target.submissionId,
        target.value.revisionDigest,
        'witnessed',
        witness,
      )
      expect(
        (
          await actor.query(
            "select * from api.my_work_items where kind='witness_requested' and record_id=$1",
            [target.value.recordId],
          )
        ).rows,
      ).toEqual([])
      expect(
        (
          await admin.query('select locked_at from api.records where id=$1', [
            target.value.recordId,
          ])
        ).rows[0].locked_at,
      ).toBeNull()
    } finally {
      await actor.query("select set_config('request.jwt.claims',$1,false)", [
        claims(author),
      ])
    }
  })
})
