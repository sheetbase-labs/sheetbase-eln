import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { commentsQueryKeys } from '#/lib/comments-data'
import type { CommentWire } from '#/lib/comments-data'
import { CommentPanel } from './comment-panel'

const fetchComments = vi.hoisted(() => vi.fn())
vi.mock('#/lib/comments-data', async (original) => ({
  ...(await original()),
  fetchCommentsForRevision: fetchComments,
}))

afterEach(() => {
  cleanup()
  fetchComments.mockReset()
})

function wire(id: string, parent: string | null = null): CommentWire {
  return {
    id,
    workspace_id: 'workspace',
    revision_id: 'revision',
    record_id: 'record',
    sheet_instance_id: null,
    root_id: 'root',
    parent_id: parent,
    target_kind: 'revision',
    target: {},
    body: `${id} evidence`,
    mentions: [],
    state: 'open',
    resolved_at: null,
    resolved_by_user_id: null,
    author_user_id: 'scientist',
    created_at: '2026-10-04T00:00:00Z',
    updated_at: '2026-10-04T00:00:00Z',
  }
}

describe('CommentPanel owner-scoped focus', () => {
  it('waits for a visible reply, focuses its own row, and never steals composer focus on refetch', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    fetchComments.mockResolvedValue([])
    render(
      <QueryClientProvider client={client}>
        <CommentPanel
          revisionId="revision"
          targetKind="revision"
          target={{}}
          currentUserId="scientist"
          currentUserName="Scientist"
          canComment
          focusCommentId="reply"
        />
      </QueryClientProvider>,
    )
    await screen.findByText(/No comments yet/)
    expect(document.activeElement?.getAttribute('data-comment-id')).toBeNull()
    await act(async () => {
      client.setQueryData(commentsQueryKeys.forRevision('revision'), [
        wire('root'),
        wire('reply', 'root'),
      ])
    })
    await waitFor(() =>
      expect(document.activeElement?.getAttribute('data-comment-id')).toBe(
        'reply',
      ),
    )
    const composer = screen.getByRole('textbox', { name: 'New comment body' })
    composer.focus()
    await act(async () => {
      client.setQueryData(commentsQueryKeys.forRevision('revision'), [
        wire('root'),
        wire('reply', 'root'),
        wire('later', 'root'),
      ])
    })
    expect(document.activeElement).toBe(composer)
  })

  it('does not invent a missing hit, and allows historical replies without a new root composer', async () => {
    fetchComments.mockResolvedValue([wire('root')])
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={client}>
        <CommentPanel
          revisionId="revision"
          targetKind="revision"
          target={{}}
          currentUserId="scientist"
          currentUserName="Scientist"
          canComment
          canCreate={false}
          focusCommentId="foreign"
        />
      </QueryClientProvider>,
    )
    await screen.findByText('root evidence')
    expect(document.activeElement?.getAttribute('data-comment-id')).toBeNull()
    expect(
      screen.queryByRole('textbox', { name: 'New comment body' }),
    ).toBeNull()
    expect(screen.getByRole('button', { name: 'Reply to thread' })).toBeTruthy()
  })
})
