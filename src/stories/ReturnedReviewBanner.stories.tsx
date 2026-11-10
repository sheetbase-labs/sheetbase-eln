import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { ReturnedReviewBanner } from '#/components/notebook/returned-review-banner'
import { commentsQueryKeys } from '#/lib/comments-data'
import type { CommentWire } from '#/lib/comments-data'
import { reviewWorkspaceQueryKeys } from '#/lib/review-workspace'

import { holdRead, screenQueryClient, screenRoutes } from './screen-stories'

/**
 * A returned review, shown in the notebook where the changes are made. It reads
 * the decisions and the comments on the revision, which a story seeds.
 */
const submission = {
  id: 'submission-1',
  workspace_id: 'workspace',
  record_id: 'record-1',
  revision_id: 'revision-1',
  state: 'returned',
  workflow_definition_key: 'experiment-review',
  workflow_definition_version: 1,
  assigned_reviewer_user_ids: ['user-2'],
  submitted_by_user_id: 'user-1',
  submitted_session_id: 'session-1',
  submitted_role: 'scientist',
  submitted_at: '2026-10-20T09:00:00Z',
  due_at: null,
  idempotency_key: 'k1',
  created_at: '2026-10-20T09:00:00Z',
  updated_at: '2026-10-21T09:00:00Z',
}

const decision = {
  id: 'd1',
  workspace_id: 'workspace',
  submission_id: 'submission-1',
  revision_id: 'revision-1',
  record_id: 'record-1',
  decision: 'request_changes',
  note: null,
  revision_integrity_digest: 'abc',
  actor_user_id: 'user-2',
  actor_session_id: 's2',
  actor_role: 'reviewer',
  created_at: '2026-10-21T09:00:00Z',
}

function thread(id: string, state: 'open' | 'resolved'): CommentWire {
  return {
    id,
    workspace_id: 'workspace',
    revision_id: 'revision-1',
    record_id: null,
    sheet_instance_id: null,
    root_id: id,
    parent_id: null,
    target_kind: 'revision',
    target: {},
    body: 'Please add the blank reading.',
    mentions: [],
    state,
    resolved_at: state === 'resolved' ? '2026-10-21T12:00:00Z' : null,
    resolved_by_user_id: state === 'resolved' ? 'user-1' : null,
    author_user_id: 'user-2',
    created_at: '2026-10-21T09:00:00Z',
    updated_at: '2026-10-21T09:00:00Z',
  }
}

const decisionsKey = reviewWorkspaceQueryKeys.decisions('submission-1')
const commentsKey = commentsQueryKeys.forRevision('revision-1')
const namesKey = ['user-names', ['user-2']]
const names = { 'user-2': 'Priya Shah' }

const withOpen = screenQueryClient({
  data: [
    { key: decisionsKey, value: [decision] },
    { key: commentsKey, value: [thread('c1', 'open'), thread('c2', 'open')] },
    { key: namesKey, value: names },
  ],
})

const allResolved = screenQueryClient({
  data: [
    { key: decisionsKey, value: [decision] },
    { key: commentsKey, value: [thread('c1', 'resolved')] },
    { key: namesKey, value: names },
  ],
})

const loading = screenQueryClient()

holdRead(loading, decisionsKey)

holdRead(loading, commentsKey)

const meta = {
  title: 'Notebook/Returned review banner',
  component: ReturnedReviewBanner,
  tags: ['autodocs'],
  args: {
    submission,
    currentUserId: 'user-1',
    currentUserName: 'Ava Chen',
  },
  parameters: {
    tanstack: {
      router: {
        route: screenRoutes('/records/$recordId/notebook', [
          '/review/$revisionId',
        ]),
        path: '/records/record-1/notebook',
        params: { recordId: 'record-1' },
      },
    },
  },
  decorators: [
    (Story, context) => (
      <QueryClientProvider
        client={
          // SAFETY: the only `client` parameter this file writes is one of the three `screenQueryClient(...)` constants above; Storybook types `parameters` as an open bag, so the cast restates what this file itself wrote.
          context.parameters.client as ReturnType<typeof screenQueryClient>
        }
      >
        <div className="w-[720px] max-w-full">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
} satisfies Meta<typeof ReturnedReviewBanner>

export default meta

type Story = StoryObj<typeof meta>

/** Two comments are still open. */
export const OpenComments: Story = { parameters: { client: withOpen } }

/** Every comment has been resolved. */
export const AllResolved: Story = { parameters: { client: allResolved } }

/** Decisions and comments are still loading. */
export const Loading: Story = { parameters: { client: loading } }
