/**
 * The demo's signing story (demo only).
 *
 * The demo has no sign-in, so nobody in it can enter a signing password. Its
 * people are certified to sign by typing their name instead, and a signature
 * made that way is recorded and shown as a "Demo signature" (migration 0046).
 *
 * Most approved records then arrive signed, the way a lab that has been using
 * the product for a while would have them, and a few are left for the person
 * viewing to sign. Everything goes through the same sign RPC the app uses; the
 * demo grant stands in only for the password step.
 */
import { createHash, randomBytes } from 'node:crypto'
import { sql } from 'drizzle-orm'

import { personaSessionId } from '#/lib/demo-persona'
import { FIXTURE_USER_ID } from './identities'
import { withDesignClaims } from './claims'
import type { SeedStep } from './run'

type Db = Parameters<SeedStep['run']>[0]

/** People who may sign. Viewers and portal clients never do. */
const SIGNING_ROLES = [
  'owner',
  'admin',
  'member',
  'editor',
  'reviewer',
  'steward',
]

const ROLE_LIST = sql.join(
  SIGNING_ROLES.map((role) => sql`${role}`),
  sql`, `,
)

/** Approved records left unsigned so the person viewing still has some to sign. */
const LEAVE_UNSIGNED: Record<string, number> = {
  'Mei L.': 4,
  'Gareth P.': 3,
}

/** Only where sign-in is off: a real install never gets demo signers. */
export function demoSigningEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.SHEETBASE_DEV_AUTH_FREE === 'true'
}

export async function seedDemoSigning(db: Db): Promise<void> {
  if (!demoSigningEnabled()) return
  await certifyDemoPeople(db)
  await decideRetiredReviews(db)
  await signApprovedRecords(db)
}

/**
 * Nobody can act on a review in a retired project, so none should be left
 * waiting in an inbox: the reviewer decides it before the project closes.
 */
async function decideRetiredReviews(db: Db): Promise<void> {
  const waiting = await db.execute<{
    submission_id: string
    workspace_id: string
    project_id: string
    digest: string
    reviewer_id: string
    revision_id: string
  }>(sql`
    SELECT rs.id AS submission_id, rs.workspace_id, p.id AS project_id,
           v.integrity_digest AS digest, v.id AS revision_id,
           rs.assigned_reviewer_user_ids[1] AS reviewer_id
      FROM api.review_submissions rs
      JOIN api.records r ON r.id = rs.record_id
      JOIN api.projects p ON p.id = r.project_id AND p.archived_at IS NOT NULL
      JOIN api.revisions v ON v.id = rs.revision_id
     WHERE rs.state = 'submitted'`)
  for (const item of waiting.rows) {
    await whileProjectOpen(db, item.project_id, async () => {
      await withDesignClaims(
        db,
        item.reviewer_id,
        item.workspace_id,
        async (client) => {
          await client.query(
            `select api.run_revision_checks($1,'default-scientific-checks',1,true,$2)`,
            [item.revision_id, `demo-retired-${item.submission_id}-checks`],
          )
          await client.query('select api.approve_review($1,$2,$3,$4)', [
            item.submission_id,
            'Results meet acceptance criteria. Approved before the project closed.',
            'submitted',
            item.digest,
          ])
        },
        personaSessionId(item.reviewer_id),
      )
    })
  }
}

/** Runs `fn` with an archived project briefly open, then closes it as it was. */
async function whileProjectOpen(
  db: Db,
  projectId: string,
  fn: () => Promise<void>,
): Promise<void> {
  const before = await db.execute<{ archived_at: Date | null }>(
    sql`SELECT archived_at FROM api.projects WHERE id = ${projectId}`,
  )
  const archivedAt = before.rows[0]?.archived_at
  if (!archivedAt) return fn()
  await db.execute(
    sql`UPDATE api.projects SET archived_at = NULL WHERE id = ${projectId}`,
  )
  try {
    await fn()
  } finally {
    await db.execute(
      sql`UPDATE api.projects SET archived_at = ${new Date(archivedAt).toISOString()}::timestamptz WHERE id = ${projectId}`,
    )
  }
}

/** Every person who can sign gets a session of their own and a demo certification. */
async function certifyDemoPeople(db: Db): Promise<void> {
  await db.execute(sql`
    INSERT INTO internal.session (id, token, "userId", "expiresAt")
    SELECT DISTINCT 'dev-auth-free-session-' || m.user_id,
           'dev-auth-free-session-' || m.user_id || '-token', m.user_id,
           now() + interval '365 days'
      FROM api.workspace_memberships m
     WHERE m.role IN (${ROLE_LIST}) AND m.suspended_at IS NULL
    ON CONFLICT (id) DO UPDATE SET "expiresAt" = excluded."expiresAt"`)
  // A password-certified person (the fixture's own) keeps that; the others are
  // certified for the demo, verified by the fixture owner.
  await db.execute(sql`
    INSERT INTO api.user_signature_certifications
      (workspace_id, user_id, statement_version, certified_at, identity_verified_by,
       identity_verified_at, verified_email, certified_session_id, auth_method)
    SELECT m.workspace_id, m.user_id,
           coalesce(ws.signature_statement_version, 1), now(), ${FIXTURE_USER_ID},
           now(), u.email, 'dev-auth-free-session-' || m.user_id, 'demo'
      FROM api.workspace_memberships m
      JOIN internal."user" u ON u.id = m.user_id
      LEFT JOIN api.workspace_settings ws ON ws.workspace_id = m.workspace_id
     WHERE m.role IN (${ROLE_LIST}) AND m.suspended_at IS NULL
       AND m.user_id <> ${FIXTURE_USER_ID}
    ON CONFLICT (workspace_id, user_id) DO UPDATE SET
      statement_version = excluded.statement_version,
      certified_at = excluded.certified_at,
      revoked_at = NULL,
      identity_verified_by = excluded.identity_verified_by,
      identity_verified_at = excluded.identity_verified_at,
      verified_email = excluded.verified_email,
      certified_session_id = excluded.certified_session_id,
      auth_method = excluded.auth_method
    WHERE api.user_signature_certifications.auth_method IS DISTINCT FROM 'password'
       OR api.user_signature_certifications.certified_at IS NULL`)
}

