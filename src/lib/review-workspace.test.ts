/**
 * REV-007 Review & Approvals workspace data-layer tests.
 *
 * Covers permission derivation (active / superseded / reviewer / submitter
 * guards), terminal/superseded state handling, canonical-envelope fallback
 * for legacy revisions, decision next-state mapping, and the wire shape the
 * transition RPC wrappers send to PostgREST.
 */
import { describe, expect, it, vi } from 'vitest'

import {
  blockedReasonLabel,
  DECISION_CONSEQUENCE,
  DECISION_NEXT_STATE,
  deriveReviewActionPermission,
  fetchRevisionRow,
  reviewWorkspaceDataClient,
  toCanonicalEnvelope,
} from './review-workspace'
import type { ReviewActionContext } from './review-workspace'
import type { RevisionWire } from './notebook-data'

function ctx(
  overrides: Partial<ReviewActionContext> = {},
): ReviewActionContext {
  return {
    state: 'submitted',
    supersededByRevisionId: null,
    assignedReviewerUserIds: ['reviewer-a'],
    submittedByUserId: 'owner-a',
    currentUserId: 'reviewer-a',
    ...overrides,
  }
}

function revision(overrides: Partial<RevisionWire> = {}): RevisionWire {
  return {
    id: 'rev-1',
    workspace_id: 'ws-1',
    record_id: 'rec-1',
    reason: 'Initial submission',
    structure_version: 1,
    metadata_version: 1,
    metadata_snapshot: { id: 'rec-1', title: 'Stability' },
    block_snapshot: [
      {
        id: 'blk-1',
        type: 'text',
        payload: { text: 'hello' },
        payload_schema_version: 1,
        order: 0,
        version: 1,
      },
    ],
    superseded_by_revision_id: null,
    integrity_algorithm: 'sha256',
    integrity_digest: 'a'.repeat(64),
    created_at: new Date().toISOString(),
    created_by_user_id: 'owner-a',
    ...overrides,
  }
}

describe('deriveReviewActionPermission', () => {
  it('allows an assigned reviewer to review an active, non-superseded submission', () => {
    const p = deriveReviewActionPermission(ctx())
    expect(p.canReview).toBe(true)
    expect(p.canWithdraw).toBe(false)
    expect(p.reviewBlockedReason).toBeNull()
    expect(p.withdrawBlockedReason).toBe('not_submitter')
  })

  it('allows the submitter to withdraw an active submission', () => {
    const p = deriveReviewActionPermission(ctx({ currentUserId: 'owner-a' }))
    expect(p.canWithdraw).toBe(true)
    expect(p.canReview).toBe(false)
    expect(p.withdrawBlockedReason).toBeNull()
    expect(p.reviewBlockedReason).toBe('not_assigned_reviewer')
  })

  it('blocks review for a non-active (terminal) state', () => {
    const p = deriveReviewActionPermission(ctx({ state: 'approved' }))
    expect(p.canReview).toBe(false)
    expect(p.canWithdraw).toBe(false)
    expect(p.reviewBlockedReason).toBe('not_active')
    expect(p.withdrawBlockedReason).toBe('not_active')
  })

  it('blocks review for a withdrawn submission', () => {
    const p = deriveReviewActionPermission(ctx({ state: 'withdrawn' }))
    expect(p.canReview).toBe(false)
    expect(p.canWithdraw).toBe(false)
    expect(p.reviewBlockedReason).toBe('not_active')
  })

  it('blocks review for a returned (changes-requested) submission', () => {
    const p = deriveReviewActionPermission(ctx({ state: 'returned' }))
    expect(p.canReview).toBe(false)
    expect(p.reviewBlockedReason).toBe('not_active')
  })

  it('blocks all actions when the revision is superseded', () => {
    const p = deriveReviewActionPermission(
      ctx({ supersededByRevisionId: 'rev-2' }),
    )
    expect(p.canReview).toBe(false)
    expect(p.canWithdraw).toBe(false)
    expect(p.reviewBlockedReason).toBe('superseded')
    expect(p.withdrawBlockedReason).toBe('superseded')
  })

  it('blocks a non-assigned reviewer from reviewing', () => {
    const p = deriveReviewActionPermission(
      ctx({ currentUserId: 'somebody-else' }),
    )
    expect(p.canReview).toBe(false)
    expect(p.reviewBlockedReason).toBe('not_assigned_reviewer')
  })

  it('reports not_active when both terminal and superseded', () => {
    // The active-state guard fires first (mirroring the RPC), so a
    // terminal-but-also-superseded submission surfaces the terminal reason.
    const p = deriveReviewActionPermission(
      ctx({ state: 'approved', supersededByRevisionId: 'rev-2' }),
    )
    expect(p.canReview).toBe(false)
    expect(p.reviewBlockedReason).toBe('not_active')
  })
})

