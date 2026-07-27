/**
 * SIGN-002 — Lock approved records, amendment workflow, complete history
 * timeline and machine-readable evidence export.
 *
 * The browser invokes `create_amendment`, `record_timeline` and
 * `export_revision_evidence` through the same-origin `/api/db/rpc` boundary
 * (AUTH-003). The three SECURITY DEFINER RPCs enforce workspace membership and
 * the lock/amendment guards server-side, so the UI can mirror them without
 * ever offering an action the database will refuse.
 *
 * Lock state (`locked_at` / `locked_by_revision_id`) is read from the
 * `records` REST resource alongside the rest of the record wire shape, so the
 * notebook, overview, review workspace and API all show one consistent lock
 * state.
 */
import type { DataClient } from './data-client'
import { notebookDataClient } from './notebook-data'

// ---------------------------------------------------------------------------
// Wire shapes (snake_case, as returned by PostgREST / the RPCs).
// ---------------------------------------------------------------------------

/** Lock state read from a `records` row. */
export interface RecordLockStateWire {
  id: string
  locked_at: string | null
  locked_by_revision_id: string | null
}

/** A single chronological entry returned by `api.record_timeline`. */
export interface TimelineEventWire {
  type:
    | 'change_event'
    | 'revision'
    | 'submission'
    | 'decision'
    | 'check'
    | 'signature'
    | 'comment'
  id: string
  /** Monotonic per-workspace change-event sequence, present for change_events. */
  seq: number | null
  /** ISO-8601 UTC timestamp used to sort the timeline. */
  ts: string
  /** Human-readable summary, e.g. "review approve" or "signature approve-for-record". */
  title: string
  /** Actor user id (Better Auth), null for system/bootstrap events. */
  actorUserId: string | null
  /** Type-specific detail (operation, state, decision, reason, digest, …). */
  [key: string]: unknown
}

/** The full evidence bundle returned by `api.export_revision_evidence`. */
export interface EvidenceExportWire {
  formatVersion: number
  exportedAt: string
  workspaceId: string
  revision: {
    id: string
    record_id: string
    reason: string
    structure_version: number
    metadata_version: number
    integrity_algorithm: string
    integrity_digest: string
    canonical_snapshot: Record<string, unknown>
    superseded_by_revision_id: string | null
    created_at: string
    created_by_user_id: string
  }
  /** Snake-case row dump from api.review_submissions, or null. */
  submission: Record<string, unknown> | null
  /** Snake-case row dumps from api.review_decisions. */
  decisions: Record<string, unknown>[]
  /** Snake-case row dumps from api.review_check_results. */
  checkResults: Record<string, unknown>[]
  /** Snake-case row dumps from api.signatures. */
  signatures: Record<string, unknown>[]
  /** Snake-case row dumps from api.comments. */
  comments: Record<string, unknown>[]
}

// ---------------------------------------------------------------------------
// Domain shapes (camelCase, consumed by the workspace UI).
// ---------------------------------------------------------------------------

/** Result returned by the `create_amendment` RPC. */
export interface CreateAmendmentResult {
  revisionId: string
  supersedesRevisionId: string | null
  recordId: string
  integrityDigest: string
  unlockedAt: string
}

export interface CreateAmendmentInput {
  recordId: string
  /** Optional human-readable reason for the amendment, recorded in the event. */
  note?: string
}

// ---------------------------------------------------------------------------
// Query keys.
// ---------------------------------------------------------------------------

export const sign002QueryKeys = {
  lockState: (recordId: string) =>
    ['sign-002', 'lock-state', recordId] as const,
  timeline: (recordId: string) => ['sign-002', 'timeline', recordId] as const,
  evidenceExport: (revisionId: string) =>
    ['sign-002', 'evidence-export', revisionId] as const,
}

export const sign002DataClient: DataClient = notebookDataClient

// ---------------------------------------------------------------------------
// Fetch helpers.
// ---------------------------------------------------------------------------

/** Read the lock state for a record from the `records` REST resource. */
export function fetchRecordLockState(
  client: DataClient,
  recordId: string,
): Promise<RecordLockStateWire | null> {
  return client
    .list<RecordLockStateWire>(
      'records',
      `?id=eq.${recordId}&select=id,locked_at,locked_by_revision_id&limit=1`,
    )
    .then((rows) => (rows.length > 0 ? rows[0] : null))
}

/** Fetch the chronological timeline for a record via the `record_timeline` RPC. */
export function fetchRecordTimeline(
  client: DataClient,
  recordId: string,
): Promise<TimelineEventWire[]> {
  return client.rpc<TimelineEventWire[]>('record_timeline', {
    p_record_id: recordId,
  })
}

/** Fetch the machine-readable evidence bundle for a revision. */
export function fetchRevisionEvidenceExport(
  client: DataClient,
  revisionId: string,
): Promise<EvidenceExportWire> {
  return client.rpc<EvidenceExportWire>('export_revision_evidence', {
    p_revision_id: revisionId,
  })
}

// ---------------------------------------------------------------------------
// create_amendment RPC wrapper.
// ---------------------------------------------------------------------------

export function createAmendment(
  client: DataClient,
  input: CreateAmendmentInput,
): Promise<CreateAmendmentResult> {
  return client.rpc('create_amendment', {
    p_record_id: input.recordId,
    p_note: input.note ?? null,
  })
}

// ---------------------------------------------------------------------------
// Display helpers.
// ---------------------------------------------------------------------------

/** Whether a record wire shape is currently locked. */
export function isRecordLocked(
  record: { locked_at: string | null } | null | undefined,
): boolean {
  return Boolean(record && record.locked_at)
}

/** Human-readable label for a timeline event type. */
export const TIMELINE_TYPE_LABEL: Record<TimelineEventWire['type'], string> = {
  change_event: 'Change',
  revision: 'Revision',
  submission: 'Review',
  decision: 'Decision',
  check: 'Checks',
  signature: 'Signature',
  comment: 'Comment',
}
