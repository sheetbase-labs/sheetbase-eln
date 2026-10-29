/**
 * REV-05.2 — the audit trail and signature check, shared by the nightly script
 * (`pnpm audit:verify`) and the server's own schedule.
 *
 * Each workspace's hash chain and every signed revision's integrity digest are
 * verified by `api.run_audit_verification`, which records the result as a System
 * entry in the audit log. Settings and the signed records read that entry back
 * as "verified, last checked".
 */
import type { QueryResultRow } from 'pg'

export interface VerificationResult {
  ok: boolean
  chain: {
    ok: boolean
    entriesChecked: number
    firstBadSequence: number | null
  }
  signedRevisions: {
    ok: boolean
    checked: number
    firstBadSignatureId: string | null
    firstBadRevisionId: string | null
  }
}

export interface VerificationQueryable {
  query: <T extends QueryResultRow>(
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: T[] }>
}

export interface WorkspaceVerification {
  slug: string
  result: VerificationResult
}

/** A check older than this is run again by the server's schedule. */
export const VERIFICATION_MAX_AGE_MS = 24 * 60 * 60 * 1000

/**
 * Verify every workspace whose last check is older than `maxAgeMs` (0 checks all
 * of them). Must run as the database owner role: the function accepts no other
 * caller without a user session.
 */
export async function verifyWorkspaces(
  db: VerificationQueryable,
  maxAgeMs: number,
): Promise<WorkspaceVerification[]> {
  const { rows: workspaces } = await db.query<{ id: string; slug: string }>(
    `select w.id, w.slug
       from api.workspaces w
      where $1::bigint <= 0
         or coalesce((select max(e.created_at)
                        from api.change_events e
                       where e.workspace_id = w.id
                         and e.entity_type = 'system'
                         and e.payload ? 'chain'),
                     '-infinity'::timestamptz)
            < now() - ($1::bigint * interval '1 millisecond')
      order by w.slug`,
    [maxAgeMs],
  )
  const checked: WorkspaceVerification[] = []
  for (const workspace of workspaces) {
    const { rows } = await db.query<{ result: VerificationResult }>(
      'select api.run_audit_verification($1) as result',
      [workspace.id],
    )
    checked.push({ slug: workspace.slug, result: rows[0].result })
  }
  return checked
}