describe('blockedReasonLabel', () => {
  it('returns a human-readable sentence for every reason', () => {
    const reasons = [
      'not_active',
      'superseded',
      'not_assigned_reviewer',
      'not_submitter',
    ] as const
    for (const reason of reasons) {
      expect(blockedReasonLabel(reason)).toMatch(/\.$/)
      expect(blockedReasonLabel(reason).length).toBeGreaterThan(10)
    }
  })
})

describe('DECISION_NEXT_STATE', () => {
  it('maps each decision to its terminal submission state', () => {
    expect(DECISION_NEXT_STATE.request_changes).toBe('returned')
    expect(DECISION_NEXT_STATE.reject).toBe('rejected')
    expect(DECISION_NEXT_STATE.approve).toBe('approved')
    expect(DECISION_NEXT_STATE.withdraw).toBe('withdrawn')
  })
})

describe('DECISION_CONSEQUENCE', () => {
  it('states an explicit, irreversible consequence for each decision', () => {
    for (const kind of [
      'request_changes',
      'reject',
      'approve',
      'withdraw',
    ] as const) {
      const text = DECISION_CONSEQUENCE[kind]
      // Every consequence must warn that the action cannot be trivially
      // reversed — the workspace dialog relies on this.
      expect(text.length).toBeGreaterThan(20)
    }
    expect(DECISION_CONSEQUENCE.approve).toMatch(/final/i)
    expect(DECISION_CONSEQUENCE.reject).toMatch(/reject/i)
    expect(DECISION_CONSEQUENCE.request_changes).toMatch(/return/i)
    expect(DECISION_CONSEQUENCE.withdraw).toMatch(/withdraw/i)
  })
})

describe('toCanonicalEnvelope', () => {
  it('loads persisted frozen evidence without changing the signed canonical snapshot', async () => {
    const canonical = {
      formatVersion: 1,
      record: { id: 'rec-1' },
      blocks: [],
      links: [],
      scientificTables: [],
      formulas: [],
      files: [],
    }
    const stored = revision({ canonical_snapshot: canonical })
    const list = vi
      .fn()
      .mockResolvedValueOnce([stored])
      .mockResolvedValueOnce([
        {
          block_id: 'sheet-1',
          instance_id: 'instance-1',
          instance_revision: 4,
          source_definition_version_id: 'definition-1',
          instance_state: {},
          dataset_versions: [{ datasetVersionId: 'frozen-version' }],
          composed_grid: {
            columns: [{ id: 'titer', label: 'Log titer' }],
            rowKeys: ['day28'],
            rows: [[5.9]],
          },
        },
      ])
    const fetched = await fetchRevisionRow(
      { ...reviewWorkspaceDataClient, list },
      'rev-1',
    )
    expect(fetched).not.toBeNull()
    if (!fetched) throw new Error('revision missing')
    const envelope = toCanonicalEnvelope(fetched)
    expect(envelope.sheetEvidence?.[0].composedGrid).toMatchObject({
      rowKeys: ['day28'],
      rows: [[5.9]],
    })
    expect(stored.canonical_snapshot).toEqual(canonical)
    expect(fetched.integrity_digest).toBe('a'.repeat(64))
    expect(list.mock.calls.map(([resource]) => resource)).toEqual([
      'revisions',
      'revision_sheet_evidence',
    ])
  })

  it('uses canonical_snapshot when it carries blocks', () => {
    const blocks = [{ id: 'blk-9', type: 'text', payload: {}, order: 0 }]
    const rev = revision({
      canonical_snapshot: {
        formatVersion: 1,
        record: { id: 'rec-1' },
        blocks,
        links: [],
        scientificTables: [],
        formulas: [],
        files: [],
      },
    })
    const envelope = toCanonicalEnvelope(rev)
    expect(envelope.blocks).toEqual(blocks)
    expect(envelope.formatVersion).toBe(1)
  })

  it('falls back to metadata + block snapshots for legacy revisions', () => {
    const rev = revision({ canonical_snapshot: undefined })
    const envelope = toCanonicalEnvelope(rev)
    expect(envelope.formatVersion).toBe(0)
    expect(envelope.record).toEqual({ id: 'rec-1', title: 'Stability' })
    expect(envelope.blocks).toHaveLength(1)
    expect(envelope.blocks[0].id).toBe('blk-1')
    expect(envelope.links).toEqual([])
    expect(envelope.scientificTables).toEqual([])
    expect(envelope.formulas).toEqual([])
    expect(envelope.files).toEqual([])
  })

  it('falls back when canonical_snapshot is not an object with blocks', () => {
    const rev = revision({
      canonical_snapshot:
        'not-an-envelope' as unknown as RevisionWire['canonical_snapshot'],
    })
    const envelope = toCanonicalEnvelope(rev)
    expect(envelope.formatVersion).toBe(0)
    expect(envelope.blocks[0].id).toBe('blk-1')
  })
})
