/**
 * Notebook comments with no review and no collaboration room: a new thread is
 * anchored to the record (or one block), @mentions travel as member ids, and
 * authors are named.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type * as CommentsData from '#/lib/comments-data'
import type * as WorkspaceAdmin from '#/lib/workspace-admin'
import type { CommentWire } from '#/lib/comments-data'
import { CommentPanel } from './comment-panel'

const data = vi.hoisted(() => ({
  fetchCommentsForRecord: vi.fn(),
  createRecordComment: vi.fn(async (..._args: unknown[]) => ({})),
  replyToComment: vi.fn(async (..._args: unknown[]) => ({})),
}))
vi.mock('#/lib/comments-data', async (original) => ({
  ...(await original<typeof CommentsData>()),
  ...data,
}))
vi.mock('#/lib/notebook-data', () => ({ notebookDataClient: {} }))
vi.mock('#/lib/workspace-admin', async (original) => ({
  ...(await original<typeof WorkspaceAdmin>()),
  fetchWorkspaceMembers: vi.fn(async () => [
    { userId: 'u-me', suspendedAt: null },
    { userId: 'u-ada', suspendedAt: null },
    { userId: 'u-bo', suspendedAt: null },
  ]),
}))
vi.mock('#/lib/user-names', () => ({
  useUserNames: () => ({
    names: { 'u-me': 'Me Myself', 'u-ada': 'Ada Lovelace', 'u-bo': 'Bo Peep' },
    userLabel: (id: string) => id,
  }),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function wire(overrides: Partial<CommentWire>): CommentWire {
  return {
    id: 'c-1',
    workspace_id: 'w',
    revision_id: null,
    record_id: 'rec-1',
    sheet_instance_id: null,
    root_id: 'c-1',
    parent_id: null,
    target_kind: 'record',
    target: {},
    body: 'Looks good',
    mentions: [],
    state: 'open',
    resolved_at: null,
    resolved_by_user_id: null,
    author_user_id: 'u-ada',
    created_at: '2026-10-04T00:00:00Z',
    updated_at: '2026-10-04T00:00:00Z',
    ...overrides,
  }
}

function renderPanel(props: { blockId?: string } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <CommentPanel
        recordId="rec-1"
        workspaceId="w"
        currentUserId="u-me"
        currentUserName="Me Myself"
        canComment
        {...props}
      />
    </QueryClientProvider>,
  )
}

describe('notebook comments', () => {
  it('starts a thread on the notebook with the people @mentioned', async () => {
    data.fetchCommentsForRecord.mockResolvedValue([])
    const user = userEvent.setup()
    renderPanel({})
    const box = await screen.findByRole('combobox', {
      name: 'New comment body',
    })
    await user.type(box, 'Can @ada')
    await user.click(
      await screen.findByRole('option', { name: 'Ada Lovelace' }),
    )
    await user.type(box, 'check this?')
    await user.click(screen.getByRole('button', { name: /Add comment/ }))

    await waitFor(() => expect(data.createRecordComment).toHaveBeenCalled())
    expect(data.createRecordComment.mock.calls[0][1]).toEqual({
      recordId: 'rec-1',
      blockId: undefined,
      body: 'Can @Ada Lovelace check this?',
      mentions: ['u-ada'],
    })
  })

  it('anchors a new comment to the block when scoped to one', async () => {
    data.fetchCommentsForRecord.mockResolvedValue([])
    const user = userEvent.setup()
    renderPanel({ blockId: 'blk-1' })
    await user.type(
      await screen.findByRole('combobox', { name: 'New comment body' }),
      'Why this volume?',
    )
    await user.click(screen.getByRole('button', { name: /Add comment/ }))
    await waitFor(() => expect(data.createRecordComment).toHaveBeenCalled())
    expect(data.createRecordComment.mock.calls[0][1]).toMatchObject({
      blockId: 'blk-1',
      mentions: [],
    })
  })

  it('shows only the threads on this block, and names the author', async () => {
    data.fetchCommentsForRecord.mockResolvedValue([
      wire({ id: 'a', root_id: 'a', body: 'On the notebook' }),
      wire({
        id: 'b',
        root_id: 'b',
        target_kind: 'block',
        target: { blockId: 'blk-1' },
        body: 'On this block',
      }),
      wire({
        id: 'c',
        root_id: 'c',
        target_kind: 'block',
        target: { blockId: 'blk-2' },
        body: 'On another block',
      }),
    ])
    renderPanel({ blockId: 'blk-1' })
    expect(await screen.findByText('On this block')).toBeTruthy()
    expect(screen.queryByText('On the notebook')).toBeNull()
    expect(screen.queryByText('On another block')).toBeNull()
    expect(screen.getByText('Ada Lovelace')).toBeTruthy()
  })

  it('sends the people named in a reply', async () => {
    data.fetchCommentsForRecord.mockResolvedValue([wire({})])
    const user = userEvent.setup()
    renderPanel({})
    await user.click(
      await screen.findByRole('button', { name: 'Reply to thread' }),
    )
    await user.type(
      screen.getByRole('combobox', { name: 'Reply body' }),
      'Thanks @Bo Peep',
    )
    await user.click(screen.getByRole('button', { name: 'Send reply' }))
    await waitFor(() => expect(data.replyToComment).toHaveBeenCalled())
    expect(data.replyToComment.mock.calls[0].slice(1)).toEqual([
      'c-1',
      'Thanks @Bo Peep',
      ['u-bo'],
    ])
  })
})
