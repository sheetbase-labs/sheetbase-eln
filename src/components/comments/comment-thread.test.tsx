import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CommentWire } from '#/lib/comments-data'

import { CommentThread } from './comment-thread'

afterEach(cleanup)

function wire(partial: Partial<CommentWire>): CommentWire {
  return {
    id: 'c1',
    workspace_id: 'ws',
    revision_id: 'rev',
    record_id: 'rec',
    root_id: 'c1',
    parent_id: null,
    target_kind: 'revision',
    target: {},
    body: 'root body',
    mentions: [],
    state: 'open',
    resolved_at: null,
    resolved_by_user_id: null,
    author_user_id: 'u1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...partial,
  }
}

function renderThread(
  overrides: Partial<Parameters<typeof CommentThread>[0]> = {},
) {
  const onReply = vi.fn().mockResolvedValue(undefined)
  const onResolve = vi.fn().mockResolvedValue(undefined)
  const onReopen = vi.fn().mockResolvedValue(undefined)
  render(
    <CommentThread
      root={wire({ id: 'r1', root_id: 'r1' })}
      replies={[]}
      resolved={false}
      currentUserId="me"
      currentUserName="Me"
      canComment
      onReply={onReply}
      onResolve={onResolve}
      onReopen={onReopen}
      {...overrides}
    />,
  )
  return { onReply, onResolve, onReopen }
}

describe('CommentThread', () => {
  it('attributes the current user by name and shows the body', () => {
    renderThread({
      root: wire({ id: 'r1', author_user_id: 'me' }),
    })
    expect(screen.getByText('Me')).toBeTruthy()
    expect(screen.getByText('root body')).toBeTruthy()
  })

  it('renders a departed author honestly as "Deleted user"', () => {
    renderThread({
      root: wire({ id: 'r1', author_user_id: null }),
    })
    expect(screen.getByText('Deleted user')).toBeTruthy()
  })

  it('labels other authors generically as "Reviewer"', () => {
    renderThread({
      root: wire({ id: 'r1', author_user_id: 'someone-else' }),
    })
    expect(screen.getByText('Reviewer')).toBeTruthy()
  })

  it('shows the anchored target label for a block target', () => {
    renderThread({
      root: wire({
        id: 'r1',
        target_kind: 'block',
        target: { blockId: 'block-42' },
      }),
    })
    expect(screen.getByText(/Anchored to Block block-42/)).toBeTruthy()
  })

  it('offers Resolve when open and calls onResolve', () => {
    const { onResolve } = renderThread()
    const button = screen.getByRole('button', { name: 'Resolve thread' })
    fireEvent.click(button)
    expect(onResolve).toHaveBeenCalledWith('r1')
  })

  it('offers Reopen when resolved and calls onReopen', () => {
    const { onReopen } = renderThread({ resolved: true })
    fireEvent.click(screen.getByRole('button', { name: 'Reopen thread' }))
    expect(onReopen).toHaveBeenCalledWith('r1')
  })

  it('opens a reply composer and submits the reply body', () => {
    const { onReply } = renderThread()
    fireEvent.click(screen.getByRole('button', { name: 'Reply to thread' }))
    const field = screen.getByRole('textbox', { name: 'Reply body' })
    fireEvent.change(field, { target: { value: 'a reply' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }))
    expect(onReply).toHaveBeenCalledWith('r1', 'a reply')
  })

  it('hides write controls when the viewer cannot comment', () => {
    renderThread({ canComment: false })
    expect(screen.queryByRole('button', { name: 'Resolve thread' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reply to thread' })).toBeNull()
  })
})
