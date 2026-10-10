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

import {
  ActionButtons,
  buildApprovalSteps,
  buildStepperState,
  canCommentOnRevision,
  DraftCommentsTray,
  renderError,
  ReturnedCommentsBanner,
  SignaturePanel,
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
  fetchWorkspaceCertifications: vi.fn(async () => []),
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
  it('offers only readable human witnesses and disables a revoked selection without granting access', async () => {
    const rpc = vi
      .spyOn(reviewsDataClient, 'rpc')
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce([
        {
          user_id: 'view-only',
          name: 'View only',
          workspace_role: 'member',
          can_view: true,
          can_review: false,
        },
        {
          user_id: 'unreadable-admin',
          name: 'Unreadable admin',
          workspace_role: 'admin',
          can_view: false,
        },
        {
          user_id: 'owner-a',
          name: 'Author',
          workspace_role: 'member',
          can_view: true,
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
      await screen.findByRole('option', { name: 'view-only · member' })
      expect(
        screen.queryByRole('option', { name: /unreadable-admin/ }),
      ).toBeNull()
      expect(screen.queryByRole('option', { name: /owner-a/ })).toBeNull()
      const picker = screen.getByLabelText(
        'Request a witness for this frozen revision',
      )
      fireEvent.change(picker, { target: { value: 'view-only' } })
      expect(isDisabled('Request witness')).toBe(false)
      rpc.mockResolvedValueOnce([])
      await act(async () => {
        await queryClient.invalidateQueries({
          queryKey: ['signature-witness-candidates'],
        })
      })
      await waitFor(() => expect(isDisabled('Request witness')).toBe(true))
      fireEvent.click(screen.getByRole('button', { name: 'Request witness' }))
      expect(rpc.mock.calls.map(([name]) => name)).toEqual([
        'is_workspace_writer',
        'project_members',
        'project_members',
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
        returnedByUserId="reviewer-a"
        returnedAt="2026-10-10T00:00:00.000Z"
        recordId="rec-1"
        onGoToComment={onGoToComment}
      />,
    )
    expect(
      screen.getByText(/1 comment to resolve before you resubmit/),
    ).toBeTruthy()
    const resubmit = screen.getByRole('button', { name: 'Resubmit (1 open)' })
    expect(resubmit.hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Go to comment' }))
    expect(onGoToComment).toHaveBeenCalledTimes(1)
  })

  it('offers resubmit once every returned comment is resolved', () => {
    render(
      <ReturnedCommentsBanner
        openCommentCount={0}
        returnedByUserId="reviewer-a"
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
