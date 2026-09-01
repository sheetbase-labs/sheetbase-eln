/**
 * REV-007 Review & Approvals workspace route tests.
 *
 * Covers the pure stepper/state derivation (superseded, withdrawn, approved,
 * rejected, returned), the action-button permission guards (terminal state,
 * permission loss, missing digest), confirmation consequence text, and
 * stale-action / permission-loss / superseded error surfacing from the
 * transition RPCs (renderError maps the server guard codes the UI shows).
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DataClientError } from '#/lib/data-client'
import { deriveReviewActionPermission } from '#/lib/review-workspace'
import type {
  ReviewDecisionInput,
  ReviewDecisionKind,
} from '#/lib/review-workspace'
import type { ReviewSubmissionWire } from '#/lib/reviews'

import {
  ActionButtons,
  buildApprovalSteps,
  buildStepperState,
  renderError,
  statusLabel,
  WorkspaceHeader,
} from './$revisionId'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => () => ({ useRouteContext: () => ({}) }),
  redirect: (options: unknown) => options,
  useNavigate: () => vi.fn(),
  useSearch: () => ({}),
  useParams: () => ({ revisionId: 'rev-1' }),
  Link: ({
    to,
    params,
    search,
    children,
    ...props
  }: {
    to: string
    params?: Record<string, string>
    search?: Record<string, unknown>
    children: React.ReactNode
  } & Record<string, unknown>) => {
    let href = to
    for (const [key, value] of Object.entries(params ?? {}))
      href = href.replace(`$${key}`, encodeURIComponent(value))
    if (search && 'revision' in search) {
      href += `?revision=${encodeURIComponent(String(search.revision))}`
    }
    return (
      <a href={href} {...props}>
        {children}
      </a>
    )
  },
}))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({ handler: () => vi.fn() }),
}))

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => ({}),
}))

// jsdom does not implement ResizeObserver; radix UI reads it on mount.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function submission(
  overrides: Partial<ReviewSubmissionWire> = {},
): ReviewSubmissionWire {
  return {
    id: 'sub-1',
    workspace_id: 'ws-1',
    record_id: 'rec-1',
    revision_id: 'rev-1',
    state: 'submitted',
    workflow_definition_key: 'default-scientific-review',
    workflow_definition_version: 1,
    assigned_reviewer_user_ids: ['reviewer-a'],
    submitted_by_user_id: 'owner-a',
    submitted_session_id: 'session-owner-a',
    submitted_role: 'authenticated',
    submitted_at: new Date().toISOString(),
    idempotency_key: 'idem-1',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

const DIGEST = 'a'.repeat(64)

/** Whether a button is disabled (avoids the HTMLElement/ButtonElement cast
 * divergence between tsc and eslint). Native disabled buttons carry the
 * attribute, so this is reliable for shadcn Button output. */
function isDisabled(name: string): boolean {
  return screen.getByRole('button', { name }).hasAttribute('disabled')
}

afterEach(() => cleanup())

// ---------------------------------------------------------------------------

describe('statusLabel', () => {
  it('maps known states to human-readable labels', () => {
    expect(statusLabel('submitted')).toBe('Under review')
    expect(statusLabel('approved')).toBe('Approved')
    expect(statusLabel('returned')).toBe('Changes requested')
  })

  it('falls back to the raw state for unknown values', () => {
    expect(statusLabel('unknown-state')).toBe('unknown-state')
  })
})

describe('buildApprovalSteps', () => {
  it('starts with submission and ends with approved & locked', () => {
    const steps = buildApprovalSteps(submission())
    expect(steps[0].id).toBe('submission')
    expect(steps[steps.length - 1].id).toBe('approved')
  })

  it('returns an empty list when there is no submission', () => {
    expect(buildApprovalSteps(null)).toEqual([])
  })
})

