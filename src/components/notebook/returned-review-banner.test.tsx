import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ReturnedReviewBanner } from './returned-review-banner'
import type * as CommentsData from '#/lib/comments-data'
import type * as ReviewWorkspace from '#/lib/review-workspace'
import type { ReviewSubmissionWire } from '#/lib/reviews'

const { decisions, comments } = vi.hoisted(() => ({
  decisions: [] as unknown[],
  comments: [] as unknown[],
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children?: React.ReactNode; to?: unknown }) => (
    <a href={typeof to === 'string' ? to : '#'}>{children}</a>
  ),
}))
vi.mock('#/lib/review-workspace', async (importOriginal) => ({
  ...(await importOriginal<typeof ReviewWorkspace>()),
  fetchReviewDecisions: async () => decisions,
}))
vi.mock('#/lib/comments-data', async (importOriginal) => ({
  ...(await importOriginal<typeof CommentsData>()),
  fetchCommentsForRevision: async () => comments,
  groupCommentsIntoThreads: (rows: unknown[]) =>
    rows.map((row) => ({ root: row })),
  threadState: (thread: { root: { resolved?: boolean } }) =>
    thread.root.resolved ? 'resolved' : 'open',
}))
vi.mock('#/lib/user-names', () => ({
  useUserNames: () => ({ names: { reviewer: 'Rosalind Franklin' } }),
}))

const submission = {
  id: 'sub-1',
  revision_id: 'rev-1',
  state: 'returned',
} as ReviewSubmissionWire

afterEach(() => {
  cleanup()
  decisions.length = 0
  comments.length = 0
})

function renderBanner() {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ReturnedReviewBanner
        submission={submission}
        currentUserId="me"
        currentUserName="Ada"
      />
    </QueryClientProvider>,
  )
}

describe('ReturnedReviewBanner', () => {
  it('says who returned the notebook, how many comments are open and what to do next', async () => {
    decisions.push({
      decision: 'request_changes',
      actor_user_id: 'reviewer',
      created_at: '2026-10-02T09:00:00Z',
    })
    comments.push({ resolved: false }, { resolved: true }, { resolved: false })
    renderBanner()
    const banner = await screen.findByRole('status', {
      name: 'Returned for changes',
    })
    await vi.waitFor(() =>
      expect(banner.textContent).toContain('by Rosalind Franklin'),
    )
    await vi.waitFor(() =>
      expect(banner.textContent).toContain('2 open comments'),
    )
    expect(banner.textContent).toContain(
      'Make the changes here, then submit again',
    )
  })

  it('opens the review on its comments', async () => {
    renderBanner()
    const link = await screen.findByRole('link', { name: 'Read the comments' })
    expect(link.getAttribute('href')).toBe('/review/$revisionId')
  })
})
