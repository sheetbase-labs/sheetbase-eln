/**
 * SIGN-001 database contract: electronic signatures.
 *
 * A signature is the immutable, post-approval attestation an assigned
 * reviewer records against a frozen, approved revision. The single
 * `api.sign_revision` SECURITY DEFINER RPC enforces workspace membership,
 * approved state, not-superseded, digest match, assigned-reviewer
 * permission, passing required checks, name confirmation, and no prior
 * signature by the same signer.
 */
import { drizzle } from 'drizzle-orm/node-postgres'
import { createHmac } from 'node:crypto'
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import * as schema from '#/db/schema'
import { createAuth } from '#/lib/auth'
import { handleSignatureStepUp } from '#/lib/signature-step-up.server'
import {
  ensureSessions,
  grantProjectAccess,
  migratorUrl,
  prepareTestDatabase,
} from './helpers'

const WS_A = '98000000-0000-4000-8000-000000000001'
const WS_B = '98000000-0000-4000-8000-000000000002'
const PROJECT_A = '99000000-0000-4000-8000-000000000001'
const RECORD_A = '9a000000-0000-4000-8000-000000000001'
const OWNER_A = 'sign-owner-a'
const REVIEWER_A = 'sign-reviewer-a'
const REVIEWER_B = 'sign-reviewer-b'
const OUTSIDER = 'sign-outsider'
const OWNER_B = 'sign-owner-b'

let migrator: Client | undefined
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []
let database: ReturnType<typeof drizzle<typeof schema>>
let authentication: ReturnType<typeof createAuth>
const PASSWORD = 'signature-fixture-password-2026'

function headers(userId: string) {
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret) throw new Error('Test auth secret required')
  const token = `token-session-${userId}`
  const signature = createHmac('sha256', secret).update(token).digest('base64')
  return new Headers({
    origin: 'https://sheetbase.test',
    'content-type': 'application/json',
    cookie: `__Secure-better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`,
  })
}

async function passwordToken(userId: string, input: object) {
  const response = await handleSignatureStepUp(
    new Request('https://sheetbase.test/api/signatures/step-up', {
      method: 'POST',
      headers: headers(userId),
      body: JSON.stringify({
        workspaceId: WS_A,
        password: PASSWORD,
        ...('purpose' in input && input.purpose === 'sign'
          ? { signatureMeaning: 'reviewed-and-approved' }
          : {}),
        ...input,
      }),
    }),
    { database, authentication },
  )
  expect(response.status).toBe(200)
  const result: { token: string } = await response.json()
  return result.token
}

function claims(
  userId: string,
  workspaceId: string,
  sessionId?: string,
): string {
  return JSON.stringify({
    sub: userId,
    workspace_id: workspaceId,
    role: 'authenticated',
    session_id: sessionId ?? `session-${userId}`,
  })
}

async function authenticated(
  userId: string,
  workspaceId: string,
  sessionId?: string,
) {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query(`SELECT set_config('request.jwt.claims', $1, false)`, [
    claims(userId, workspaceId, sessionId),
  ])
  return client
}

/** Insert a revision directly as migrator with a controlled canonical snapshot. */
async function insertRevision(
  recordId: string,
  workspaceId: string,
  snapshot: Record<string, unknown>,
  reason = 'validate',
  createdByUserId = OWNER_A,
): Promise<{ id: string; integrityDigest: string }> {
  const { rows } = await migrator!.query(
    `INSERT INTO api.revisions
       (record_id, workspace_id, structure_version, metadata_version,
        metadata_snapshot, block_snapshot, canonical_snapshot,
        integrity_algorithm, reason, created_by_user_id)
     VALUES ($1, $2, 1, 1, $3, $4, $3, 'sha256', $5, $6)
     RETURNING id, integrity_digest`,
    [
      recordId,
      workspaceId,
      JSON.stringify(snapshot),
      JSON.stringify(snapshot.blocks ?? []),
      reason,
      createdByUserId,
    ],
  )
  return { id: rows[0].id, integrityDigest: rows[0].integrity_digest }
}