interface Pending {
  submissionId: string
  workspaceId: string
  digest: string
  approverId: string
  approverName: string
  decidedAt: Date
  projectId: string
}

async function signApprovedRecords(db: Db): Promise<void> {
  const rows = await db.execute<{
    submission_id: string
    workspace_id: string
    digest: string
    approver_id: string
    approver_name: string
    decided_at: Date
    project_id: string
  }>(sql`
    SELECT r.project_id, rs.id AS submission_id, rs.workspace_id, v.integrity_digest AS digest,
           d.actor_user_id AS approver_id, u.name AS approver_name,
           d.created_at AS decided_at
      FROM api.review_submissions rs
      JOIN api.records r ON r.id = rs.record_id AND r.locked_at IS NULL
      JOIN api.revisions v ON v.id = rs.revision_id
                          AND v.superseded_by_revision_id IS NULL
      JOIN LATERAL (
        SELECT * FROM api.review_decisions x
         WHERE x.submission_id = rs.id AND x.decision = 'approve'
         ORDER BY x.created_at DESC LIMIT 1) d ON true
      JOIN internal."user" u ON u.id = d.actor_user_id
     WHERE rs.state = 'approved'
       AND rs.submitted_by_user_id <> d.actor_user_id
       AND NOT EXISTS (SELECT 1 FROM api.signatures s WHERE s.submission_id = rs.id)
     ORDER BY d.created_at DESC, rs.id`)
  const pending: Pending[] = rows.rows.map((r) => ({
    submissionId: r.submission_id,
    workspaceId: r.workspace_id,
    digest: r.digest,
    approverId: r.approver_id,
    approverName: r.approver_name,
    decidedAt: new Date(r.decided_at),
    projectId: r.project_id,
  }))
  const kept = new Map<string, number>()
  const skipped: string[] = []
  for (const item of pending) {
    // Newest first: the ones left for the viewer are the freshest approvals.
    const left = kept.get(item.approverName) ?? 0
    if (left < (LEAVE_UNSIGNED[item.approverName] ?? 0)) {
      kept.set(item.approverName, left + 1)
      continue
    }
    try {
      await whileProjectOpen(db, item.projectId, () => signAsDemo(db, item))
    } catch (error) {
      // A review in an archived project cannot be signed; it stays as it is.
      skipped.push((error as Error).message)
    }
  }
  if (skipped.length)
    console.log(`seed: ${skipped.length} approved records left unsigned`)
}

async function signAsDemo(db: Db, item: Pending): Promise<void> {
  const sessionId = personaSessionId(item.approverId)
  const token = randomBytes(32).toString('base64url')
  const tokenHash = createHash('sha256').update(token).digest('hex')
  await db.execute(sql`
    INSERT INTO internal.signature_grants
      (token_hash, user_id, session_id, workspace_id, purpose, submission_id,
       revision_digest, signature_meaning, auth_method, expires_at)
    VALUES (${tokenHash}, ${item.approverId}, ${sessionId}, ${item.workspaceId},
            'sign', ${item.submissionId}, ${item.digest},
            'reviewed-and-approved', 'demo', clock_timestamp() + interval '5 minutes')`)
  await withDesignClaims(
    db,
    item.approverId,
    item.workspaceId,
    async (client) => {
      await client.query('select api.sign_revision($1,$2,$3,$4,$5)', [
        item.submissionId,
        'reviewed-and-approved',
        item.approverName,
        item.digest,
        token,
      ])
    },
    sessionId,
  )
  // Signed a little after it was approved, not on the day the demo was seeded.
  const signedBy = item.decidedAt.toISOString()
  await db.execute(sql`ALTER TABLE api.signatures DISABLE TRIGGER USER`)
  await db.execute(sql`ALTER TABLE api.records DISABLE TRIGGER USER`)
  try {
    await db.execute(sql`
      UPDATE api.signatures SET
        signed_at = least(${signedBy}::timestamptz + interval '2 hours', signed_at),
        created_at = least(${signedBy}::timestamptz + interval '2 hours', created_at)
       WHERE submission_id = ${item.submissionId}`)
    await db.execute(sql`
      UPDATE api.records SET
        locked_at = least(${signedBy}::timestamptz + interval '2 hours', locked_at)
       WHERE id = (SELECT record_id FROM api.review_submissions WHERE id = ${item.submissionId})
         AND locked_at IS NOT NULL`)
  } finally {
    await db.execute(sql`ALTER TABLE api.signatures ENABLE TRIGGER USER`)
    await db.execute(sql`ALTER TABLE api.records ENABLE TRIGGER USER`)
  }
}
