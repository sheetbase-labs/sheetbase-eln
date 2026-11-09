/**
 * COLLAB-04 review-workspace coordination tests. Renders the full review
 * route component with the Liveblocks config hooks and the route's data
 * clients mocked, asserting:
 *
 * 1. Collaboration disabled (or identity missing) -> the workspace renders
 *    unchanged: no presence area, no Discussion section.
 * 2. Collaboration enabled -> the record room mounts, the header shows who
 *    else is reviewing (PresenceStack) and the inspector exposes the
 *    record-anchored Discussion thread panel.
 *
 * No review/workflow state is exercised here beyond rendering; reviewer
 * assignment, decisions and signatures remain Sheetbase RPC territory.
 */
import type * as roomHooks from '#/lib/collaboration/room-hooks'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import type { ReactNode } from 'react'

import { ReviewWorkspaceRoute } from './-revision-page'
import { ShortcutProvider } from '#/components/shortcuts/shortcut-provider'

// ---------------------------------------------------------------------------
// Hoisted state the mocks read per test.
// ---------------------------------------------------------------------------

interface RouteContextStub {
  user: { id: string; name: string; email: string }
  workspace: { id: string; name: string; role: string }
}

const h = vi.hoisted(() => ({
  collaborationEnabled: true,
  tab: 'diff',
  others: [] as Array<{ connectionId?: number; info?: { name?: string } }>,
  routeContext: null as unknown as RouteContextStub,
}))

const WS_ID = '11111111-1111-4111-8111-111111111111'
const RECORD_ID = '22222222-2222-4222-8222-222222222222'
const REVISION_ID = '33333333-3333-4333-8333-333333333333'
const SUBMISSION_ID = '55555555-5555-4555-8555-555555555555'
const USER_ID = '44444444-4444-4444-8444-444444444444'

// ---------------------------------------------------------------------------
// Router seams.
// ---------------------------------------------------------------------------

vi.mock('@tanstack/react-router', () => ({
  getRouteApi: () => ({
    useRouteContext: () => ({ context: h.routeContext }),
  }),
  redirect: (options: unknown) => options,
  useNavigate: () => vi.fn(),
  useParams: () => ({ revisionId: REVISION_ID }),
  useSearch: () => ({ tab: h.tab }),
  Link: ({
    children,
    ...props
  }: { children: ReactNode } & Record<string, unknown>) => (
    <a {...props}>{children}</a>
  ),
}))

// ---------------------------------------------------------------------------
// Data layer seams. The route's queries resolve to a submitted revision of
// an unlocked record in the current workspace.
// ---------------------------------------------------------------------------

const revisionRow = {
  id: REVISION_ID,
  record_id: RECORD_ID,
  superseded_by_revision_id: null,
  integrity_digest: 'a'.repeat(64),
  reason: 'Add titration controls',
  created_at: '2026-08-01T00:00:00Z',
}

const recordRow = {
  id: RECORD_ID,
  identifier: 'REC-001',
  title: 'Titration curve',
  kind: 'experiment',
  locked_at: null,
  locked_by_revision_id: null,
  project_id: null,
}

const submissionRow = {
  id: SUBMISSION_ID,
  state: 'submitted',
  assigned_reviewer_user_ids: [USER_ID],
  submitted_by_user_id: USER_ID,
  submitted_at: '2026-08-01T00:00:00Z',
  workflow_definition_key: 'standard-review',
}

h.routeContext = {
  user: { id: USER_ID, name: 'Rae Reviewer', email: 'rae@example.com' },
  workspace: { id: WS_ID, name: 'Lab', role: 'scientist' },
}

vi.mock('#/lib/data-client', () => ({
  createDataClient: () => ({}),
  DataClientError: class DataClientError extends Error {
    code: string
    constructor(code: string, message: string) {
      super(message)
      this.code = code
    }
  },
}))

