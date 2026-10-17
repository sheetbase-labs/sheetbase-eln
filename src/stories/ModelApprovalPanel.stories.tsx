import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { ModelApprovalPanel } from '#/components/v3/models/model-approval-panel'
import type { ModelApprovalPanelProps } from '#/components/v3/models/model-approval-panel'
import { approvalActorIds } from '#/components/v3/models/model-approval'
import type { ApprovalDecision } from '#/components/v3/models/model-approval'
import type { ApprovalRequest } from '#/lib/approval-requests'
import { RECORD_MODEL_VERSION_KIND } from '#/lib/record-model-versions'
import { screenQueryClient, stubDataClient } from './screen-stories'
import type { ReadSeed } from './screen-stories'

/**
 * The approval panel of one model version
 * (`src/components/v3/models/model-approval-panel.tsx`). Every state it renders
 * comes from its props — the version, the requests read for it, its decisions
 * and the signed-in role — so the stories put it in each state directly rather
 * than driving it there: not yet submitted, waiting (as an approver, as the
 * submitter, and as someone with no part in it), returned, withdrawn, approved,
 * approved-then-changed, and published without ever being submitted.
 *
 * The panel writes through its `client`, so the stories hand it one that refuses:
 * a reader who clicks Approve sees the panel's own error toast instead of a
 * request leaving the page. `pendingRequest` is the row the screen reads for a
 * draft that is waiting.
 */
const VERSION_ID = '00000000-0000-4000-8000-0000000000b4'
const WORKSPACE_ID = '90000000-0000-4000-8000-000000000001'
const REQUEST_ID = '00000000-0000-4000-8000-0000000000c1'

const ADA = { id: 'usr_01h3c9k2m4n5p6q7', name: 'Ada Scientist' }
const GRACE = { id: 'usr_01h9x7w2q3e4r5t6', name: 'Grace Owner' }
const QA = { id: 'usr_01h7b4n8s2v6z3x9', name: 'Priya Reviewer' }

/** The draft the panel always sits under, unless a story says otherwise. */
const DRAFT = {
  id: VERSION_ID,
  version: 4,
  revision: 1,
  lifecycle: 'draft',
}

const PUBLISHED = {
  id: '00000000-0000-4000-8000-0000000000b3',
  version: 3,
  revision: 2,
  lifecycle: 'published',
}

function request(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    id: REQUEST_ID,
    workspace_id: WORKSPACE_ID,
    object_kind: RECORD_MODEL_VERSION_KIND,
    object_id: VERSION_ID,
    object_revision: 1,
    required_approver_roles: ['owner', 'reviewer'],
    required_approvals: 2,
    require_independence: true,
    state: 'pending',
    reason: 'Viability becomes a release reading',
    decision_reason: null,
    approved_by_user_ids: [],
    submitted_by_user_id: ADA.id,
    submitted_at: '2026-09-24T08:10:00.000Z',
    decided_by_user_id: null,
    decided_at: null,
    created_at: '2026-09-24T08:10:00.000Z',
    updated_at: '2026-09-24T08:10:00.000Z',
    ...overrides,
  }
}

function decision(overrides: Partial<ApprovalDecision> = {}): ApprovalDecision {
  return {
    id: '00000000-0000-4000-8000-0000000000d1',
    request_id: REQUEST_ID,
    workspace_id: WORKSPACE_ID,
    user_id: GRACE.id,
    role: 'owner',
    decision: 'approved',
    reason: 'The range matches the development report.',
    created_at: '2026-09-24T09:05:00.000Z',
    ...overrides,
  }
}

const pendingRequest = request()

/** The first approval landed, the second sent it back to the submitter. */
const returnedRequest = request({
  state: 'returned',
  approved_by_user_ids: [GRACE.id],
  decided_by_user_id: QA.id,
  decided_at: '2026-09-24T11:30:00.000Z',
  decision_reason: 'Document the range in the development report first.',
})

const returnedDecisions = [
  decision(),
  decision({
    id: '00000000-0000-4000-8000-0000000000d2',
    user_id: QA.id,
    role: 'reviewer',
    decision: 'returned',
    reason: 'Document the range in the development report first.',
    created_at: '2026-09-24T11:30:00.000Z',
  }),
]

const withdrawnRequest = request({
  state: 'withdrawn',
  decided_by_user_id: ADA.id,
  decided_at: '2026-09-24T10:15:00.000Z',
})

const approvedRequest = request({
  state: 'approved',
  approved_by_user_ids: [GRACE.id, QA.id],
  decided_by_user_id: GRACE.id,
  decided_at: '2026-09-24T11:05:00.000Z',
  decision_reason: 'Cleared for release testing.',
})