describe('buildStepperState', () => {
  it('marks the active review step when submitted', () => {
    const state = buildStepperState(submission(), [], 'Reviewer A')
    expect(state.submission.state).toBe('completed')
    const activeKey = Object.keys(state).find(
      (k) => k !== 'submission' && k !== 'approved',
    )
    expect(activeKey).toBeDefined()
    expect(state[activeKey!].state).toBe('active')
  })

  it('marks the approved step completed when approved', () => {
    const state = buildStepperState(
      submission({ state: 'approved' }),
      [],
      'Reviewer A',
    )
    expect(state.approved.state).toBe('completed')
  })

  it('marks the approved step unavailable when rejected', () => {
    const state = buildStepperState(
      submission({ state: 'rejected' }),
      [],
      'Reviewer A',
    )
    expect(state.approved.state).toBe('unavailable')
  })

  it('marks a step unavailable when withdrawn', () => {
    const state = buildStepperState(
      submission({ state: 'withdrawn' }),
      [],
      'Reviewer A',
    )
    const unavailable = Object.values(state).find(
      (s) => s.state === 'unavailable',
    )
    expect(unavailable).toBeDefined()
  })

  it('reflects a recorded decision on the active step', () => {
    const decisions = [
      {
        id: 'dec-1',
        workspace_id: 'ws-1',
        submission_id: 'sub-1',
        revision_id: 'rev-1',
        record_id: 'rec-1',
        decision: 'approve' as const,
        note: null,
        revision_integrity_digest: DIGEST,
        actor_user_id: 'reviewer-a',
        actor_session_id: 'session-a',
        actor_role: 'authenticated',
        created_at: new Date().toISOString(),
      },
    ]
    const state = buildStepperState(submission(), decisions, 'Reviewer A')
    const activeKey = Object.keys(state).find(
      (k) => k !== 'submission' && k !== 'approved',
    )
    expect(state[activeKey!].state).toBe('completed')
  })
})

// ---------------------------------------------------------------------------

describe('renderError — stale / superseded / permission-loss surfacing', () => {
  it('maps the not-active guard (SB004) to a clear message', () => {
    expect(renderError(new DataClientError('SB004', 'x', 409))).toMatch(
      /no longer active/i,
    )
  })

  it('maps the stale-state guard (SB005) to a refresh prompt', () => {
    expect(renderError(new DataClientError('SB005', 'x', 409))).toMatch(
      /state changed/i,
    )
    expect(renderError(new DataClientError('SB005', 'x', 409))).toMatch(
      /refresh/i,
    )
  })

  it('maps the superseded guard (SB006) to an actionable message', () => {
    expect(renderError(new DataClientError('SB006', 'x', 409))).toMatch(
      /superseded/i,
    )
  })

  it('maps the digest-mismatch guard (SB001) to a refresh prompt', () => {
    expect(renderError(new DataClientError('SB001', 'x', 409))).toMatch(
      /refresh/i,
    )
  })

  it('maps a permission-denied code to a permission message', () => {
    expect(renderError(new DataClientError('42501', 'denied', 403))).toMatch(
      /permission/i,
    )
    expect(
      renderError(new DataClientError('permission_denied', 'denied', 403)),
    ).toMatch(/permission/i)
  })

  it('falls back to the error message for unknown DataClientError codes', () => {
    expect(renderError(new DataClientError('XYZ', 'boom', 500))).toBe('boom')
  })

  it('handles plain Error objects', () => {
    expect(renderError(new Error('network down'))).toBe('network down')
  })
})

// ---------------------------------------------------------------------------

function makePermission({
  canReview,
  canWithdraw,
  reviewBlockedReason = null,
  withdrawBlockedReason = null,
}: {
  canReview: boolean
  canWithdraw: boolean
  reviewBlockedReason?:
    'not_active' | 'superseded' | 'not_assigned_reviewer' | null
  withdrawBlockedReason?: 'not_active' | 'superseded' | 'not_submitter' | null
}) {
  return {
    canReview,
    canWithdraw,
    reviewBlockedReason,
    withdrawBlockedReason,
  }
}

