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
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DataClientError } from '#/lib/data-client'
import { commentsQueryKeys } from '#/lib/comments-data'
import type { CommentWire } from '#/lib/comments-data'
import { newDraft } from '#/lib/review-comment-drafts'
import { CommentPanel } from '#/components/comments'
import { deriveReviewActionPermission } from '#/lib/review-workspace'
import type {
  ReviewDecisionInput,
  ReviewDecisionKind,
} from '#/lib/review-workspace'
import type { ReviewSubmissionWire } from '#/lib/reviews'
import { reviewsDataClient } from '#/lib/reviews'
import { SignatureStepUpError } from '#/lib/signatures'
import type { WorkspaceCertification } from '#/lib/signature-certification'
import type * as sign002 from '#/lib/sign-002'

import {
  ActionButtons,
  AmendmentSection,
  buildApprovalSteps,
  buildStepperState,
  canCommentOnRevision,
  DraftCommentsTray,
  renderError,
  ReturnedCommentsBanner,
  SignaturePanel,
  statusLabel,
  WorkspaceHeader,
} from './-revision-page'

const {
  navigateMock,
  requestSignatureStepUpMock,
  signRevisionMock,
  fetchWorkspaceCertificationsMock,
  createAmendmentMock,
} = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  requestSignatureStepUpMock: vi.fn(),
  signRevisionMock: vi.fn(),
  fetchWorkspaceCertificationsMock: vi.fn<
    (...args: unknown[]) => Promise<WorkspaceCertification[]>
  >(async () => []),
  createAmendmentMock: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  getRouteApi: () => ({ useRouteContext: () => ({}) }),
  redirect: (options: unknown) => options,
  useNavigate: () => navigateMock,
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

vi.mock('@tanstack/react-start', () => {
  // The route imports server functions that chain `.middleware()`/`.validator()`
  // at module scope; the mock must stay chainable or the import throws.
  const chain: Record<string, unknown> = {}
  chain.middleware = () => chain
  chain.validator = () => chain
  chain.handler = () => vi.fn()
  return { createServerFn: () => chain }
})

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => ({}),
}))

vi.mock('#/lib/signature-certification', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchWorkspaceCertifications: (...args: unknown[]) =>
    fetchWorkspaceCertificationsMock(...args),
}))

vi.mock('#/lib/sign-002', async (importOriginal) => ({
  ...(await importOriginal<typeof sign002>()),
  createAmendment: (...args: unknown[]) => createAmendmentMock(...args),
}))

