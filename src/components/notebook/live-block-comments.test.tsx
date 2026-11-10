import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { commentsQueryKeys } from '#/lib/comments-data'
import type { CommentWire } from '#/lib/comments-data'
import { adminQueryKeys } from '#/lib/workspace-admin'
import { LiveBlockComments } from './live-block-comments'

afterEach(cleanup)

function row(
  id: string,
  blockId: string,
  state: 'open' | 'resolved',
): CommentWire {
  return {
    id,
    root_id: id,
    parent_id: null,
    target_kind: 'block',
    target: { blockId },
    state,
    created_at: '2026-10-04T00:00:00Z',
    updated_at: '2026-10-04T00:00:00Z',
    workspace_id: 'w',
    revision_id: null,
    record_id: 'rec-1',
    sheet_instance_id: null,
    body: `${blockId} note ${id}`,
    mentions: [],
    resolved_at: state === 'resolved' ? '2026-10-04T00:01:00Z' : null,
    resolved_by_user_id: state === 'resolved' ? 'u1' : null,
    author_user_id: 'u1',
  }
}

describe('LiveBlockComments', () => {
  it('counts the open threads on its own block and opens the block panel', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false } },
    })

    client.setQueryData(commentsQueryKeys.forRecord('rec-1'), [
      row('a', 'blk-1', 'open'),
      row('b', 'blk-1', 'resolved'),
      row('c', 'blk-2', 'open'),
    ])
    client.setQueryData(adminQueryKeys.members('w'), [])
    client.setQueryData(['user-names', ['u1']], { u1: 'Ada' })
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={client}>
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
    const panel = await screen.findByRole('region', { name: 'Record comments' })
    expect(panel.textContent).toContain('blk-1 note a')
    expect(panel.textContent).not.toContain('blk-2 note c')
  })
})
