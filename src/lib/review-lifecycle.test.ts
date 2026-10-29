import { describe, expect, it } from 'vitest'

import {
  buildAmendmentChain,
  deriveReviewLifecycle,
  deriveSignatureApplicability,
} from './review-lifecycle'
import type { RevisionOptionWire } from './review-workspace'

describe('deriveReviewLifecycle', () => {
  it('prefers the record lock over every submission state', () => {
    const lifecycle = deriveReviewLifecycle({
      submissionState: 'approved',
      lockedAt: '2026-08-26T10:00:00Z',
      supersededByRevisionId: null,
    })
    expect(lifecycle.status).toBe('signed-locked')
  })

  it('reports supersession for amended revisions', () => {
    const lifecycle = deriveReviewLifecycle({
      submissionState: 'submitted',
      lockedAt: null,
      supersededByRevisionId: 'rev-2',
    })
    expect(lifecycle.status).toBe('superseded')
  })

  it('regression: amended predecessor stays superseded after its successor re-locks the record', () => {
    // rev A signed -> amend to rev B -> rev B signed, record locked by B.
    // Viewing A must show supersession, never the successor's lock.
    const lifecycle = deriveReviewLifecycle({
      submissionState: 'approved',
      lockedAt: '2026-08-26T12:00:00Z',
      lockedByRevisionId: 'rev-b',
      viewedRevisionId: 'rev-a',
      supersededByRevisionId: 'rev-b',
    })
    expect(lifecycle.status).toBe('superseded')
  })

  it('still shows signed-locked for the revision that owns the lock', () => {
    const lifecycle = deriveReviewLifecycle({
      submissionState: 'approved',
      lockedAt: '2026-08-26T12:00:00Z',
      lockedByRevisionId: 'rev-b',
      viewedRevisionId: 'rev-b',
      supersededByRevisionId: null,
    })
    expect(lifecycle.status).toBe('signed-locked')
  })

  it('maps each authoritative submission state without inventing values', () => {
    const states = [
      ['submitted', 'under-review'],
      ['returned', 'changes-requested'],
      ['rejected', 'rejected'],
      ['approved', 'approved'],
      ['withdrawn', 'withdrawn'],
    ] as const
    for (const [state, expected] of states) {
      expect(
        deriveReviewLifecycle({
          submissionState: state,
          lockedAt: null,
          supersededByRevisionId: null,
        }).status,
      ).toBe(expected)
    }
  })

  it('treats a live unsubmitted record as draft', () => {
    expect(
      deriveReviewLifecycle({
        submissionState: null,
        lockedAt: null,
        supersededByRevisionId: null,
      }).status,
    ).toBe('draft')
  })
})

describe('deriveSignatureApplicability', () => {
  it('keeps signatures current while their revision is current', () => {
    expect(
      deriveSignatureApplicability({
        signatureDigest: 'aa'.repeat(32),
        viewedRevisionDigest: 'aa'.repeat(32),
        viewedRevisionSupersededBy: null,
      }).applicability,
    ).toBe('current')
  })

  it('marks signatures historical — never moved — after an amendment', () => {
    const validity = deriveSignatureApplicability({
      signatureDigest: 'aa'.repeat(32),
      viewedRevisionDigest: 'aa'.repeat(32),
      viewedRevisionSupersededBy: 'rev-2',
    })
    expect(validity.applicability).toBe('superseded')
    expect(validity.explanation).toMatch(/didn’t move/)
  })

  it('flags digest mismatches instead of pretending applicability', () => {
    expect(
      deriveSignatureApplicability({
        signatureDigest: 'aa'.repeat(32),
        viewedRevisionDigest: 'bb'.repeat(32),
        viewedRevisionSupersededBy: null,
      }).applicability,
    ).toBe('stale-view')
  })
})

describe('buildAmendmentChain', () => {
  const option = (
    id: string,
    reason: string,
    createdAt: string,
    supersededByRevisionId: string | null,
  ): RevisionOptionWire => ({
    id,
    record_id: 'rec-1',
    reason,
    integrity_digest: 'ab'.repeat(32),
    superseded_by_revision_id: supersededByRevisionId,
    created_at: createdAt,
    created_by_user_id: 'actor',
  })

  it('orders the chain oldest-first across explicit supersedes edges', () => {
    const chain = buildAmendmentChain([
      option('r3', 'amend', '2026-01-03T00:00:00Z', null),
      option('r1', 'submit', '2026-01-01T00:00:00Z', 'r2'),
      option('r2', 'amend', '2026-01-02T00:00:00Z', 'r3'),
    ])
    expect(chain.map((entry) => entry.id)).toEqual(['r1', 'r2', 'r3'])
    expect(chain[0].supersededByRevisionId).toBe('r2')
    expect(chain[2].supersededByRevisionId).toBeNull()
  })

  it('does not stitch unrelated revisions by timestamp proximity', () => {
    const chain = buildAmendmentChain([
      option('a1', 'submit', '2026-01-01T00:00:00Z', null),
      option('b1', 'submit', '2026-01-02T00:00:00Z', null),
    ])
    // Two disconnected roots: the product case is one chain; no fake merge.
    expect(chain).toHaveLength(1)
  })

  it('returns empty for no options', () => {
    expect(buildAmendmentChain([])).toEqual([])
  })
})