vi.mock('#/lib/signatures', async (importOriginal) => ({
  ...(await importOriginal()),
  requestSignatureStepUp: (...args: unknown[]) =>
    requestSignatureStepUpMock(...args),
  signRevision: (...args: unknown[]) => signRevisionMock(...args),
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
    due_at: null,
    idempotency_key: 'idem-1',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

const DIGEST = 'a'.repeat(64)

/** The SB008 check evidence a revision needs before a signature is offered. */
function passingCheckResult() {
  return {
    id: 'check-1',
    workspace_id: 'ws-1',
    record_id: 'rec-1',
    revision_id: 'rev-1',
    check_definition_key: 'default',
    check_definition_version: 1,
    revision_integrity_digest: DIGEST,
    check_definition_digest: DIGEST,
    input_digest: DIGEST,
    overall_status: 'pass',
    pass_count: 1,
    blocking_failure_count: 0,
    warning_failure_count: 0,
    info_failure_count: 0,
    results: [],
    run_by_user_id: 'reviewer-a',
    run_session_id: 'session-owner-a',
    run_role: 'authenticated',
    run_at: '2026-10-04T12:00:00Z',
    idempotency_key: 'check-key',
    created_at: '2026-10-04T12:00:00Z',
  }
}

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
  const nameOf = (id: string) => `Name of ${id}`

  it('marks the active review step when submitted', () => {
    const state = buildStepperState(submission(), [], nameOf)
    expect(state.submission.state).toBe('completed')
    expect(state.submission.actor?.name).toBe(
      `Name of ${submission().submitted_by_user_id}`,
    )
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
      nameOf,
    )
    expect(state.approved.state).toBe('completed')
  })

  it('marks the approved step unavailable when rejected', () => {
    const state = buildStepperState(
      submission({ state: 'rejected' }),
      [],
      nameOf,
    )
    expect(state.approved.state).toBe('unavailable')
  })

  it('marks a step unavailable when withdrawn', () => {
    const state = buildStepperState(
      submission({ state: 'withdrawn' }),
      [],
      nameOf,
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
    const state = buildStepperState(submission(), decisions, nameOf)
    const activeKey = Object.keys(state).find(
      (k) => k !== 'submission' && k !== 'approved',
    )
    expect(state[activeKey!].state).toBe('completed')
    expect(state[activeKey!].actor?.name).toBe('Name of reviewer-a')
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
    expect(screen.getByText(/Fingerprint unavailable/)).toBeTruthy()
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

describe('ActionButtons — approving leads into signing', () => {
  function renderWithSigning(onApprovedForSigning: () => void) {
    return render(
      <ActionButtons
        submission={submission()}
        permission={makePermission({ canReview: true, canWithdraw: false })}
        integrityDigest={DIGEST}
        onAfterDecision={vi.fn().mockResolvedValue(undefined)}
        onApprovedForSigning={onApprovedForSigning}
      />,
    )
  }

  it('opens signing after Approve without needing the shortcut', async () => {
    const onApprovedForSigning = vi.fn()
    renderWithSigning(onApprovedForSigning)
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(onApprovedForSigning).toHaveBeenCalledTimes(1))
  })

  it('does not open signing after a return', async () => {
    const onApprovedForSigning = vi.fn()
    renderWithSigning(onApprovedForSigning)
    fireEvent.click(screen.getByRole('button', { name: 'Request changes' }))
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Request changes' }),
    )
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(onApprovedForSigning).not.toHaveBeenCalled()
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
    ).toBe('/evidence/rev-1')
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

describe('witness picker effective project authority', () => {
  it('refuses a witness who cannot read the record, with the reason, before any call is made', async () => {
    const rpc = vi
      .spyOn(reviewsDataClient, 'rpc')
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce([
        {
          user_id: 'view-only',
          name: 'View only',
          workspace_role: 'member',
          can_read_record: true,
        },
        {
          user_id: 'unreadable-admin',
          name: 'Unreadable admin',
          workspace_role: 'admin',
          can_read_record: false,
        },
      ])
    const list = vi.spyOn(reviewsDataClient, 'list').mockResolvedValue([])
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    try {
      render(
        <QueryClientProvider client={queryClient}>
          <SignaturePanel
            submission={submission()}
            revision={{
              id: 'rev-1',
              record_id: 'rec-1',
              structure_version: 1,
              metadata_version: 1,
              metadata_snapshot: {},
              block_snapshot: [],
              reason: 'submit',
              superseded_by_revision_id: null,
              created_at: '2026-10-04T12:00:00Z',
              created_by_user_id: 'owner-a',
            }}
            projectId="exact-project"
            signatures={[]}
            integrityDigest={DIGEST}
            currentUserId="owner-a"
            currentUserName="Author"
            open={false}
            onOpenChange={vi.fn()}
          />
        </QueryClientProvider>,
      )
      await screen.findByRole('option', { name: 'View only · member' })
      // The unreadable member is still named, and the picker states why they
      // cannot be asked instead of hiding them.
      expect(
        screen.getByRole('option', {
          name: 'Unreadable admin · admin — cannot read this record',
        }),
      ).toBeTruthy()
      const picker = screen.getByLabelText(
        'Request a witness for this frozen revision',
      )
      fireEvent.change(picker, { target: { value: 'unreadable-admin' } })
      expect((await screen.findByRole('alert')).textContent).toContain(
        'Unreadable admin cannot read this record, so they cannot witness it.',
      )
      expect(isDisabled('Request witness')).toBe(true)
      fireEvent.click(screen.getByRole('button', { name: 'Request witness' }))
      expect(rpc.mock.calls.map(([name]) => name)).toEqual([
        'is_workspace_writer',
        'signature_witness_candidates',
      ])
      fireEvent.change(picker, { target: { value: 'view-only' } })
      expect(screen.queryByRole('alert')).toBeNull()
      expect(isDisabled('Request witness')).toBe(false)
    } finally {
      queryClient.clear()
      rpc.mockRestore()
      list.mockRestore()
    }
  })

  it('offers the candidate list the server returns and disables a revoked selection without granting access', async () => {
    const rpc = vi
      .spyOn(reviewsDataClient, 'rpc')
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce([
        {
          user_id: 'view-only',
          name: 'View only',
          workspace_role: 'member',
          can_read_record: true,
        },
      ])
      .mockResolvedValueOnce([])
    const list = vi.spyOn(reviewsDataClient, 'list').mockResolvedValue([])
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    try {
      render(
        <QueryClientProvider client={queryClient}>
          <SignaturePanel
            submission={submission()}
            revision={{
              id: 'rev-1',
              record_id: 'rec-1',
              structure_version: 1,
              metadata_version: 1,
              metadata_snapshot: {},
              block_snapshot: [],
              reason: 'submit',
              superseded_by_revision_id: null,
              created_at: '2026-10-04T12:00:00Z',
              created_by_user_id: 'owner-a',
            }}
            projectId="exact-project"
            signatures={[]}
            integrityDigest={DIGEST}
            currentUserId="owner-a"
            currentUserName="Author"
            open={false}
            onOpenChange={vi.fn()}
          />
        </QueryClientProvider>,
      )
      await screen.findByRole('option', { name: 'View only · member' })
      const picker = screen.getByLabelText(
        'Request a witness for this frozen revision',
      )
      fireEvent.change(picker, { target: { value: 'view-only' } })
      expect(isDisabled('Request witness')).toBe(false)
      await act(async () => {
        await queryClient.invalidateQueries({
          queryKey: ['signature-witness-candidates'],
        })
      })
      await waitFor(() => expect(isDisabled('Request witness')).toBe(true))
      expect(
        screen.getByText(
          'No other member of this project may witness this revision, so there is nobody to ask.',
        ),
      ).toBeTruthy()
      expect(rpc.mock.calls.map(([name]) => name)).toEqual([
        'is_workspace_writer',
        'signature_witness_candidates',
        'signature_witness_candidates',
      ])
    } finally {
      queryClient.clear()
      rpc.mockRestore()
      list.mockRestore()
    }
  })
})

// ---------------------------------------------------------------------------
// REV-01.3 — private reviewer drafts, "Return with N comments", and the
// author's returned banner.
// ---------------------------------------------------------------------------

function commentWire(
  id: string,
  overrides: Partial<CommentWire> = {},
): CommentWire {
  return {
    id,
    workspace_id: 'ws-1',
    revision_id: 'rev-1',
    record_id: 'rec-1',
    sheet_instance_id: null,
    root_id: id,
    parent_id: null,
    target_kind: 'revision',
    target: {},
    body: `${id} evidence`,
    mentions: [],
    state: 'open',
    resolved_at: null,
    resolved_by_user_id: null,
    author_user_id: 'reviewer-a',
    created_at: '2026-10-10T00:00:00.000Z',
    updated_at: '2026-10-10T00:00:00.000Z',
    ...overrides,
  }
}

describe('REV-01.3 — return carries the draft comment count', () => {
  it('labels the request-changes action with the drafts it will send', () => {
    render(
      <ActionButtons
        submission={submission()}
        permission={makePermission({ canReview: true, canWithdraw: false })}
        integrityDigest={DIGEST}
        draftCommentCount={2}
        onAfterDecision={vi.fn().mockResolvedValue(undefined)}
      />,
    )
    expect(
      screen.getByRole('button', { name: 'Return with 2 comments' }),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Request changes' })).toBeNull()
  })

  it('keeps the plain label when there are no drafts', () => {
    render(
      <ActionButtons
        submission={submission()}
        permission={makePermission({ canReview: true, canWithdraw: false })}
        integrityDigest={DIGEST}
        onAfterDecision={vi.fn().mockResolvedValue(undefined)}
      />,
    )
    expect(screen.getByRole('button', { name: 'Request changes' })).toBeTruthy()
  })

  it('states that the return publishes its drafts when confirming', async () => {
    render(
      <ActionButtons
        submission={submission()}
        permission={makePermission({ canReview: true, canWithdraw: false })}
        integrityDigest={DIGEST}
        draftCommentCount={1}
        onAfterDecision={vi.fn().mockResolvedValue(undefined)}
      />,
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Return with 1 comment' }),
    )
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(/sends your 1 draft comment/)).toBeTruthy()
  })
})

describe('REV-01.3 — private draft tray', () => {
  it('shows drafts as not sent and lets the reviewer edit or delete them', () => {
    const drafts = [
      newDraft({ targetKind: 'revision', target: {}, body: 'first draft' }),
      newDraft({
        targetKind: 'block',
        target: { blockId: 'b1' },
        body: 'second draft',
      }),
    ]
    const onEdit = vi.fn()
    const onDelete = vi.fn()
    render(
      <DraftCommentsTray drafts={drafts} onEdit={onEdit} onDelete={onDelete} />,
    )

    expect(screen.getByText('2 draft comments')).toBeTruthy()
    expect(screen.getByText(/not visible to the author/)).toBeTruthy()
    expect(screen.getByText('first draft')).toBeTruthy()
    expect(screen.getAllByText('draft · not sent')).toHaveLength(2)

    fireEvent.click(
      screen.getAllByRole('button', { name: 'Delete draft comment' })[0],
    )
    expect(onDelete).toHaveBeenCalledWith(drafts[0].id)

    fireEvent.click(
      screen.getAllByRole('button', { name: 'Edit draft comment' })[0],
    )
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Draft comment body' }),
      {
        target: { value: 'first draft, edited' },
      },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onEdit).toHaveBeenCalledWith(drafts[0].id, 'first draft, edited')
  })

  it('renders nothing when there are no drafts', () => {
    const { container } = render(
      <DraftCommentsTray drafts={[]} onEdit={vi.fn()} onDelete={vi.fn()} />,
    )
    expect(container.querySelector('[aria-label="Draft comments"]')).toBeNull()
  })
})

describe('REV-01.3 — author returned banner', () => {
  it('names the returned comment count and blocks resubmit while open', () => {
    const onGoToComment = vi.fn()
    render(
      <ReturnedCommentsBanner
        openCommentCount={1}
        returnedByName="Reviewer A"
        returnedAt="2026-10-10T00:00:00.000Z"
        recordId="rec-1"
        onGoToComment={onGoToComment}
      />,
    )
    expect(
      screen.getByText(/1 comment to resolve before you resubmit/),
    ).toBeTruthy()
    // The author is told who returned it, by name — never a user id.
    expect(screen.getByRole('status').textContent).toContain('by Reviewer A')
    const resubmit = screen.getByRole('button', { name: 'Resubmit (1 open)' })
    expect(resubmit.hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Go to comment' }))
    expect(onGoToComment).toHaveBeenCalledTimes(1)
  })

  it('offers resubmit once every returned comment is resolved', () => {
    render(
      <ReturnedCommentsBanner
        openCommentCount={0}
        returnedByName="Reviewer A"
        returnedAt="2026-10-10T00:00:00.000Z"
        recordId="rec-1"
        onGoToComment={vi.fn()}
      />,
    )
    expect(
      screen.getByText(/0 comments to resolve before you resubmit/),
    ).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'Resubmit' }).getAttribute('href'),
    ).toBe('/records/rec-1')
    expect(screen.queryByRole('button', { name: /Resubmit/ })).toBeNull()
  })
})

describe('REV-01.3 — author resolve and reply path', () => {
  it('lets the author comment on a returned review', () => {
    // The author is neither the active reviewer nor the withdrawer, but a
    // returned submission must still let them resolve or reply.
    expect(
      canCommentOnRevision({
        canReview: false,
        canWithdraw: false,
        state: 'returned',
      }),
    ).toBe(true)
    // A reviewer on the active round comments directly (no drafts required).
    expect(
      canCommentOnRevision({
        canReview: true,
        canWithdraw: false,
        state: 'submitted',
      }),
    ).toBe(true)
    // An outsider on an active review cannot comment.
    expect(
      canCommentOnRevision({
        canReview: false,
        canWithdraw: false,
        state: 'submitted',
      }),
    ).toBe(false)
  })

  it('resolves a returned thread and replies to it through the comment RPCs', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false } },
    })
    client.setQueryData(commentsQueryKeys.forRevision('rev-1'), [
      commentWire('root-1'),
    ])
    const rpc = vi
      .spyOn(reviewsDataClient, 'rpc')
      .mockResolvedValue({ id: 'root-1', state: 'resolved' })
    const list = vi
      .spyOn(reviewsDataClient, 'list')
      .mockResolvedValue([commentWire('root-1')])
    try {
      render(
        <QueryClientProvider client={client}>
          <CommentPanel
            revisionId="rev-1"
            targetKind="revision"
            target={{}}
            currentUserId="owner-a"
            currentUserName="Priya"
            canComment
          />
        </QueryClientProvider>,
      )

      fireEvent.click(
        await screen.findByRole('button', { name: 'Resolve thread' }),
      )
      await waitFor(() =>
        expect(rpc).toHaveBeenCalledWith('resolve_comment_thread', {
          p_comment_id: 'root-1',
        }),
      )

      fireEvent.click(screen.getByRole('button', { name: 'Reply to thread' }))
      fireEvent.change(screen.getByRole('textbox', { name: 'Reply body' }), {
        target: { value: 'Corrected the dilution factor.' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Send reply' }))
      await waitFor(() =>
        expect(rpc).toHaveBeenCalledWith('reply_to_comment', {
          p_parent_id: 'root-1',
          p_body: 'Corrected the dilution factor.',
          p_mentions: [],
        }),
      )
    } finally {
      rpc.mockRestore()
      list.mockRestore()
      client.clear()
    }
  })
})

// ---------------------------------------------------------------------------
// R5-SHELL-05 — the signing session outliving its session, and the signing
// lock that a direct URL must not bypass.
// ---------------------------------------------------------------------------

function certifiedReviewer(userId: string) {
  return {
    userId,
    name: 'Reviewer A',
    statementVersion: 1,
    certifiedAt: '2026-10-04T12:01:00Z',
    revokedAt: null,
    identityVerifiedAt: '2026-10-04T12:00:00Z',
    identityVerifiedBy: 'admin',
    verifiedEmail: 'reviewer.a@sheetbase.test',
    verificationRequested: false,
    authMethod: 'password',
  }
}

describe('R5-SHELL-05 — signing session expiry and lockout', () => {
  async function renderSigningPanel() {
    navigateMock.mockReset()
    requestSignatureStepUpMock.mockReset()
    signRevisionMock.mockReset()
    const rpc = vi.spyOn(reviewsDataClient, 'rpc').mockResolvedValue(true)
    const list = vi
      .spyOn(reviewsDataClient, 'list')
      .mockImplementation(async (resource: string) =>
        resource === 'review_check_results' ? [passingCheckResult()] : [],
      )
    const onOpenChange = vi.fn()
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    fetchWorkspaceCertificationsMock.mockResolvedValueOnce([
      certifiedReviewer('reviewer-a'),
    ])
    render(
      <QueryClientProvider client={queryClient}>
        <SignaturePanel
          submission={submission()}
          revision={{
            id: 'rev-1',
            record_id: 'rec-1',
            structure_version: 1,
            metadata_version: 1,
            metadata_snapshot: {},
            block_snapshot: [],
            reason: 'submit',
            superseded_by_revision_id: null,
            created_at: '2026-10-04T12:00:00Z',
            created_by_user_id: 'owner-a',
          }}
          projectId={null}
          signatures={[]}
          integrityDigest={DIGEST}
          currentUserId="reviewer-a"
          currentUserName="Reviewer A"
          open
          onOpenChange={onOpenChange}
        />
      </QueryClientProvider>,
    )
    // The dialog renders once eligibility and certification resolve.
    await screen.findByLabelText('Signing password')
    fireEvent.change(screen.getByLabelText('Signing password'), {
      target: { value: 'local-signing-password' },
    })
    fireEvent.change(screen.getByLabelText('Type your name to confirm'), {
      target: { value: 'Reviewer A' },
    })
    return { rpc, list, queryClient, onOpenChange }
  }

  it('returns to the review to sign again when the session ended mid-signing', async () => {
    const { rpc, list, queryClient, onOpenChange } = await renderSigningPanel()
    requestSignatureStepUpMock.mockRejectedValueOnce(
      new SignatureStepUpError(401, 'Sign in again.', 'session_expired'),
    )
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Sign' }))
      await waitFor(() =>
        expect(requestSignatureStepUpMock).toHaveBeenCalledOnce(),
      )
      await waitFor(() =>
        expect(navigateMock).toHaveBeenCalledWith({
          to: '/sign-in',
          search: { state: 'expired-signing', next: '/review/rev-1' },
        }),
      )
      // Nothing was recorded, and the dead retry is not left open.
      expect(signRevisionMock).not.toHaveBeenCalled()
      expect(onOpenChange).toHaveBeenCalledWith(false)
    } finally {
      rpc.mockRestore()
      list.mockRestore()
      queryClient.clear()
    }
  })

  it('refuses to sign while locked, whatever URL reached the dialog', async () => {
    const { rpc, list, queryClient } = await renderSigningPanel()
    requestSignatureStepUpMock.mockRejectedValueOnce(
      new SignatureStepUpError(
        423,
        'Signing is locked for 15 minutes after three failed attempts.',
      ),
    )
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Sign' }))
      const alert = await screen.findByRole('alert')
      expect(alert.textContent).toContain(
        'Signing is locked for 15 minutes after three failed attempts.',
      )
      // The lock is enforced by the step-up endpoint: no token, no signature,
      // and no navigation lets the person around it.
      expect(signRevisionMock).not.toHaveBeenCalled()
      expect(navigateMock).not.toHaveBeenCalled()
    } finally {
      rpc.mockRestore()
      list.mockRestore()
      queryClient.clear()
    }
  })
})

