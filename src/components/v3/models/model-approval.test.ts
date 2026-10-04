import { describe, expect, it } from 'vitest'

import type { ApprovalRequest } from '#/lib/approval-requests'
import {
  approvalStatus,
  buildApprovalTrail,
  canDecide,
  canPublishDraft,
  canSubmitForApproval,
  canWithdraw,
  latestRequest,
  normaliseReason,
  pendingRequest,
  roleList,
} from './model-approval'
import type { ApprovalDecision } from './model-approval'

function request(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    id: 'req-1',
    workspace_id: 'ws-1',
    object_kind: 'dataset_schema_version',
    object_id: 'v-5',
    object_revision: null,
    required_approver_roles: ['owner'],
    required_approvals: 1,
    require_independence: true,
    state: 'pending',
    reason: 'Added flux',
    decision_reason: null,
    approved_by_user_ids: [],
    submitted_by_user_id: 'submitter',
    submitted_at: '2026-01-02T09:00:00Z',
    decided_by_user_id: null,
    decided_at: null,
    created_at: '2026-01-02T09:00:00Z',
    updated_at: '2026-01-02T09:00:00Z',
    ...overrides,
  }
}

function decision(overrides: Partial<ApprovalDecision> = {}): ApprovalDecision {
  return {
    id: 'dec-1',
    request_id: 'req-1',
    workspace_id: 'ws-1',
    user_id: 'approver',
    role: 'owner',
    decision: 'approved',
    reason: null,
    created_at: '2026-01-02T11:00:00Z',
    ...overrides,
  }
}

describe('approvalStatus', () => {
  it('reports not submitted when there are no requests', () => {
    expect(approvalStatus([])).toMatchObject({
      tone: 'none',
      label: 'Not submitted',
    })
  })

  it('lets an open request win over an earlier terminal one', () => {
    expect(
      approvalStatus([
        request({
          id: 'old',
          state: 'returned',
          created_at: '2026-01-01T00:00:00Z',
        }),
        request({ id: 'new', state: 'pending' }),
      ]).label,
    ).toBe('Awaiting approval')
  })

  it('maps terminal states truthfully', () => {
    expect(approvalStatus([request({ state: 'returned' })]).tone).toBe('bad')
    expect(approvalStatus([request({ state: 'approved' })]).tone).toBe('ok')
    expect(approvalStatus([request({ state: 'withdrawn' })]).tone).toBe(
      'stored',
    )
    expect(
      approvalStatus([request({ state: 'approved', object_revision: 3 })], 4)
        .label,
    ).toBe('Approval out of date')
    expect(
      approvalStatus([request({ state: 'approved', object_revision: 4 })], 4)
        .label,
    ).toBe('Approved')
  })
})

describe('latestRequest and pendingRequest', () => {
  it('preserves PostgreSQL microsecond order within one JavaScript millisecond', () => {
    expect(
      latestRequest([
        request({
          id: 'z-old',
          submitted_at: '2026-01-01T00:00:00.000001+00:00',
        }),
        request({
          id: 'a-new',
          submitted_at: '2026-01-01T00:00:00.000002+00:00',
        }),
      ])?.id,
    ).toBe('a-new')
  })

  it('selects newest by submitted_at and the one open request', () => {
    const requests = [
      request({
        id: 'a',
        submitted_at: '2026-01-01T00:00:00Z',
        state: 'returned',
      }),
      request({
        id: 'b',
        submitted_at: '2026-02-01T00:00:00Z',
        state: 'pending',
      }),
    ]
    expect(latestRequest(requests)?.id).toBe('b')
    expect(pendingRequest(requests)?.id).toBe('b')
    expect(pendingRequest([requests[0]])).toBeNull()
  })
})

describe('canDecide', () => {
  it('requires a pending request, a named writer role and independence', () => {
    const req = request({
      required_approver_roles: ['reviewer'],
      submitted_by_user_id: 'submitter',
      require_independence: true,
    })
    expect(canDecide(req, 'approver', 'reviewer')).toBe(true)
    expect(canDecide(req, 'submitter', 'reviewer')).toBe(false) // independence
    expect(canDecide(req, 'approver', 'member')).toBe(false) // not named
    expect(canDecide(req, 'approver', 'viewer')).toBe(false) // not a writer
    expect(
      canDecide({ ...req, state: 'returned' }, 'approver', 'reviewer'),
    ).toBe(false)
  })

  it('allows the submitter when independence is not required', () => {
    const req = request({
      require_independence: false,
      required_approver_roles: ['owner'],
      submitted_by_user_id: 'submitter',
    })
    expect(canDecide(req, 'submitter', 'owner')).toBe(true)
  })

  it('does not offer a second decision to an approver who already approved', () => {
    const req = request({
      required_approver_roles: ['reviewer'],
      approved_by_user_ids: ['approver'],
    })
    expect(canDecide(req, 'approver', 'reviewer')).toBe(false)
  })
})