/** Insert a review submission directly as migrator. */
async function insertSubmission(
  revisionId: string,
  workspaceId: string,
  recordId: string,
  reviewerIds: string[],
  submitterId = OWNER_A,
  state = 'submitted',
) {
  const { rows } = await migrator!.query(
    `INSERT INTO api.review_submissions
       (workspace_id, record_id, revision_id, state,
        workflow_definition_key, workflow_definition_version,
        assigned_reviewer_user_ids, submitted_by_user_id,
        submitted_session_id, submitted_role, submitted_at, idempotency_key)
     VALUES ($1, $2, $3, $4, 'default-scientific-review', 1, $5, $6,
             'session-submit', 'authenticated', now(), $7)
     RETURNING id`,
    [
      workspaceId,
      recordId,
      revisionId,
      state,
      reviewerIds,
      submitterId,
      `submit-${revisionId}`,
    ],
  )
  return rows[0].id as string
}

/** Insert a session row for a user so sign_revision can validate it. */
async function insertSession(
  userId: string,
  sessionId = `session-${userId}`,
  expiresAt: Date | string = '2099-01-01T00:00:00Z',
) {
  await migrator!.query(
    `INSERT INTO internal."session" (id, "expiresAt", token, "userId")
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO NOTHING`,
    [sessionId, expiresAt, `token-${sessionId}`, userId],
  )
}

/** Canonical snapshot where all default checks pass. */
function passingSnapshot(): Record<string, unknown> {
  return {
    formatVersion: 1,
    record: {
      id: RECORD_A,
      workspaceId: WS_A,
      title: 'Complete experiment',
      status: 'draft',
      kind: 'experiment',
    },
    blocks: [
      {
        id: 'b1',
        type: 'rich_text',
        payload: { doc: { type: 'doc', content: [] } },
        order: 100,
      },
    ],
    links: [
      {
        id: 'l1',
        sourceRecordId: RECORD_A,
        targetRecordId: 'file-1',
        linkType: 'file',
      },
    ],
    scientificTables: [
      {
        id: 't1',
        resource_name: 'sheet_aaaaaaaaaaaaaaaaaaaaaaaaaa',
        name: 'Data table',
        columns: [
          {
            id: 'c1',
            fieldName: 'col_aaaaaaaaaaaaaaaaaaaaaaaaaa',
            label: 'Column A',
            logicalType: 'text',
            displayOrder: 0,
          },
        ],
        rows: [],
      },
    ],
    formulas: [
      {
        id: 'f1',
        status: 'supported',
        version: 1,
        calculation: {
          formula_id: 'f1',
          formula_version: 1,
          status: 'completed',
          result_kind: 'value',
          value: 42,
        },
      },
    ],
    files: [],
  }
}

/** Snapshot where the title is empty (blocking failure). */
function failingSnapshot(): Record<string, unknown> {
  return {
    formatVersion: 1,
    record: {
      id: RECORD_A,
      workspaceId: WS_A,
      title: '',
      status: 'draft',
      kind: 'experiment',
    },
    blocks: [],
    links: [],
    scientificTables: [],
    formulas: [],
    files: [],
  }
}

async function runChecks(
  client: Client,
  revisionId: string,
  idempotencyKey: string,
) {
  const { rows } = await client.query(
    `SELECT api.run_revision_checks($1, 'default-scientific-checks', 1, true, $2) AS result`,
    [revisionId, idempotencyKey],
  )
  return rows[0].result as { overallStatus: string; idempotent: boolean }
}

async function approve(client: Client, submissionId: string, digest: string) {
  const { rows } = await client.query(
    `SELECT api.approve_review($1, NULL, 'submitted', $2) AS result`,
    [submissionId, digest],
  )
  return rows[0].result
}

