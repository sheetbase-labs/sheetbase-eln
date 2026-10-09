/**
 * SIGN-002 database contract: lock approved records, amendment workflow,
 * complete history timeline and machine-readable evidence export.
 *
 * Builds on SIGN-001: a reviewed-and-approved signature locks the owning
 * record's scientific evidence against ordinary CRUD. A new draft begins only
 * through api.create_amendment, which records an 'amend' revision, supersedes
 * the locked revision and unlocks the record. The timeline and evidence
 * export RPCs expose the complete, ordered, machine-readable history.
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

const WS_A = '98000000-0000-4000-8000-0000000000a1'
const WS_B = '98000000-0000-4000-8000-0000000000a2'
const PROJECT_A = '99000000-0000-4000-8000-0000000000a1'
const RECORD_A = '9a000000-0000-4000-8000-0000000000a1'
const RECORD_B = '9a000000-0000-4000-8000-0000000000a2'
const OWNER_A = 's2-owner-a'
const REVIEWER_A = 's2-reviewer-a'
const OWNER_B = 's2-owner-b'

let migrator: Client | undefined
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []
let database: ReturnType<typeof drizzle<typeof schema>>
let authentication: ReturnType<typeof createAuth>

function signingHeaders() {
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret) throw new Error('Test auth secret required')
  const token = `token-session-${REVIEWER_A}`
  const signature = createHmac('sha256', secret).update(token).digest('base64')
  return new Headers({
    origin: 'https://sheetbase.test',
    'content-type': 'application/json',
    cookie: `__Secure-better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`,
  })
}

async function passwordToken(input: object) {
  const response = await handleSignatureStepUp(
    new Request('https://sheetbase.test/api/signatures/step-up', {
      method: 'POST',
      headers: signingHeaders(),
      body: JSON.stringify({
        workspaceId: WS_A,
        password: 'sign002-fixture-signing-password',
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

function passingSnapshot(recordId = RECORD_A): Record<string, unknown> {
  return {
    formatVersion: 1,
    record: {
      id: recordId,
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
  return rows[0].result as { overallStatus: string }
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
) {
  const { rows } = await client.query(
    `SELECT api.sign_revision($1, $2, $3, $4, $5) AS result`,
    [
      submissionId,
      meaning,
      confirmation,
      digest,
      await passwordToken({
        purpose: 'sign',
        submissionId,
        revisionDigest: digest,
      }),
    ],
  )
  return rows[0].result as { signatureId: string; revisionId: string }
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  database = drizzle(migratorUrl(), { schema })
  authentication = createAuth(database)

  await migrator!.query(
    `INSERT INTO internal."user" (id,name,email,"emailVerified") VALUES
       ($1,'Owner A','s2-owner-a@sign.test',true),
       ($2,'Reviewer A','s2-reviewer-a@sign.test',true),
       ($3,'Owner B','s2-owner-b@sign.test',true)`,
    [OWNER_A, REVIEWER_A, OWNER_B],
  )
  await migrator!.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES
       ($1,'s2-a','SIGN2 A'),($2,'s2-b','SIGN2 B')`,
    [WS_A, WS_B],
  )
  await migrator!.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES
       ($1,$2,'owner'),($1,$3,'member'),($4,$5,'owner')`,
    [WS_A, OWNER_A, REVIEWER_A, WS_B, OWNER_B],
  )
  await migrator!.query(
    `INSERT INTO api.projects(id,workspace_id,key,title,lead_user_id) VALUES
       ($1,$2,'S2A','SIGN2 A',$3)`,
    [PROJECT_A, WS_A, OWNER_A],
  )
  await ensureSessions(migrator, [OWNER_A, REVIEWER_A, OWNER_B])
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
  await grantProjectAccess(migrator!, {
    workspaceId: WS_A,
    projectId: PROJECT_A,
    userId: REVIEWER_A,
    canView: true,
    canReview: true,
  })
  await migrator!.query(
    `INSERT INTO api.records
       (id,workspace_id,project_id,kind,identifier,title,status,properties,tags,created_by_user_id)
     VALUES
       ($1,$2,$3,'experiment','EXP-S2-A','Sign2 experiment','draft','{}','{}',$4),
       ($5,$2,$3,'experiment','EXP-S2-B','Sign2 experiment B','draft','{}','{}',$4)`,
    [RECORD_A, WS_A, PROJECT_A, OWNER_A, RECORD_B],
  )
  await insertSession(REVIEWER_A)
  await insertSession(OWNER_A)
  await authentication.api.setPassword({
    headers: signingHeaders(),
    body: { newPassword: 'sign002-fixture-signing-password' },
  })
  const reviewer = await authenticated(REVIEWER_A, WS_A)
  await reviewer.query('SELECT api.request_signature_identity_verification()')
  const owner = await authenticated(OWNER_A, WS_A)
  await owner.query('SELECT api.verify_signature_identity($1,$2)', [
    REVIEWER_A,
    's2-reviewer-a@sign.test',
  ])
  await reviewer.query('SELECT api.certify_signature($1,1,$2)', [
    WS_A,
    await passwordToken({ purpose: 'certify' }),
  ])
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await database.$client.end()
  await migrator?.end()
})

/** Build a fully approved, checks-passed submission ready to sign + lock. */
async function buildApprovedAndSign(
  recordId = RECORD_A,
  reviewerId = REVIEWER_A,
): Promise<{
  submissionId: string
  revisionId: string
  digest: string
  signatureId: string
}> {
  const rev = await insertRevision(recordId, WS_A, passingSnapshot(recordId))
  const submissionId = await insertSubmission(rev.id, WS_A, recordId, [
    reviewerId,
  ])
  const reviewer = await authenticated(reviewerId, WS_A)
  await runChecks(reviewer, rev.id, `checks-${rev.id}`)
  await approve(reviewer, submissionId, rev.integrityDigest)
  const result = await sign(
    reviewer,
    submissionId,
    'reviewed-and-approved',
    'Reviewer A',
    rev.integrityDigest,
  )
  return {
    submissionId,
    revisionId: rev.id,
    digest: rev.integrityDigest,
    signatureId: result.signatureId,
  }
}