describe('canWithdraw', () => {
  it('allows only the submitter while pending', () => {
    const req = request({ submitted_by_user_id: 'submitter' })
    expect(canWithdraw(req, 'submitter', 'owner')).toBe(true)
    expect(canWithdraw(req, 'other', 'owner')).toBe(false)
    expect(canWithdraw(req, 'submitter', 'viewer')).toBe(false)
    expect(
      canWithdraw({ ...req, state: 'returned' }, 'submitter', 'owner'),
    ).toBe(false)
  })
})

describe('canPublishDraft', () => {
  it('requires a current-revision approval when policy is enabled', () => {
    expect(canPublishDraft([], true, 4)).toBe(false)
    expect(canPublishDraft([], false, 4)).toBe(true)
    expect(
      canPublishDraft(
        [request({ state: 'approved', object_revision: 3 })],
        true,
        4,
      ),
    ).toBe(false)
    expect(
      canPublishDraft(
        [request({ state: 'approved', object_revision: null })],
        false,
        4,
      ),
    ).toBe(false)
    expect(
      canPublishDraft(
        [request({ state: 'approved', object_revision: 4 })],
        true,
        4,
      ),
    ).toBe(true)
    expect(
      canPublishDraft(
        [
          request({
            id: 'old',
            state: 'approved',
            object_revision: 4,
            submitted_at: '2026-01-01T00:00:00Z',
          }),
          request({
            id: 'new',
            state: 'returned',
            object_revision: 4,
            submitted_at: '2026-01-03T00:00:00Z',
          }),
        ],
        false,
        4,
      ),
    ).toBe(false)
  })

  it('follows the server blocker: no request, or latest approved', () => {
    expect(canPublishDraft([])).toBe(true)
    expect(canPublishDraft([request({ state: 'pending' })])).toBe(false)
    expect(canPublishDraft([request({ state: 'returned' })])).toBe(false)
    expect(canPublishDraft([request({ state: 'withdrawn' })])).toBe(false)
    expect(canPublishDraft([request({ state: 'approved' })])).toBe(true)
  })

  it('refuses publish when an approved request is followed by a pending one', () => {
    const requests = [
      request({
        id: 'p',
        state: 'pending',
        created_at: '2026-02-01T00:00:00Z',
      }),
      request({
        id: 'a',
        state: 'approved',
        created_at: '2026-01-01T00:00:00Z',
      }),
    ]
    expect(canPublishDraft(requests)).toBe(false)
  })
})

describe('buildApprovalTrail', () => {
  it('records the submission, each decision and terminal state in order', () => {
    const req = request({
      state: 'approved',
      decided_by_user_id: 'approver',
      decided_at: '2026-01-02T11:00:00Z',
      decision_reason: 'Looks right',
      approved_by_user_ids: ['approver'],
    })
    const trail = buildApprovalTrail(req, [
      decision({ reason: 'Checked the range' }),
    ])
    expect(trail.map((entry) => entry.kind)).toEqual(['submitted', 'approved'])
    expect(trail[0].reason).toBe('Added flux')
    expect(trail[1].actorUserId).toBe('approver')
    expect(trail[1].reason).toBe('Checked the range')
    expect(trail[1].role).toBe('owner')
  })

  it('falls back to the request decided fields when no decisions were read', () => {
    const req = request({
      state: 'returned',
      decided_by_user_id: 'reviewer-user',
      decided_at: '2026-01-03T08:30:00Z',
      decision_reason: 'Wrong unit',
    })
    const trail = buildApprovalTrail(req, [])
    expect(trail.map((entry) => entry.kind)).toEqual(['submitted', 'returned'])
    expect(trail[1].reason).toBe('Wrong unit')
    expect(trail[1].at).toBe('2026-01-03T08:30:00Z')
  })

  it('adds a withdrawn entry with its reason', () => {
    const req = request({
      state: 'withdrawn',
      decided_by_user_id: 'submitter',
      decided_at: '2026-01-04T07:00:00Z',
      decision_reason: 'Found a mistake',
    })
    const trail = buildApprovalTrail(req, [])
    expect(trail.at(-1)).toMatchObject({
      kind: 'withdrawn',
      actorUserId: 'submitter',
      reason: 'Found a mistake',
    })
  })
})

describe('guards and labels', () => {
  it('gates submission on schema.edit', () => {
    expect(canSubmitForApproval('owner')).toBe(true)
    expect(canSubmitForApproval('member')).toBe(false)
    expect(canSubmitForApproval(null)).toBe(false)
  })

  it('labels roles and joins them for prose', () => {
    expect(roleList(['owner', 'reviewer'])).toBe('Owner or Reviewer (QA)')
    expect(roleList(['owner'])).toBe('Owner')
    expect(roleList([])).toBe('an approver')
  })

  it('accepts trimmed reasons only within 1..500', () => {
    expect(normaliseReason('  why  ')).toBe('why')
    expect(normaliseReason('   ')).toBeNull()
    expect(normaliseReason('x'.repeat(501))).toBeNull()
    expect(normaliseReason('x'.repeat(500))).toBe('x'.repeat(500))
  })
})