async function sign(
  client: Client,
  submissionId: string,
  meaning: string,
  confirmation: string,
  digest: string,
  signingToken: string | null = null,
) {
  const { rows } = await client.query(
    `SELECT api.sign_revision($1, $2, $3, $4, $5) AS result`,
    [submissionId, meaning, confirmation, digest, signingToken],
  )
  return rows[0].result as {
    signatureId: string
    submissionId: string
    revisionId: string
    signatureMeaning: string
    assuranceLevel: string
    signedAt: string
  }
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  database = drizzle(migratorUrl(), { schema })
  authentication = createAuth(database)

  await migrator!.query(
    `INSERT INTO internal."user" (id,name,email,"emailVerified") VALUES
       ($1,'Owner A','owner-a@sign.test',true),
       ($2,'Reviewer A','reviewer-a@sign.test',true),
       ($3,'Reviewer B','reviewer-b@sign.test',true),
       ($4,'Outsider','outsider@sign.test',true),
       ($5,'Owner B','owner-b@sign.test',true)`,
    [OWNER_A, REVIEWER_A, REVIEWER_B, OUTSIDER, OWNER_B],
  )
  await migrator!.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES
       ($1,'sign-a','SIGN A'),($2,'sign-b','SIGN B')`,
    [WS_A, WS_B],
  )
  await migrator!.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES
       ($1,$2,'owner'),($1,$3,'member'),($1,$4,'member'),($5,$6,'owner')`,
    [WS_A, OWNER_A, REVIEWER_A, REVIEWER_B, WS_B, OWNER_B],
  )
  await migrator!.query(
    `INSERT INTO api.projects(id,workspace_id,key,title,lead_user_id) VALUES
       ($1,$2,'SGNA','SIGN A',$3)`,
    [PROJECT_A, WS_A, OWNER_A],
  )
  await ensureSessions(migrator, [OWNER_A, REVIEWER_A, REVIEWER_B, OWNER_B])
  // Since SET-02 / ADR-0050 a project is private to its lead until an explicit
  // rule exists, so the fixture grants the authority its actors act through.
  await grantProjectAccess(migrator!, {
    workspaceId: WS_A,
    projectId: PROJECT_A,
    userId: OWNER_A,
    canView: true,
    canEdit: true,
    canManage: true,
  })
  for (const reviewerId of [REVIEWER_A, REVIEWER_B]) {
    await grantProjectAccess(migrator!, {
      workspaceId: WS_A,
      projectId: PROJECT_A,
      userId: reviewerId,
      canView: true,
      canReview: true,
    })
  }
  await migrator!.query(
    `INSERT INTO api.records
       (id,workspace_id,project_id,kind,identifier,title,status,properties,tags,created_by_user_id)
     VALUES
       ($1,$2,$3,'experiment','EXP-SGN-A','Sign experiment','draft','{}','{}',$4)`,
    [RECORD_A, WS_A, PROJECT_A, OWNER_A],
  )
  // Sessions for signers (required by sign_revision's session-expiry guard).
  await insertSession(REVIEWER_A)
  await insertSession(REVIEWER_B)
  await insertSession(OUTSIDER)
  await insertSession(OWNER_A)
  const owner = await authenticated(OWNER_A, WS_A)
  for (const userId of [REVIEWER_A, REVIEWER_B]) {
    // Test-only credential setup uses Better Auth, not a parallel hash engine.
    await authentication.api.setPassword({
      headers: headers(userId),
      body: { newPassword: PASSWORD },
    })
    const reviewer = await authenticated(userId, WS_A)
    await reviewer.query('SELECT api.request_signature_identity_verification()')
    await owner.query('SELECT api.verify_signature_identity($1,$2)', [
      userId,
      userId === REVIEWER_A ? 'reviewer-a@sign.test' : 'reviewer-b@sign.test',
    ])
    await reviewer.query('SELECT api.certify_signature($1,1,$2)', [
      WS_A,
      await passwordToken(userId, { purpose: 'certify' }),
    ])
  }
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await database.$client.end()
  await migrator?.end()
})