function renderActionButtons({
  permission,
  digest = DIGEST,
  onAfterDecision = vi
    .fn<
      (kind: ReviewDecisionKind, input: ReviewDecisionInput) => Promise<void>
    >()
    .mockResolvedValue(undefined),
  sub = submission(),
}: {
  permission: ReturnType<typeof makePermission>
  digest?: string | null
  onAfterDecision?: (
    kind: ReviewDecisionKind,
    input: ReviewDecisionInput,
  ) => Promise<void>
  sub?: ReviewSubmissionWire
}) {
  return render(
    <ActionButtons
      submission={sub}
      permission={permission}
      integrityDigest={digest}
      onAfterDecision={onAfterDecision}
    />,
  )
}

describe('ActionButtons — permission guards', () => {
  it('enables the review actions for an active assigned reviewer', () => {
    renderActionButtons({
      permission: makePermission({ canReview: true, canWithdraw: false }),
    })
    expect(isDisabled('Approve')).toBe(false)
    expect(isDisabled('Request changes')).toBe(false)
    expect(isDisabled('Reject')).toBe(false)
  })

  it('disables review actions for a terminal / non-active review', () => {
    renderActionButtons({
      permission: makePermission({
        canReview: false,
        canWithdraw: false,
        reviewBlockedReason: 'not_active',
      }),
    })
    expect(isDisabled('Approve')).toBe(true)
    expect(isDisabled('Request changes')).toBe(true)
    expect(isDisabled('Reject')).toBe(true)
  })

  it('disables review actions when the revision is superseded', () => {
    renderActionButtons({
      permission: makePermission({
        canReview: false,
        canWithdraw: false,
        reviewBlockedReason: 'superseded',
      }),
    })
    expect(isDisabled('Approve')).toBe(true)
  })

  it('disables review actions for a non-assigned reviewer (permission loss)', () => {
    renderActionButtons({
      permission: makePermission({
        canReview: false,
        canWithdraw: false,
        reviewBlockedReason: 'not_assigned_reviewer',
      }),
    })
    expect(isDisabled('Request changes')).toBe(true)
  })

  it('enables withdraw for the submitter on an active review', () => {
    renderActionButtons({
      permission: makePermission({ canReview: false, canWithdraw: true }),
    })
    expect(isDisabled('Withdraw')).toBe(false)
  })

  it('disables withdraw for a non-submitter', () => {
    renderActionButtons({
      permission: makePermission({
        canReview: true,
        canWithdraw: false,
        withdrawBlockedReason: 'not_submitter',
      }),
    })
    expect(isDisabled('Withdraw')).toBe(true)
  })

  it('disables all actions when the integrity digest is missing', () => {
    renderActionButtons({
      permission: makePermission({ canReview: true, canWithdraw: true }),
      digest: null,
    })
    expect(screen.getByText(/Integrity digest unavailable/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
  })
})

describe('ActionButtons — confirmation consequence text', () => {
  it('states the explicit consequence for approve before confirming', async () => {
    renderActionButtons({
      permission: makePermission({ canReview: true, canWithdraw: false }),
    })
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(/Approves the revision/)).toBeTruthy()
  })

  it('states the explicit consequence for reject before confirming', async () => {
    renderActionButtons({
      permission: makePermission({ canReview: true, canWithdraw: false }),
    })
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(
      within(dialog).getByText(/Closes the review as rejected/),
    ).toBeTruthy()
  })

  it('states the explicit consequence for request changes', async () => {
    renderActionButtons({
      permission: makePermission({ canReview: true, canWithdraw: false }),
    })
    fireEvent.click(screen.getByRole('button', { name: 'Request changes' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(
      within(dialog).getByText(/Returns the submission to the author/),
    ).toBeTruthy()
  })

  it('names the next state and warns it cannot be undone in every dialog', async () => {
    render(
      <ActionButtons
        submission={submission()}
        permission={makePermission({ canReview: true, canWithdraw: false })}
        integrityDigest={DIGEST}
        onAfterDecision={vi.fn().mockResolvedValue(undefined)}
      />,
    )
    const cases: Array<[ReviewDecisionKind, string, RegExp]> = [
      ['approve', 'Approve', /Approved/],
      ['request_changes', 'Request changes', /Changes requested/],
      ['reject', 'Reject', /Rejected/],
    ]
    for (const [, label, nextStateRe] of cases) {
      fireEvent.click(screen.getByRole('button', { name: label }))
      const dialog = await screen.findByRole('alertdialog')
      // The next state label is rendered alongside the "cannot be undone" warning.
      expect(within(dialog).getByText(nextStateRe)).toBeTruthy()
      expect(within(dialog).getByText(/cannot be undone/)).toBeTruthy()
      // Close the dialog for the next iteration.
      fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    }
  })
})

describe('ActionButtons — stale and permission-loss error surfacing', () => {
  it('surfaces a stale-state error when the review changed before the action landed', async () => {
    const onAfterDecision = vi
      .fn()
      .mockRejectedValue(
        new DataClientError('SB005', 'review state changed', 409),
      )
    renderActionButtons({
      permission: makePermission({ canReview: true, canWithdraw: false }),
      onAfterDecision,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve' }))
    expect(await screen.findByText(/review state changed/i)).toBeTruthy()
    expect(onAfterDecision).toHaveBeenCalledTimes(1)
  })

  it('surfaces a superseded-revision error from the RPC', async () => {
    const onAfterDecision = vi
      .fn()
      .mockRejectedValue(
        new DataClientError('SB006', 'revision is superseded', 409),
      )
    renderActionButtons({
      permission: makePermission({ canReview: true, canWithdraw: false }),
      onAfterDecision,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve' }))
    expect(await screen.findByText(/superseded/i)).toBeTruthy()
  })

  it('surfaces a permission-loss error from the RPC', async () => {
    const onAfterDecision = vi
      .fn()
      .mockRejectedValue(new DataClientError('42501', 'permission denied', 403))
    renderActionButtons({
      permission: makePermission({ canReview: true, canWithdraw: false }),
      onAfterDecision,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reject' }))
    expect(await screen.findByText(/permission/i)).toBeTruthy()
  })
})

// Ensure deriveReviewActionPermission is exercised end-to-end here too, so
// the route test guards against a regression in the shared derivation.
describe('deriveReviewActionPermission integration', () => {
  it('blocks a non-reviewer and a non-submitter entirely', () => {
    const p = deriveReviewActionPermission({
      state: 'submitted',
      supersededByRevisionId: null,
      assignedReviewerUserIds: ['reviewer-a'],
      submittedByUserId: 'owner-a',
      currentUserId: 'outsider',
    })
    expect(p.canReview).toBe(false)
    expect(p.canWithdraw).toBe(false)
  })
})

// NOTE-04: from the submit flow's success state (the review workspace), the
// working Notebook and the frozen evidence snapshot must both stay reachable.
describe('WorkspaceHeader — post-submission navigation', () => {
  const revision = {
    id: 'rev-1',
    record_id: 'rec-1',
    structure_version: 1,
    metadata_version: 1,
    metadata_snapshot: {},
    block_snapshot: [],
    reason: 'submit',
    superseded_by_revision_id: null,
    created_at: '2026-08-19T00:00:00.000Z',
    created_by_user_id: 'owner-a',
  }

  it('links the working Notebook and the submitted evidence snapshot', () => {
    render(
      <WorkspaceHeader
        submission={submission()}
        record={{ identifier: 'EXP-2025-0001', title: 'Virus Stability' }}
        projectTitle="Stability"
        revision={revision}
        permission={null}
        isLocked={false}
        lockedAt={null}
        lockedByRevisionId={null}
        recordId="rec-1"
      />,
    )
    expect(
      screen
        .getByRole('link', { name: 'Open working Notebook' })
        .getAttribute('href'),
    ).toBe('/records/rec-1')
    expect(
      screen
        .getByRole('link', { name: 'View submitted evidence' })
        .getAttribute('href'),
    ).toBe('/records/rec-1?revision=rev-1')
  })

  it('omits the links when the record is unknown', () => {
    render(
      <WorkspaceHeader
        submission={null}
        record={null}
        projectTitle={null}
        revision={revision}
        permission={null}
        isLocked={false}
        lockedAt={null}
        lockedByRevisionId={null}
        recordId={null}
      />,
    )
    expect(screen.queryByText('Open working Notebook')).toBeNull()
    expect(screen.queryByText('View submitted evidence')).toBeNull()
  })
})