describe('SIGN-002 lock + amendment + timeline + evidence', () => {
  it('locks the record when a reviewed-and-approved signature is recorded', async () => {
    const { revisionId } = await buildApprovedAndSign()
    const { rows } = await migrator!.query(
      `SELECT locked_at, locked_by_revision_id FROM api.records WHERE id = $1`,
      [RECORD_A],
    )
    expect(rows[0].locked_at).not.toBeNull()
    expect(rows[0].locked_by_revision_id).toBe(revisionId)
  })

  it('rejects ordinary block INSERT on a locked record', async () => {
    const owner = await authenticated(OWNER_A, WS_A)
    await expect(
      owner.query(
        `INSERT INTO api.blocks (record_id, type, payload, payload_schema_version, "order", version)
         VALUES ($1, 'rich_text', '{}'::jsonb, 1, 200, 1)`,
        [RECORD_A],
      ),
    ).rejects.toMatchObject({ code: 'SB011' })
  })

  it('rejects ordinary record metadata UPDATE on a locked record', async () => {
    const owner = await authenticated(OWNER_A, WS_A)
    // RLS makes the locked row invisible to UPDATE, so 0 rows are affected
    // and the title is preserved.
    await owner.query(
      `UPDATE api.records SET title = 'tampered' WHERE id = $1`,
      [RECORD_A],
    )
    const { rows } = await owner.query(
      `SELECT title FROM api.records WHERE id = $1`,
      [RECORD_A],
    )
    expect(rows[0].title).toBe('Sign2 experiment')
  })

  it('rejects a submit on a locked record (amendment is the only path)', async () => {
    const owner = await authenticated(OWNER_A, WS_A)
    // Read the real source digest so the lock guard (not the digest guard)
    // is what rejects the submit.
    const { rows: previewRows } = await owner.query(
      `SELECT api.preview_submission_digest($1) AS result`,
      [RECORD_A],
    )
    const digest = (previewRows[0].result as { sourceDigest: string })
      .sourceDigest
    await expect(
      owner.query(
        `SELECT api.submit_record_revision($1, $2, 'default-scientific-review', 1, ARRAY[$3], true, 'locked-submit') AS result`,
        [RECORD_A, digest, REVIEWER_A],
      ),
    ).rejects.toMatchObject({ code: 'SB011' })
  })

  it('create_amendment unlocks the record and supersedes the locked revision', async () => {
    const owner = await authenticated(OWNER_A, WS_A)
    const { rows } = await owner.query(
      `SELECT api.create_amendment($1, 'Corrected concentration') AS result`,
      [RECORD_A],
    )
    const result = rows[0].result as {
      revisionId: string
      supersedesRevisionId: string
      unlockedAt: string
    }
    expect(result.revisionId).toBeTruthy()
    expect(result.supersedesRevisionId).toBeTruthy()

    // The record is unlocked.
    const { rows: recRows } = await migrator!.query(
      `SELECT locked_at, locked_by_revision_id FROM api.records WHERE id = $1`,
      [RECORD_A],
    )
    expect(recRows[0].locked_at).toBeNull()
    expect(recRows[0].locked_by_revision_id).toBeNull()

    // The new revision has reason 'amend'.
    const { rows: amendRows } = await migrator!.query(
      `SELECT reason, superseded_by_revision_id FROM api.revisions WHERE id = $1`,
      [result.revisionId],
    )
    expect(amendRows[0].reason).toBe('amend')

    // The locked revision is superseded by the amendment.
    const { rows: oldRows } = await migrator!.query(
      `SELECT superseded_by_revision_id FROM api.revisions WHERE id = $1`,
      [result.supersedesRevisionId],
    )
    expect(oldRows[0].superseded_by_revision_id).toBe(result.revisionId)
  })

  it('allows ordinary block INSERT again after the amendment unlocks the record', async () => {
    const owner = await authenticated(OWNER_A, WS_A)
    const { rowCount } = await owner.query(
      `INSERT INTO api.blocks (record_id, type, payload, payload_schema_version, "order", version, created_by_user_id)
       VALUES ($1, 'rich_text', '{}'::jsonb, 1, 300, 1, $2)`,
      [RECORD_A, OWNER_A],
    )
    expect(rowCount).toBe(1)
  })

  it('rejects create_amendment on a record that is not locked', async () => {
    const owner = await authenticated(OWNER_A, WS_A)
    await expect(
      owner.query(`SELECT api.create_amendment($1, NULL) AS result`, [
        RECORD_A,
      ]),
    ).rejects.toMatchObject({ code: 'SB012' })
  })

  it('record_timeline returns ordered events including the lock and amendment', async () => {
    const owner = await authenticated(OWNER_A, WS_A)
    const { rows } = await owner.query(
      `SELECT api.record_timeline($1) AS result`,
      [RECORD_A],
    )
    const events = rows[0].result as Array<{ type: string; ts: string }>
    expect(events.length).toBeGreaterThan(0)
    const types = events.map((e) => e.type)
    // The timeline aggregates revisions, submissions, decisions, checks,
    // signatures and change_events (lock + amend).
    expect(types).toContain('revision')
    expect(types).toContain('submission')
    expect(types).toContain('decision')
    expect(types).toContain('check')
    expect(types).toContain('signature')
    // Change events for the lock and amendment operations.
    const lockEvents = events.filter(
      (e) =>
        e.type === 'change_event' &&
        (e as { operation?: string }).operation === 'lock',
    )
    expect(lockEvents.length).toBe(1)
    const amendEvents = events.filter(
      (e) =>
        e.type === 'change_event' &&
        (e as { operation?: string }).operation === 'amend',
    )
    expect(amendEvents.length).toBe(1)
    // Chronological order: timestamps non-decreasing.
    for (let i = 1; i < events.length; i++) {
      expect(events[i].ts >= events[i - 1].ts).toBe(true)
    }
  })

  it('revision_evidence_package returns a machine-readable bundle', async () => {
    // Lock record B and export its evidence. DATA-02 consolidated the old
    // export_revision_evidence RPC into api.revision_evidence_package, which
    // additionally carries Sheet evidence and the retained file manifest.
    const { revisionId } = await buildApprovedAndSign(RECORD_B, REVIEWER_A)
    const owner = await authenticated(OWNER_A, WS_A)
    const { rows } = await owner.query(
      `SELECT api.revision_evidence_package($1) AS result`,
      [revisionId],
    )
    const bundle = rows[0].result as {
      revision: { id: string; integrityDigest: string; reason: string }
      submission: { id: string; state: string } | null
      decisions: { decision: string }[]
      checkResults: { overall_status: string }[]
      signatures: { signature_meaning: string }[]
      comments: unknown[]
      files: unknown[]
      sheetEvidence: unknown[]
    }
    expect(bundle.revision.id).toBe(revisionId)
    expect(bundle.revision.integrityDigest).toMatch(/^[0-9a-f]{64}$/)
    expect(bundle.submission).not.toBeNull()
    expect(bundle.submission?.state).toBe('approved')
    expect(bundle.decisions.some((d) => d.decision === 'approve')).toBe(true)
    expect(bundle.checkResults.length).toBeGreaterThan(0)
    expect(
      bundle.signatures.some(
        (s) => s.signature_meaning === 'reviewed-and-approved',
      ),
    ).toBe(true)
    expect(Array.isArray(bundle.comments)).toBe(true)
    expect(Array.isArray(bundle.files)).toBe(true)
    expect(Array.isArray(bundle.sheetEvidence)).toBe(true)
  })

  it('isolates timeline and evidence by workspace', async () => {
    const ownerB = await authenticated(OWNER_B, WS_B)
    // Workspace B cannot see RECORD_A: the timeline RPC denies cross-workspace
    // access rather than leaking an empty history.
    await expect(
      ownerB.query(`SELECT api.record_timeline($1) AS result`, [RECORD_A]),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('prevents edits to audit records (review_decisions, signatures)', async () => {
    // record B is locked; its signature is immutable.
    const { rows: sigRows } = await migrator!.query(
      `SELECT id FROM api.signatures WHERE record_id = $1 LIMIT 1`,
      [RECORD_B],
    )
    const owner = await authenticated(OWNER_A, WS_A)
    await expect(
      owner.query(
        `UPDATE api.signatures SET signature_meaning = 'witness' WHERE id = $1`,
        [sigRows[0].id],
      ),
    ).rejects.toMatchObject({ code: '42501' })

    // review_decisions has no UPDATE grant for authenticated.
    const { rows: decRows } = await migrator!.query(
      `SELECT id FROM api.review_decisions WHERE record_id = $1 LIMIT 1`,
      [RECORD_B],
    )
    await expect(
      owner.query(
        `UPDATE api.review_decisions SET note = 'tampered' WHERE id = $1`,
        [decRows[0].id],
      ),
    ).rejects.toMatchObject({ code: '42501' })
  })
})