// ---------------------------------------------------------------------------
// QA-182 / QA-183 / QA-184 — the decision dialog's pending state, and the
// stated reasons behind a signing control that cannot be used.
// ---------------------------------------------------------------------------

function revisionFixture() {
  return {
    id: 'rev-1',
    record_id: 'rec-1',
    structure_version: 1,
    metadata_version: 1,
    metadata_snapshot: {},
    block_snapshot: [],
    reason: 'submit',
    superseded_by_revision_id: null,
    created_at: '2026-10-04T12:00:00Z',
    created_by_user_id: 'owner-a',
  }
}

function renderSignaturePanel(
  overrides: { currentUserId?: string; currentUserName?: string } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <SignaturePanel
        submission={submission()}
        revision={revisionFixture()}
        projectId="exact-project"
        signatures={[]}
        integrityDigest={DIGEST}
        currentUserId={overrides.currentUserId ?? 'reviewer-a'}
        currentUserName={overrides.currentUserName ?? 'Reviewer A'}
        open={false}
        onOpenChange={vi.fn()}
      />
    </QueryClientProvider>,
  )
  return queryClient
}

describe('QA-182 — the decision dialog owns its pending state', () => {
  it('stays open and blocks a second submit until the decision lands', async () => {
    let land: () => void = () => {}
    const onAfterDecision = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          land = resolve
        }),
    )
    renderActionButtons({
      permission: makePermission({ canReview: true, canWithdraw: false }),
      onAfterDecision,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve' }))

    // The RPC is still running: the dialog is open, the action is disabled and
    // neither it nor Cancel can be used again.
    const pending = await within(dialog).findByRole('button', {
      name: 'Submitting…',
    })
    expect(pending.hasAttribute('disabled')).toBe(true)
    fireEvent.click(pending)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(onAfterDecision).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('alertdialog')).toBeTruthy()

    await act(async () => {
      land()
    })
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  })

  it('keeps an amendment refusal inside its dialog instead of dismissing it', async () => {
    createAmendmentMock.mockRejectedValueOnce(
      new Error('amendment refused by the server'),
    )
    const onAfterAmendment = vi.fn(async () => {})
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AmendmentSection
          recordId="rec-1"
          onAfterAmendment={onAfterAmendment}
        />
      </QueryClientProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Start amendment' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(
      within(dialog).getByLabelText('Reason for the amendment'),
      { target: { value: 'Wrong buffer recorded' } },
    )
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Confirm amendment' }),
    )

    expect(
      await within(dialog).findByText('amendment refused by the server'),
    ).toBeTruthy()
    // The dialog is still on screen, nothing was recorded, and the record was
    // not reported as unlocked.
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(createAmendmentMock).toHaveBeenCalledTimes(1)
    expect(onAfterAmendment).not.toHaveBeenCalled()
  })

  it('will not start an amendment without a reason', async () => {
    createAmendmentMock.mockClear()
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AmendmentSection recordId="rec-1" onAfterAmendment={async () => {}} />
      </QueryClientProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Start amendment' }))
    const dialog = await screen.findByRole('dialog')
    expect(
      within(dialog)
        .getByRole('button', { name: 'Confirm amendment' })
        .hasAttribute('disabled'),
    ).toBe(true)
    expect(createAmendmentMock).not.toHaveBeenCalled()
  })
})