/** Helper: build a fully approved, checks-passed submission ready to sign. */
async function buildApprovedSubmission(
  reviewerId = REVIEWER_A,
  snapshot: Record<string, unknown> = passingSnapshot(),
): Promise<{
  submissionId: string
  revisionId: string
  digest: string
}> {
  const rev = await insertRevision(RECORD_A, WS_A, snapshot)
  const submissionId = await insertSubmission(rev.id, WS_A, RECORD_A, [
    reviewerId,
  ])
  // Run checks as the reviewer so a passing result exists for the revision.
  const reviewer = await authenticated(reviewerId, WS_A)
  await runChecks(reviewer, rev.id, `checks-${rev.id}`)
  // Approve as the assigned reviewer.
  await approve(reviewer, submissionId, rev.integrityDigest)
  return {
    submissionId,
    revisionId: rev.id,
    digest: rev.integrityDigest,
  }
}

describe('SIGN-001 electronic signatures', () => {
  it('REV-03 refuses a session-only signature even with a typed signer name', async () => {
    const { submissionId, digest } = await buildApprovedSubmission()
    const reviewer = await authenticated(REVIEWER_A, WS_A)

    await expect(
      sign(
        reviewer,
        submissionId,
        'reviewed-and-approved',
        'Reviewer A',
        digest,
      ),
    ).rejects.toMatchObject({ code: 'SB002' })
    const signatures = await reviewer.query(
      'SELECT id FROM api.signatures WHERE submission_id = $1',
      [submissionId],
    )
    expect(signatures.rows).toEqual([])
  })

  it('records a valid signature with full authentication evidence', async () => {
    const { submissionId, revisionId, digest } = await buildApprovedSubmission()
    const reviewer = await authenticated(REVIEWER_A, WS_A)

    const result = await sign(
      reviewer,
      submissionId,
      'reviewed-and-approved',
      'Reviewer A',
      digest,
      await passwordToken(REVIEWER_A, {
        purpose: 'sign',
        submissionId,
        revisionDigest: digest,
      }),
    )

    expect(result.signatureId).toBeTruthy()
    expect(result.signatureMeaning).toBe('reviewed-and-approved')
    expect(result.assuranceLevel).toBe('standard')
    expect(result.submissionId).toBe(submissionId)
    expect(result.revisionId).toBe(revisionId)

    // The evidence row is independently readable and immutable.
    const { rows } = await reviewer.query(
      `SELECT signer_user_id, signer_session_id, signer_role, auth_method,
              signature_meaning, assurance_level, revision_integrity_digest,
              confirmation_phrase
       FROM api.signatures WHERE id = $1`,
      [result.signatureId],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      signer_user_id: REVIEWER_A,
      signer_session_id: 'session-sign-reviewer-a',
      signer_role: 'authenticated',
      auth_method: 'password',
      signature_meaning: 'reviewed-and-approved',
      assurance_level: 'standard',
      revision_integrity_digest: digest,
      confirmation_phrase: 'Reviewer A',
    })
  })

  it('rejects signing when the session has expired', async () => {
    const { submissionId, digest } = await buildApprovedSubmission(REVIEWER_B)
    // Insert an expired session for REVIEWER_B and sign with that session id.
    const expiredSessionId = 'session-expired-reviewer-b'
    await insertSession(REVIEWER_B, expiredSessionId, '2000-01-01T00:00:00Z')
    const reviewer = await authenticated(REVIEWER_B, WS_A, expiredSessionId)

    await expect(
      sign(
        reviewer,
        submissionId,
        'reviewed-and-approved',
        'Reviewer B',
        digest,
      ),
    ).rejects.toMatchObject({ code: 'SB002' })
  })

  it('rejects signing when the revision integrity digest has changed', async () => {
    const { submissionId, digest } = await buildApprovedSubmission()
    const reviewer = await authenticated(REVIEWER_A, WS_A)
    const wrongDigest = '0'.repeat(64)

    expect(wrongDigest).not.toBe(digest)
    await expect(
      sign(
        reviewer,
        submissionId,
        'reviewed-and-approved',
        'Reviewer A',
        wrongDigest,
      ),
    ).rejects.toMatchObject({ code: 'SB001' })
  })

  it('rejects a duplicate signature by the same signer', async () => {
    const { submissionId, digest } = await buildApprovedSubmission()
    const reviewer = await authenticated(REVIEWER_A, WS_A)

    await sign(
      reviewer,
      submissionId,
      'reviewed-and-approved',
      'Reviewer A',
      digest,
      await passwordToken(REVIEWER_A, {
        purpose: 'sign',
        submissionId,
        revisionDigest: digest,
      }),
    )

    // A second signature by the same signer on the same submission is rejected.
    await expect(
      sign(
        reviewer,
        submissionId,
        'reviewed-and-approved',
        'Reviewer A',
        digest,
      ),
    ).rejects.toMatchObject({ code: 'SB010' })
  })

  it('rejects an unauthorised signer who is not an assigned reviewer', async () => {
    const { submissionId, digest } = await buildApprovedSubmission(REVIEWER_A)
    // REVIEWER_B is a workspace member but NOT assigned to this submission.
    const unassigned = await authenticated(REVIEWER_B, WS_A)

    await expect(
      sign(
        unassigned,
        submissionId,
        'reviewed-and-approved',
        'Reviewer B',
        digest,
      ),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('rejects signing when the review is not in the approved state', async () => {
    const rev = await insertRevision(RECORD_A, WS_A, passingSnapshot())
    const submissionId = await insertSubmission(rev.id, WS_A, RECORD_A, [
      REVIEWER_A,
    ])
    const reviewer = await authenticated(REVIEWER_A, WS_A)
    await runChecks(reviewer, rev.id, `checks-not-approved-${rev.id}`)
    // Still 'submitted' — not approved yet.

    await expect(
      sign(
        reviewer,
        submissionId,
        'reviewed-and-approved',
        'Reviewer A',
        rev.integrityDigest,
      ),
    ).rejects.toMatchObject({ code: 'SB007' })
  })

  it('rejects signing when required checks have not been run', async () => {
    const rev = await insertRevision(RECORD_A, WS_A, passingSnapshot())
    const submissionId = await insertSubmission(rev.id, WS_A, RECORD_A, [
      REVIEWER_A,
    ])
    const reviewer = await authenticated(REVIEWER_A, WS_A)
    // Approve without running checks first.
    await approve(reviewer, submissionId, rev.integrityDigest)

    await expect(
      sign(
        reviewer,
        submissionId,
        'reviewed-and-approved',
        'Reviewer A',
        rev.integrityDigest,
      ),
    ).rejects.toMatchObject({ code: 'SB008' })
  })

  it('rejects signing when required checks have blocking failures', async () => {
    const rev = await insertRevision(RECORD_A, WS_A, failingSnapshot())
    const submissionId = await insertSubmission(rev.id, WS_A, RECORD_A, [
      REVIEWER_A,
    ])
    const reviewer = await authenticated(REVIEWER_A, WS_A)
    await runChecks(reviewer, rev.id, `checks-fail-${rev.id}`)
    // Approve despite failing checks (approve_review only checks state/digest/permission).
    await approve(reviewer, submissionId, rev.integrityDigest)

    await expect(
      sign(
        reviewer,
        submissionId,
        'reviewed-and-approved',
        'Reviewer A',
        rev.integrityDigest,
      ),
    ).rejects.toMatchObject({ code: 'SB008' })
  })

  it('rejects signing when the confirmation phrase does not match the signer name', async () => {
    const { submissionId, digest } = await buildApprovedSubmission()
    const reviewer = await authenticated(REVIEWER_A, WS_A)

    await expect(
      sign(
        reviewer,
        submissionId,
        'reviewed-and-approved',
        'Wrong Name',
        digest,
      ),
    ).rejects.toMatchObject({ code: 'SB009' })
  })

  it('rejects signing from outside the workspace', async () => {
    const { submissionId, digest } = await buildApprovedSubmission()
    const outsider = await authenticated(OWNER_B, WS_B)

    await expect(
      sign(outsider, submissionId, 'reviewed-and-approved', 'Owner B', digest),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('prevents updates and deletes of signature evidence', async () => {
    const { submissionId, digest } = await buildApprovedSubmission()
    const reviewer = await authenticated(REVIEWER_A, WS_A)
    const result = await sign(
      reviewer,
      submissionId,
      'reviewed-and-approved',
      'Reviewer A',
      digest,
      await passwordToken(REVIEWER_A, {
        purpose: 'sign',
        submissionId,
        revisionDigest: digest,
      }),
    )

    await expect(
      reviewer.query(
        `UPDATE api.signatures SET signature_meaning = 'witness' WHERE id = $1`,
        [result.signatureId],
      ),
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      reviewer.query(`DELETE FROM api.signatures WHERE id = $1`, [
        result.signatureId,
      ]),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('isolates signatures by workspace', async () => {
    const { submissionId, digest } = await buildApprovedSubmission()
    const reviewer = await authenticated(REVIEWER_A, WS_A)
    await sign(
      reviewer,
      submissionId,
      'reviewed-and-approved',
      'Reviewer A',
      digest,
      await passwordToken(REVIEWER_A, {
        purpose: 'sign',
        submissionId,
        revisionDigest: digest,
      }),
    )

    // Workspace B cannot see workspace A's signatures.
    const ownerB = await authenticated(OWNER_B, WS_B)
    const { rows } = await ownerB.query(`SELECT id FROM api.signatures`)
    expect(rows).toHaveLength(0)
  })

  it('rejects tokens for another submission, rejects reuse, and keeps the correct digest binding', async () => {
    const first = await buildApprovedSubmission()
    const second = await buildApprovedSubmission(REVIEWER_A, {
      ...passingSnapshot(),
      record: {
        id: RECORD_A,
        workspaceId: WS_A,
        title: 'A distinct complete experiment',
        status: 'draft',
        kind: 'experiment',
      },
    })
    expect(first.digest).not.toBe(second.digest)
    const reviewer = await authenticated(REVIEWER_A, WS_A)
    const proof = await passwordToken(REVIEWER_A, {
      purpose: 'sign',
      submissionId: first.submissionId,
      revisionDigest: first.digest,
    })
    await expect(
      sign(
        reviewer,
        second.submissionId,
        'reviewed-and-approved',
        'Reviewer A',
        second.digest,
        proof,
      ),
    ).rejects.toMatchObject({ code: 'SB002' })
    await sign(
      reviewer,
      first.submissionId,
      'reviewed-and-approved',
      'Reviewer A',
      first.digest,
      proof,
    )
    await expect(
      sign(
        reviewer,
        second.submissionId,
        'reviewed-and-approved',
        'Reviewer A',
        second.digest,
        proof,
      ),
    ).rejects.toMatchObject({ code: 'SB002' })
    const signatures = await reviewer.query(
      'SELECT revision_integrity_digest FROM api.signatures WHERE submission_id=$1',
      [second.submissionId],
    )
    expect(signatures.rows).toEqual([])
  })

  it('requires current certification in the database, not only in the token issuer', async () => {
    const { submissionId, digest } = await buildApprovedSubmission(REVIEWER_B)
    const reviewer = await authenticated(REVIEWER_B, WS_A)
    const proof = await passwordToken(REVIEWER_B, {
      purpose: 'sign',
      submissionId,
      revisionDigest: digest,
    })
    await reviewer.query('SELECT api.withdraw_signature_certification($1)', [
      WS_A,
    ])
    await expect(
      sign(
        reviewer,
        submissionId,
        'reviewed-and-approved',
        'Reviewer B',
        digest,
        proof,
      ),
    ).rejects.toMatchObject({ code: '42501' })
    await reviewer.query('SELECT api.certify_signature($1,1,$2)', [
      WS_A,
      await passwordToken(REVIEWER_B, { purpose: 'certify' }),
    ])
    await expect(
      sign(
        reviewer,
        submissionId,
        'reviewed-and-approved',
        'Reviewer B',
        digest,
        proof,
      ),
    ).rejects.toMatchObject({ code: 'SB002' })
    await sign(
      reviewer,
      submissionId,
      'reviewed-and-approved',
      'Reviewer B',
      digest,
      await passwordToken(REVIEWER_B, {
        purpose: 'sign',
        submissionId,
        revisionDigest: digest,
      }),
    )
  })
})
