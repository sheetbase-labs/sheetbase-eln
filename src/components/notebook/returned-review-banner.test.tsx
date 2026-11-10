import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { ReturnedReviewBanner } from './returned-review-banner'
import { commentsQueryKeys } from '#/lib/comments-data'
import type { CommentWire } from '#/lib/comments-data'
import { reviewWorkspaceQueryKeys } from '#/lib/review-workspace'
import type { ReviewDecisionWire } from '#/lib/review-workspace'
import type { ReviewSubmissionWire } from '#/lib/reviews'

const decisions: ReviewDecisionWire[] = []
const comments: CommentWire[] = []

const submission: ReviewSubmissionWire = {
  id: 'sub-1',
  workspace_id: 'workspace-1',
  record_id: 'rec-1',
  revision_id: 'rev-1',
  state: 'returned',
  workflow_definition_key: 'scientific-review',
  workflow_definition_version: 1,
  assigned_reviewer_user_ids: ['reviewer'],
  submitted_by_user_id: 'me',
  submitted_session_id: 'session-1',
  submitted_role: 'member',
  submitted_at: '2026-10-02T09:00:00Z',
  due_at: null,
  idempotency_key: 'submission-1',
  created_at: '2026-10-02T09:00:00Z',
  updated_at: '2026-10-02T09:00:00Z',
}

function comment(id: string, state: CommentWire['state']): CommentWire {
  return {
    id,
    workspace_id: 'workspace-1',
    revision_id: 'rev-1',
    record_id: null,
    sheet_instance_id: null,
    root_id: id,
    parent_id: null,
    target_kind: 'revision',
    target: {},
    body: 'Check this observation',
    mentions: [],
    state,
    resolved_at: state === 'resolved' ? '2026-10-03T09:00:00Z' : null,
    resolved_by_user_id: state === 'resolved' ? 'me' : null,
    author_user_id: 'reviewer',
    created_at: '2026-10-02T09:00:00Z',
    updated_at: '2026-10-02T09:00:00Z',
  }
}

afterEach(() => {
  cleanup()
  decisions.length = 0
  comments.length = 0
})

function renderBanner() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })

  client.setQueryData(
    reviewWorkspaceQueryKeys.decisions(submission.id),
    decisions,
  )
  client.setQueryData(
    commentsQueryKeys.forRevision(submission.revision_id),
    comments,
  )
  client.setQueryData(['user-names', ['reviewer']], {
    reviewer: 'Rosalind Franklin',
  })

  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <ReturnedReviewBanner
          submission={submission}
          currentUserId="me"
          currentUserName="Ada"
        />
      ),
    }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

describe('ReturnedReviewBanner', () => {
  it('says who returned the notebook, how many comments are open and what to do next', async () => {
    decisions.push({
      id: 'decision-1',
      workspace_id: 'workspace-1',
      submission_id: submission.id,
      revision_id: submission.revision_id,
      record_id: submission.record_id,
      decision: 'request_changes',
      note: 'Please check the observations',
      revision_integrity_digest: 'a'.repeat(64),
      actor_user_id: 'reviewer',
      actor_session_id: 'review-session',
      actor_role: 'member',
      created_at: '2026-10-02T09:00:00Z',
    })
    comments.push(
      comment('c1', 'open'),
      comment('c2', 'resolved'),
      comment('c3', 'open'),
    )
    renderBanner()

    const banner = await screen.findByRole('status', {
      name: 'Returned for changes',
    })

    await waitFor(() =>
      expect(banner.textContent).toContain('by Rosalind Franklin'),
    )
    await waitFor(() => expect(banner.textContent).toContain('2 open comments'))
    expect(banner.textContent).toContain(
      'Make the changes here, then submit again',
    )
  })

  it('does not say "no open comments" next to the comments button', async () => {
    renderBanner()
    await screen.findByRole('button', { name: 'Read the comments' })
    expect(screen.getByRole('status').textContent).not.toMatch(
      /no open comments/i,
    )
  })

  it('opens the review on its comments', async () => {
    renderBanner()
    const link = await screen.findByRole('button', { name: 'Read the comments' })
    expect(link.getAttribute('href')).toBe('/review/rev-1?tab=comments')
  })
})