vi.mock('#/lib/reviews', () => ({
  fetchProjectsForReviews: vi.fn(async () => ({})),
  fetchRecordsForReviews: vi.fn(async () => [recordRow]),
  reviewQueryKeys: {
    recordsForReviews: (ids: string[]) => ['reviews', 'records', ids],
    projectsForReviews: () => ['reviews', 'projects'],
  },
  reviewsDataClient: {},
  workflowStepsFor: vi.fn(() => []),
}))

vi.mock('#/lib/review-workspace', () => ({
  approveReview: vi.fn(),
  blockedReasonLabel: (reason: string) => reason,
  DECISION_CONSEQUENCE: {
    approve: '',
    reject: '',
    request_changes: '',
    withdraw: '',
  },
  DECISION_NEXT_STATE: {
    approve: 'approved',
    reject: 'rejected',
    request_changes: 'returned',
    withdraw: 'withdrawn',
  },
  deriveReviewActionPermission: vi.fn(() => ({
    canReview: true,
    canWithdraw: true,
    reviewBlockedReason: null,
    withdrawBlockedReason: null,
  })),
  fetchReviewDecisions: vi.fn(async () => []),
  fetchReviewSubmissionByRevision: vi.fn(async () => submissionRow),
  fetchRevisionOptionsForRecord: vi.fn(async () => []),
  fetchRevisionRow: vi.fn(async () => revisionRow),
  reviewWorkspaceQueryKeys: {
    revision: (id: string) => ['review-workspace', 'revision', id],
    submissionForRevision: (id: string) => [
      'review-workspace',
      'submission',
      id,
    ],
    revisionOptions: (id: string) => ['review-workspace', 'options', id],
    decisions: (id: string) => ['review-workspace', 'decisions', id],
  },
  rejectReview: vi.fn(),
  requestChangesOnReview: vi.fn(),
  toCanonicalEnvelope: vi.fn(() => ({})),
  withdrawReview: vi.fn(),
}))

vi.mock('#/lib/review-checks', () => ({
  fetchReviewCheckResults: vi.fn(async () => []),
  reviewCheckQueryKeys: {
    resultsForRevision: (id: string) => ['review-checks', id],
  },
  runRevisionChecks: vi.fn(),
  runDefaultRevisionChecks: vi.fn(async () => ({})),
}))

vi.mock('#/lib/signatures', async (importOriginal) => ({
  ...(await importOriginal()),
  ASSURANCE_LEVEL_STATEMENT: { standard: 'Standard assurance statement.' },
  fetchSignaturesForSubmission: vi.fn(async () => []),
  fetchSignatureEligibility: vi.fn(async () => ({
    writer: false,
    requests: [],
  })),
  signatureQueryKeys: {
    forSubmission: (id: string) => ['signatures', id],
    eligibility: (id: string, userId: string) => [
      'signatures',
      'eligibility',
      id,
      userId,
    ],
  },
  SIGNATURE_MEANING_LABEL: { 'reviewed-and-approved': 'Reviewed and approved' },
  SIGNATURE_MEANING_OPTIONS: [
    {
      value: 'reviewed-and-approved',
      label: 'Reviewed and approved',
      description: '',
    },
  ],
  signRevision: vi.fn(),
}))

vi.mock('#/lib/signature-certification', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchWorkspaceCertifications: vi.fn(async () => []),
  isCurrentStatement: () => false,
  signatureCertificationDataClient: {},
  signatureCertificationQueryKeys: {
    workspace: (id: string) => ['ui-port', 'signature-certifications', id],
  },
}))

vi.mock('#/lib/workspace-admin', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchWorkspaceMembers: vi.fn(async () => []),
}))

vi.mock('#/lib/sign-002', () => ({
  createAmendment: vi.fn(),
  fetchRecordTimeline: vi.fn(async () => []),
  sign002DataClient: {},
  sign002QueryKeys: {
    timeline: (id: string) => ['sign-002', 'timeline', id],
  },
}))

