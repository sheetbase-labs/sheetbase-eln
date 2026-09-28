/**
 * REV-007 — Review & Approvals workspace data layer.
 *
 * Combines the REV-002 submission + revision, REV-003 version diffs, REV-004
 * anchored comments, REV-005 check results and the REV-007 review-decision
 * transition RPCs into the single data surface the `/review/$revisionId`
 * workspace route renders. Reads go through the same-origin `/api/db`
 * boundary and RLS; the four transition RPCs are SECURITY DEFINER and enforce
 * the active / not-superseded / digest / permission guards server-side, so
 * the UI mirroring those guards can never offer an action the database will
 * refuse.
 */
import type { DataClient } from './data-client'
import { notebookDataClient } from './notebook-data'
import type { RevisionWire } from './notebook-data'
import type { CanonicalRevisionEnvelope } from './revision-diff'
import type { ReviewSubmissionWire } from './reviews'

// ---------------------------------------------------------------------------
// Wire shapes (snake_case, as returned by PostgREST).
// ---------------------------------------------------------------------------

/** A row from `api.review_decisions` (REV-007). */
export interface ReviewDecisionWire {
  id: string
  workspace_id: string
  submission_id: string
  revision_id: string
  record_id: string
  decision: 'request_changes' | 'reject' | 'approve' | 'withdraw'
  note: string | null
  revision_integrity_digest: string
  actor_user_id: string
  actor_session_id: string
  actor_role: string
  created_at: string
}

/** A lightweight revision row for the comparison picker. */
export interface RevisionOptionWire {
  id: string
  record_id: string
  reason: string
  integrity_digest: string
  superseded_by_revision_id: string | null
  created_at: string
  created_by_user_id: string
}

// ---------------------------------------------------------------------------
// Domain shapes (camelCase, consumed by the workspace UI).
// ---------------------------------------------------------------------------

export type ReviewDecisionKind =
  'request_changes' | 'reject' | 'approve' | 'withdraw'

/** The terminal state a decision transitions a submission into. */
export const DECISION_NEXT_STATE: Record<ReviewDecisionKind, string> = {
  request_changes: 'returned',
  reject: 'rejected',
  approve: 'approved',
  withdraw: 'withdrawn',
}

/** Result returned by the four transition RPCs. */
export interface ReviewDecisionResult {
  submissionId: string
  revisionId: string
  decision: ReviewDecisionKind
  state: string
  decisionId: string
  createdAt: string
}

// ---------------------------------------------------------------------------
// Query keys.
// ---------------------------------------------------------------------------

export const reviewWorkspaceQueryKeys = {
  submissionForRevision: (revisionId: string) =>
    ['rev-007', 'submission-for-revision', revisionId] as const,
  revision: (revisionId: string) =>
    ['rev-007', 'revision', revisionId] as const,
  revisionOptions: (recordId: string) =>
    ['rev-007', 'revision-options', recordId] as const,
  decisions: (submissionId: string) =>
    ['rev-007', 'decisions', submissionId] as const,
}

export const reviewWorkspaceDataClient: DataClient = notebookDataClient

// ---------------------------------------------------------------------------
// Fetch helpers.
// ---------------------------------------------------------------------------

/** Fetch the submission that pins a revision for review, if any. */
export function fetchReviewSubmissionByRevision(
  client: DataClient,
  revisionId: string,
): Promise<ReviewSubmissionWire | null> {
  return client
    .list<ReviewSubmissionWire>(
      'review_submissions',
      `?revision_id=eq.${revisionId}&limit=1`,
    )
    .then((rows) => (rows.length > 0 ? rows[0] : null))
}

/** Fetch a single revision row by id. */
export function fetchRevisionRow(
  client: DataClient,
  revisionId: string,
): Promise<RevisionWire | null> {
  return client
    .list<RevisionWire>('revisions', `?id=eq.${revisionId}&limit=1`)
    .then((rows) => (rows.length > 0 ? rows[0] : null))
}

/** Fetch every revision of a record, newest-first, for the comparison picker. */
export function fetchRevisionOptionsForRecord(
  client: DataClient,
  recordId: string,
): Promise<RevisionOptionWire[]> {
  return client.list<RevisionOptionWire>(
    'revisions',
    `?record_id=eq.${recordId}&order=created_at.desc&select=id,record_id,reason,integrity_digest,superseded_by_revision_id,created_at,created_by_user_id`,
  )
}

/** Fetch every decision recorded against a submission, oldest-first. */
export function fetchReviewDecisions(
  client: DataClient,
  submissionId: string,
): Promise<ReviewDecisionWire[]> {
  return client.list<ReviewDecisionWire>(
    'review_decisions',
    `?submission_id=eq.${submissionId}&order=created_at.asc`,
  )
}

// ---------------------------------------------------------------------------
// Canonical envelope parsing — turns the stored `canonical_snapshot` jsonb
// into the typed shape the REV-003 diff engine consumes.
// ---------------------------------------------------------------------------

/**
 * Parse a revision's `canonical_snapshot` into a `CanonicalRevisionEnvelope`.
 * Falls back to a minimal envelope built from `metadata_snapshot` +
 * `block_snapshot` for legacy revisions that predate REV-002's
 * `canonical_snapshot` column, so the workspace can still render them.
 */