describe('QA-183 — an unusable witness picker states why', () => {
  it('explains a failed member lookup instead of a greyed select', async () => {
    const rpc = vi
      .spyOn(reviewsDataClient, 'rpc')
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error('nope'))
    const list = vi.spyOn(reviewsDataClient, 'list').mockResolvedValue([])
    const queryClient = renderSignaturePanel()
    try {
      await waitFor(() =>
        expect(
          screen
            .getByLabelText('Request a witness for this frozen revision')
            .hasAttribute('disabled'),
        ).toBe(true),
      )
      expect(
        screen.getByText(/members who may witness could not be loaded/i),
      ).toBeTruthy()
    } finally {
      queryClient.clear()
      rpc.mockRestore()
      list.mockRestore()
    }
  })
})

describe('QA-184 — signing always states why it is unavailable', () => {
  it('says so when the certification lookup failed', async () => {
    fetchWorkspaceCertificationsMock.mockRejectedValueOnce(new Error('nope'))
    const rpc = vi.spyOn(reviewsDataClient, 'rpc').mockResolvedValue(true)
    const list = vi.spyOn(reviewsDataClient, 'list').mockResolvedValue([])
    const queryClient = renderSignaturePanel()
    try {
      expect(await screen.findByText(/could not be checked/i)).toBeTruthy()
      expect(screen.queryByRole('dialog')).toBeNull()
    } finally {
      queryClient.clear()
      rpc.mockRestore()
      list.mockRestore()
    }
  })
})