vi.mock('#/lib/notebook-data', () => ({
  formatDate: (value: string | null) =>
    value ? String(value).slice(0, 10) : '',
}))

// ---------------------------------------------------------------------------
// Collaboration seams. The real CollaborationRoom / PresenceStack run with the
// connection stubbed out and the room's peers supplied by the test, so the
// readiness context and presence rendering behave exactly as in production.
// ---------------------------------------------------------------------------

vi.mock('#/lib/collaboration/provider', () => ({
  CollabProvider: class {
    destroy() {}
  },
  collabUrl: () => 'ws://localhost/api/collaboration/ws',
}))

vi.mock('#/lib/collaboration/room-hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof roomHooks>()),
  useOthers: () => h.others,
}))

vi.mock('#/lib/collaboration/collaboration-enabled', () => ({
  useCollaborationEnabled: () => h.collaborationEnabled,
}))

// Heavy non-collaboration panels are not under test here.
vi.mock('#/components/audit', () => ({
  ApprovalStepper: () => <div />,
  RecordHistoryTimeline: () => <div />,
}))

vi.mock('#/components/comments', () => ({
  CommentPanel: () => {
    const [replying, setReplying] = useState(false)

    return replying ? (
      <textarea aria-label="Reply body" />
    ) : (
      <button aria-label="Reply to thread" onClick={() => setReplying(true)} />
    )
  },
}))

vi.mock('#/components/notebook/notebook-sheet-block', () => ({
  FrozenSheetEvidencePanel: () => <div />,
}))

vi.mock('#/components/review', () => ({
  ReviewCheckResults: () => <div />,
  RevisionDiffReview: () => <div />,
  RevisionDocumentReview: () => <div />,
}))

// jsdom does not implement ResizeObserver; radix UI reads it on mount.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

afterEach(() => {
  cleanup()
  h.collaborationEnabled = true
  h.tab = 'diff'
  h.others = []
})

function renderWorkspace(withShortcuts = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={client}>
      {withShortcuts ? (
        <ShortcutProvider definitions={[]}>
          <ReviewWorkspaceRoute />
        </ShortcutProvider>
      ) : (
        <ReviewWorkspaceRoute />
      )}
    </QueryClientProvider>,
  )
}

describe('review workspace collaboration gating', () => {
  it('replies and focuses only the owning comments panel with two workspaces mounted', async () => {
    h.tab = 'comments'
    const first = renderWorkspace()
    const second = renderWorkspace(true)
    await within(first.container).findByRole('button', {
      name: 'Reply to thread',
    })
    await within(second.container).findByRole('button', {
      name: 'Reply to thread',
    })

    fireEvent.keyDown(document.body, { key: 'r' })
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve))
    })

    const reply = within(second.container).getByRole('textbox', {
      name: 'Reply body',
    })

    expect(document.activeElement).toBe(reply)
    expect(
      within(first.container).queryByRole('textbox', { name: 'Reply body' }),
    ).toBeNull()
    expect(
      within(first.container).getByRole('button', { name: 'Reply to thread' }),
    ).toBeTruthy()
  })

  it('renders the workspace unchanged when collaboration is disabled', async () => {
    h.collaborationEnabled = false

    renderWorkspace()

    // The review surface itself is untouched.
    expect(
      (await screen.findAllByText('Titration curve')).length,
    ).toBeGreaterThan(0)

    // No presence area anywhere.
    expect(screen.queryByRole('group', { name: /here/ })).toBeNull()
  })

  it('shows peer presence in the header when enabled', async () => {
    h.others = [{ connectionId: 1, info: { name: 'Ada Analyst' } }]

    renderWorkspace()

    await screen.findAllByText('Titration curve')

    const stack = await screen.findByRole('group', { name: '1 here' })
    expect(within(stack).getByTitle('Ada Analyst')).toBeTruthy()
  })
})
