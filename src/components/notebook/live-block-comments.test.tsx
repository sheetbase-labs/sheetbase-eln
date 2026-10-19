import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type * as CommentsData from '#/lib/comments-data'
import { LiveBlockComments } from './live-block-comments'

const fetchComments = vi.hoisted(() => vi.fn())
vi.mock('#/lib/comments-data', async (original) => ({
  ...(await original<typeof CommentsData>()),
  fetchCommentsForRecord: fetchComments,
}))
vi.mock('#/lib/notebook-data', () => ({ notebookDataClient: {} }))
vi.mock('#/components/comments', () => ({
  CommentPanel: ({ blockId }: { blockId: string }) => (
    <div data-testid="panel">{blockId}</div>
  ),
}))

afterEach(cleanup)

function row(id: string, blockId: string, state: 'open' | 'resolved') {
  return {
    id,
    root_id: id,
    parent_id: null,
    target_kind: 'block',
    target: { blockId },
    state,
    created_at: '2026-10-04T00:00:00Z',
  }
}

describe('LiveBlockComments', () => {
  it('counts the open threads on its own block and opens the block panel', async () => {
    fetchComments.mockResolvedValue([
      row('a', 'blk-1', 'open'),
      row('b', 'blk-1', 'resolved'),
      row('c', 'blk-2', 'open'),
    ])
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={new QueryClient()}>
        <LiveBlockComments
          workspaceId="w"
          recordId="rec-1"
          blockId="blk-1"
          canComment
        />
      </QueryClientProvider>,
    )
    const button = await screen.findByRole('button', {
      name: 'Comments on block blk-1',
    })
    expect(await screen.findByText('1')).toBeTruthy()
    await user.click(button)
    expect((await screen.findByTestId('panel')).textContent).toBe('blk-1')
  })
})
