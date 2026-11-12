import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { BoardScope } from '#/features/pipelines/board/board'
import { ActivityFeed } from '#/components/pipelines/activity/activity-feed'
import type { ActivityEvent } from '#/components/pipelines/activity/activity-events'
import { PublishButton } from '#/components/pipelines/activity/publish-button'
import { PublishRequestCard } from '#/components/pipelines/activity/publish-request-card'
import { VersionDiffView } from '#/components/pipelines/activity/version-diff-view'
import type { PublishApproval } from '#/components/pipelines/activity/use-publish-approval'
import type { ApprovalRequest } from '#/lib/approval-requests'
import type { PipelineDefinitionVersionWire } from '#/lib/pipelines/types'
import { screenRoutes } from './screen-stories'

/**
 * Asking an admin to approve a pipeline version (`src/components/pipelines/activity/`).
 *
 * The publish button asks, waits and sends an approver to the request; the
 * request card shows who asked, the text diff and what this person can do; the
 * feed lists what happened. All are prop-driven, so these are their real inputs.
 */
const meta = {
  title: 'Pipelines/Publish approval',
  parameters: {
    tanstack: {
      router: {
        route: screenRoutes('/pipelines/$pipelineId/activity'),
        path: '/pipelines/$pipelineId/activity',
        params: { pipelineId: 'pl-1' },
      },
    },
  },
  decorators: [
    (Story) => (
      <BoardScope className="w-[820px] max-w-full">
        <Story />
      </BoardScope>
    ),
  ],
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

function version(
  n: number,
  lifecycle: PipelineDefinitionVersionWire['lifecycle'],
  configuration: PipelineDefinitionVersionWire['configuration'],
): PipelineDefinitionVersionWire {
  return {
    id: `v-${n}`,
    definition_id: 'pl-1',
    workspace_id: 'ws-1',
    version: n,
    lifecycle,
    configuration_format_version: 2,
    configuration,
    revision: 1,
    created_at: '2026-11-10T09:00:00Z',
    updated_at: '2026-11-10T09:00:00Z',
    created_by_user_id: 'u-1',
    published_at: lifecycle === 'published' ? '2026-11-09T09:00:00Z' : null,
    published_by_user_id: null,
    retired_at: null,
    retired_by_user_id: null,
  }
}

const published = version(1, 'published', {
  steps: [{ name: 'normalise', statement: 'select 1' }],
})

const draft = version(2, 'draft', {
  steps: [
    { name: 'normalise', statement: 'select 1' },
    { name: 'flag', statement: 'select 2' },
  ],
})

const request: ApprovalRequest = {
  id: 'ar-1',
  workspace_id: 'ws-1',
  object_kind: 'pipeline_definition_version',
  object_id: 'v-2',
  object_revision: 1,
  required_approver_roles: ['admin', 'owner'],
  required_approvals: 1,
  require_independence: true,
  state: 'pending',
  reason: 'Adds the outlier flag step',
  decision_reason: null,
  approved_by_user_ids: [],
  submitted_by_user_id: 'u-1',
  submitted_at: '2026-11-10T10:00:00Z',
  decided_by_user_id: null,
  decided_at: null,
  created_at: '2026-11-10T10:00:00Z',
  updated_at: '2026-11-10T10:00:00Z',
}

const noop = { isPending: false, mutate: () => {} }

function approval(seen: {
  pending: ApprovalRequest | null
  canDecide: boolean
  canWithdraw: boolean
}): PublishApproval {
  // SAFETY: a stand-in carrying every field these components read.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions
  return {
    ...seen,
    latest: seen.pending,
    busy: false,
    ask: noop,
    withdraw: noop,
    approve: noop,
    returnForChanges: noop,
  } as unknown as PublishApproval
}

const who = (id: string | null | undefined) =>
  id === 'u-2' ? 'Priya Shah' : 'Gareth'

/** A draft nobody has asked about: the button opens the reason dialog. */
export const ButtonReady: Story = {
  render: () => (
    <PublishButton
      pipelineId="pl-1"
      draft={draft}
      versions={[published, draft]}
      approval={approval({
        pending: null,
        canDecide: false,
        canWithdraw: false,
      })}
    />
  ),
}

/** The asker sees that the request is waiting. */
export const ButtonWaiting: Story = {
  render: () => (
    <PublishButton
      pipelineId="pl-1"
      draft={draft}
      versions={[published, draft]}
      approval={approval({
        pending: request,
        canDecide: false,
        canWithdraw: true,
      })}
    />
  ),
}

/** An approver is sent to the request. */
export const ButtonReview: Story = {
  render: () => (
    <PublishButton
      pipelineId="pl-1"
      draft={draft}
      versions={[published, draft]}
      approval={approval({
        pending: request,
        canDecide: true,
        canWithdraw: false,
      })}
    />
  ),
}

/** What an admin reads: who asked, why, the diff, and the decision. */
export const RequestForApprover: Story = {
  render: () => (
    <PublishRequestCard
      versions={[published, draft]}
      actorLabel={who}
      approval={approval({
        pending: request,
        canDecide: true,
        canWithdraw: false,
      })}
    />
  ),
}

/** The diff on its own, against the published version. */
export const Diff: Story = {
  render: () => <VersionDiffView draft={draft} published={published} />,
}

const events: ActivityEvent[] = [
  {
    id: 'e3',
    kind: 'requested',
    at: '2026-11-10T10:00:00Z',
    version: 2,
    actorId: 'u-1',
    note: 'Adds the outlier flag step',
  },
  {
    id: 'e2',
    kind: 'published',
    at: '2026-11-09T09:00:00Z',
    version: 1,
    actorId: 'u-2',
    note: null,
  },
  {
    id: 'e1',
    kind: 'created',
    at: '2026-11-08T09:00:00Z',
    version: 1,
    actorId: 'u-1',
    note: null,
  },
]

/** Drafts, requests and publishing, newest first. */
export const Feed: Story = {
  render: () => <ActivityFeed events={events} actorLabel={who} />,
}