export function toCanonicalEnvelope(
  revision: RevisionWire,
): CanonicalRevisionEnvelope {
  const canonical = revision.canonical_snapshot
  if (canonical && typeof canonical === 'object' && 'blocks' in canonical) {
    return canonical as unknown as CanonicalRevisionEnvelope
  }
  return {
    formatVersion: 0,
    record: revision.metadata_snapshot,
    blocks: revision.block_snapshot,
    links: [],
    scientificTables: [],
    formulas: [],
    files: [],
  }
}

// ---------------------------------------------------------------------------
// Transition RPCs. Each wraps a SECURITY DEFINER RPC that enforces the
// active / not-superseded / digest / permission guards server-side.
// ---------------------------------------------------------------------------

export interface ReviewDecisionInput {
  submissionId: string
  note?: string
  /** The state the actor believed the submission was in ('submitted'). */
  expectedState?: string
  /** The digest of the revision the actor viewed, to reject stale actions. */
  expectedRevisionDigest: string
}

function decide(
  client: DataClient,
  rpc: string,
  input: ReviewDecisionInput,
): Promise<ReviewDecisionResult> {
  return client.rpc(rpc, {
    p_submission_id: input.submissionId,
    p_note: input.note ?? null,
    p_expected_state: input.expectedState ?? 'submitted',
    p_expected_revision_digest: input.expectedRevisionDigest,
  })
}

export function requestChangesOnReview(
  client: DataClient,
  input: ReviewDecisionInput,
): Promise<ReviewDecisionResult> {
  return decide(client, 'request_changes_on_review', input)
}

export function rejectReview(
  client: DataClient,
  input: ReviewDecisionInput,
): Promise<ReviewDecisionResult> {
  return decide(client, 'reject_review', input)
}

export function approveReview(
  client: DataClient,
  input: ReviewDecisionInput,
): Promise<ReviewDecisionResult> {
  return decide(client, 'approve_review', input)
}

export function withdrawReview(
  client: DataClient,
  input: ReviewDecisionInput,
): Promise<ReviewDecisionResult> {
  return decide(client, 'withdraw_review', input)
}

// ---------------------------------------------------------------------------
// Action-permission derivation.
//
// The UI mirrors the server-side guards so it never offers an action the
// database will refuse. The RPC remains the authority — these helpers only
// decide whether a button is enabled and what consequence to surface.
// ---------------------------------------------------------------------------

export interface ReviewActionPermission {
  /** May request changes / reject / approve (assigned reviewer, active). */
  canReview: boolean
  /** May withdraw (original submitter, active). */
  canWithdraw: boolean
  /** Why the review actions are unavailable, for the consequence banner. */
  reviewBlockedReason: ReviewBlockedReason | null
  /** Why withdraw is unavailable. */
  withdrawBlockedReason: ReviewBlockedReason | null
}

export type ReviewBlockedReason =
  'not_active' | 'superseded' | 'not_assigned_reviewer' | 'not_submitter'

export interface ReviewActionContext {
  state: string
  supersededByRevisionId: string | null
  assignedReviewerUserIds: string[]
  submittedByUserId: string
  currentUserId: string
}

export function deriveReviewActionPermission(
  ctx: ReviewActionContext,
): ReviewActionPermission {
  const isActive = ctx.state === 'submitted'
  const isSuperseded = ctx.supersededByRevisionId !== null
  const isAssignedReviewer = ctx.assignedReviewerUserIds.includes(
    ctx.currentUserId,
  )
  const isSubmitter = ctx.submittedByUserId === ctx.currentUserId

  function reviewReason(): ReviewBlockedReason | null {
    if (!isActive) return 'not_active'
    if (isSuperseded) return 'superseded'
    if (!isAssignedReviewer) return 'not_assigned_reviewer'
    return null
  }

  function withdrawReason(): ReviewBlockedReason | null {
    if (!isActive) return 'not_active'
    if (isSuperseded) return 'superseded'
    if (!isSubmitter) return 'not_submitter'
    return null
  }

  const reviewBlockedReason = reviewReason()
  const withdrawBlockedReason = withdrawReason()
  return {
    canReview: reviewBlockedReason === null,
    canWithdraw: withdrawBlockedReason === null,
    reviewBlockedReason,
    withdrawBlockedReason,
  }
}

/** Human-readable consequence for a blocked action, for the action dialog. */
export function blockedReasonLabel(reason: ReviewBlockedReason): string {
  switch (reason) {
    case 'not_active':
      return 'This review is no longer active — it has been withdrawn or already completed.'
    case 'superseded':
      return 'This revision has been superseded by a newer submission.'
    case 'not_assigned_reviewer':
      return 'You are not an assigned reviewer for this submission.'
    case 'not_submitter':
      return 'Only the original submitter may withdraw this review.'
  }
}

/** Human-readable consequence of each decision, shown before confirmation. */
export const DECISION_CONSEQUENCE: Record<ReviewDecisionKind, string> = {
  request_changes:
    'Returns the submission to the author with your note. The revision is not approved; a new revision must be submitted to resume review.',
  reject:
    'Closes the review as rejected. The revision is not approved and cannot be re-activated; a new revision must be submitted if changes are wanted.',
  approve:
    'Approves the revision. This is the final review decision — the submission cannot be re-opened. Signing and locking follow this approval.',
  withdraw:
    'Withdraws the submission from review. The revision remains visible in history but is no longer active; a new revision must be submitted to resume.',
}
