/**
 * GOV-04 — Review lifecycle presentation model.
 *
 * Pure derivations over the authoritative REV-002/REV-007/SIGN-002 state:
 * `review_submissions.state`, `records.locked_at`, and
 * `revisions.superseded_by_revision_id`. No new backend states are invented;
 * every derived value names exactly which authoritative fields produced it,
 * so the UI can never drift into a second state machine.
 */

import type { RevisionOptionWire } from './review-workspace'

// ---------------------------------------------------------------------------
// Lifecycle status.
// ---------------------------------------------------------------------------

export type ReviewLifecycleStatus =
  | 'draft'
  | 'under-review'
  | 'changes-requested'
  | 'rejected'
  | 'approved'
  | 'signed-locked'
  | 'superseded'
  | 'withdrawn'

export interface ReviewLifecycle {
  status: ReviewLifecycleStatus
  /** Human sentence naming the authoritative source of the status. */
  explanation: string
}

export function deriveReviewLifecycle(input: {
  submissionState: string | null
  lockedAt: string | null
  /** Which revision the record's current lock belongs to, if known. */
  lockedByRevisionId?: string | null
  /** The revision being viewed; needed to judge lock ownership precisely. */
  viewedRevisionId?: string | null
  supersededByRevisionId: string | null
}): ReviewLifecycle {
  // Supersession is a property of the revision being VIEWED; the record's
  // lock is record-level state that belongs to the locking revision.
  // A signed-then-amended revision stays "superseded" even after the
  // amended successor is itself signed and re-locks the record — the same
  // rule the signature panel applies (signatures stay on their revision).
  if (input.supersededByRevisionId) {
    return {
      status: 'superseded',
      explanation:
        'A later amendment replaced this revision; it stays readable as history.',
    }
  }
  if (input.lockedAt) {
    const lockOwnedByViewedRevision =
      input.lockedByRevisionId == null ||
      input.viewedRevisionId == null ||
      input.lockedByRevisionId === input.viewedRevisionId
    if (lockOwnedByViewedRevision) {
      return {
        status: 'signed-locked',
        explanation:
          'An approve-for-record signature locked this record; its evidence is frozen.',
      }
    }
    return {
      status: 'signed-locked',
      explanation:
        'This record is currently locked by a different revision; this revision shows its own review history.',
    }
  }
  switch (input.submissionState) {
    case 'submitted':
      return {
        status: 'under-review',
        explanation: 'Submitted and awaiting a review decision.',
      }
    case 'returned':
      return {
        status: 'changes-requested',
        explanation: 'The reviewer requested changes; resubmit a new revision.',
      }
    case 'rejected':
      return {
        status: 'rejected',
        explanation: 'The reviewer rejected this submission.',
      }
    case 'approved':
      return {
        status: 'approved',
        explanation:
          'Approved — required signatures complete before the record locks.',
      }
    case 'withdrawn':
      return {
        status: 'withdrawn',
        explanation: 'The submitter withdrew this review attempt.',
      }
    default:
      // The DB CHECK makes this unreachable; stay honest if it ever changes.
      return {
        status: 'draft',
        explanation: input.submissionState
          ? `Unrecognised submission state "${input.submissionState}".`
          : 'Not yet submitted; the live record is still editable.',
      }
  }
}

// ---------------------------------------------------------------------------
// Signature applicability.
// ---------------------------------------------------------------------------

export type SignatureApplicability = 'current' | 'superseded' | 'stale-view'

export interface SignatureValidity {
  applicability: SignatureApplicability
  /** Human sentence; never claims more than digest identity proves. */
  explanation: string
}

/**
 * Whether a recorded signature still attests the revision being viewed.
 * Signatures are immutable rows pinned to one revision digest; amendments
 * never move them, so an amended context renders them as historical.
 */
export function deriveSignatureApplicability(input: {
  signatureDigest: string
  viewedRevisionDigest: string | null
  viewedRevisionSupersededBy: string | null
}): SignatureValidity {
  if (
    input.viewedRevisionDigest !== null &&
    input.signatureDigest !== input.viewedRevisionDigest
  ) {
    return {
      applicability: 'stale-view',
      explanation:
        'This signature pins a different revision digest than the one displayed.',
    }
  }
  if (input.viewedRevisionSupersededBy) {
    return {
      applicability: 'superseded',
      explanation:
        'This signature remains attached to the original frozen revision; the amendment did not move it.',
    }
  }
  return {
    applicability: 'current',
    explanation:
      'This signature applies to the current revision of this record.',
  }
}

// ---------------------------------------------------------------------------
// Amendment / revision chain.
// ---------------------------------------------------------------------------

export interface RevisionChainEntry {
  id: string
  reason: string
  createdAt: string
  supersededByRevisionId: string | null
}

export function buildAmendmentChain(
  options: RevisionOptionWire[],
): RevisionChainEntry[] {
  if (options.length === 0) return []
  const byId = new Map(options.map((option) => [option.id, option]))
  const supersededIds = new Set(
    options
      .map((option) => option.superseded_by_revision_id)
      .filter((id): id is string => id !== null),
  )
  const roots = options.filter((option) => !supersededIds.has(option.id))
  if (roots.length === 0) return []

  const chains: RevisionChainEntry[][] = []
  for (const root of roots.sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  )) {
    const chain: RevisionChainEntry[] = [
      {
        id: root.id,
        reason: root.reason,
        createdAt: root.created_at,
        supersededByRevisionId: root.superseded_by_revision_id,
      },
    ]
    let cursor: RevisionOptionWire | undefined = root
    for (;;) {
      // Walk the supersedes edge forward: r1.superseded_by = r2 means r2
      // replaced r1, so the next entry is the option r1 points to.
      if (cursor.superseded_by_revision_id === null) break
      const next = byId.get(cursor.superseded_by_revision_id)
      if (!next) break
      chain.push({
        id: next.id,
        reason: next.reason,
        createdAt: next.created_at,
        supersededByRevisionId: next.superseded_by_revision_id,
      })
      cursor = next
    }
    chains.push(chain)
  }
  // A single connected chain is the product case; multiple roots stay honest
  // as separate branches rather than being merged by timestamp guessing.
  const longest = chains.reduce((best, chain) =>
    chain.length > best.length ? chain : best,
  )
  return longest
}