/** Approved, then the draft was edited: the approval no longer covers it. */
const approvedStaleRequest = request({ ...approvedRequest, object_revision: 0 })

/**
 * The panel resolves actor ids through `useUserNames`, a server function: seed
 * the names it would show, under the key that hook builds from the actors these
 * rows name.
 */
function namesSeed(requests: ApprovalRequest[], decisions: ApprovalDecision[]) {
  return {
    key: ['user-names', approvalActorIds(requests, decisions)],
    value: { [ADA.id]: ADA.name, [GRACE.id]: GRACE.name, [QA.id]: QA.name },
  }
}

function provider(seeds: ReadSeed[] = []) {
  const client = screenQueryClient({ data: seeds })
  return (Story: () => React.ReactNode) => (
    <QueryClientProvider client={client}>
      <div className="w-[900px] max-w-full">
        <Story />
      </div>
    </QueryClientProvider>
  )
}

/** The panel writes through its client; a story never reaches the server. */
const transport = stubDataClient()

/** The panel with everything a story does not vary already set. */
function Panel({
  requests = [],
  decisions = [],
  role = 'steward',
  user = ADA,
  version = DRAFT,
  ...rest
}: Partial<ModelApprovalPanelProps>) {
  return (
    <ModelApprovalPanel
      version={version}
      publishedVersion={3}
      requests={requests}
      decisions={decisions}
      role={role}
      user={user}
      workspaceId={WORKSPACE_ID}
      objectKind={RECORD_MODEL_VERSION_KIND}
      client={transport}
      submitToken={rest.submitToken}
    />
  )
}

const meta = {
  title: 'Models/Approval panel',
  decorators: [provider()],
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

/** A draft nobody has submitted yet: a steward can name approvers and submit. */
export const NotSubmitted: Story = {
  render: () => <Panel />,
}

/** Waiting, seen by an owner it names: they may approve or return it. */
export const PendingApprover: Story = {
  decorators: [provider([namesSeed([pendingRequest], [])])],
  render: () => <Panel requests={[pendingRequest]} role="owner" user={GRACE} />,
}

/**
 * Waiting, seen by the person who submitted it: independence means they cannot
 * approve their own draft, so the only action offered is withdrawal.
 */
export const PendingSubmitter: Story = {
  decorators: [provider([namesSeed([pendingRequest], [])])],
  render: () => <Panel requests={[pendingRequest]} />,
}

/**
 * Waiting, seen by someone the request does not name: the lock is shown, the
 * trail is shown, and no action is offered.
 */
export const PendingUnrelated: Story = {
  decorators: [provider([namesSeed([pendingRequest], [])])],
  render: () => (
    <Panel
      requests={[pendingRequest]}
      role="scientist"
      user={{ id: 'usr_01h6k2p9d4w7x1y8', name: 'Sam Scientist' }}
    />
  ),
}

/**
 * Returned with its reasons: the trail keeps both decisions — the approval that
 * was recorded and the return that ended it — and the draft can be resubmitted.
 */
export const Returned: Story = {
  decorators: [provider([namesSeed([returnedRequest], returnedDecisions)])],
  render: () => (
    <Panel
      requests={[returnedRequest]}
      decisions={returnedDecisions}
      role="owner"
      user={GRACE}
    />
  ),
}

/** Withdrawn by its submitter, who can submit it again. */
export const Withdrawn: Story = {
  decorators: [provider([namesSeed([withdrawnRequest], [])])],
  render: () => <Panel requests={[withdrawnRequest]} />,
}

/** Approved for this revision: the draft can be published. */
export const Approved: Story = {
  decorators: [provider([namesSeed([approvedRequest], [])])],
  render: () => (
    <Panel requests={[approvedRequest]} role="owner" user={GRACE} />
  ),
}

/** Approved, then edited: the current revision needs a new request. */
export const ApprovalOutOfDate: Story = {
  decorators: [provider([namesSeed([approvedStaleRequest], [])])],
  render: () => (
    <Panel requests={[approvedStaleRequest]} role="owner" user={GRACE} />
  ),
}

/** A published version that never went through approval. */
export const PublishedWithoutRequest: Story = {
  render: () => <Panel version={PUBLISHED} role="owner" user={GRACE} />,
}

/**
 * The submit dialog, opened the way the page header opens it: the panel owns the
 * dialog, its approver roles and the RPC, so the header raises a token instead of
 * duplicating them. Independence is required here, so that choice is fixed.
 */
export const SubmitDialogOpened: Story = {
  render: () => <Panel submitToken={1} />,
}
