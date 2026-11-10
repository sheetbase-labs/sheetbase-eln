/**
 * Notebook comments with no review and no collaboration room: a new thread is
 * anchored to the record (or one block), @mentions travel as member ids, and
 * authors are named.
 *
 * The panel is driven through the app's own data client and the real comments,
 * members and user-name modules: `fetch` is answered here, so every read and
 * write below is checked as the request the app actually sends.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CommentWire } from '#/lib/comments-data'
import { CommentPanel } from './comment-panel'

/**
 * Answers the app's data requests from fixtures. Hoisted so the stub is in
 * place before the data client module captures `fetch`.
 */
const api = vi.hoisted(() => {
  const requests: Array<{ path: string; method: string; body: string }> = []

  const comments: CommentWire[] = []

  const state = {
    comments,
    mutation: {
      id: 'c-9',
      revisionId: null,
      rootId: 'c-9',
      parentId: null,
      targetKind: 'record',
      target: {},
      body: '',
      mentions: [],
      state: 'open',
      authorUserId: 'u-me',
      createdAt: '2026-10-04T00:00:00Z',
    },
  }

  const members = (workspaceId: string) =>
    ['u-me', 'u-ada', 'u-bo'].map((userId, index) => ({
      id: `m-${index}`,
      workspace_id: workspaceId,
      user_id: userId,
      role: 'member',
      client_id: null,
      suspended_at: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    }))

  vi.stubGlobal(
    'fetch',
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = input instanceof Request ? input.url : String(input)
      const request = new Request(new URL(url, 'http://localhost'), init)
      const { pathname } = new URL(request.url)

      requests.push({
        path: pathname,
        method: request.method,
        body: await request.text(),
      })

      if (pathname === '/api/db/rpc/record_comments')
        return Response.json(state.comments)

      if (
        pathname === '/api/db/rpc/create_record_comment' ||
        pathname === '/api/db/rpc/reply_to_comment'
      )
        return Response.json(state.mutation)

      if (pathname === '/api/db/workspace_memberships') {
        const workspaceId =
          new URL(request.url).searchParams.get('workspace_id') ?? ''

        return Response.json(members(workspaceId))
      }

      return Response.json({ message: 'Not found' }, { status: 404 })
    },
  )

  return { requests, state }
})

/** The bodies sent to one RPC, decoded as the JSON the data client posted. */
function sentTo(name: string): unknown[] {
  return api.requests
    .filter((request) => request.path === `/api/db/rpc/${name}`)
    .map((request) => JSON.parse(request.body))
}

afterEach(() => {
  cleanup()
  api.requests.length = 0
  api.state.comments = []
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

const NAMES = {
  'u-me': 'Me Myself',
  'u-ada': 'Ada Lovelace',
  'u-bo': 'Bo Peep',
}

/**
 * The names `useUserNames` resolves through its server function, seeded where
 * its query reads them: authors first, then the workspace's members, one entry
 * each, exactly as the panel asks for them.
 */
function seedNames(
  client: QueryClient,
  comments: readonly CommentWire[],
  memberIds: readonly string[],
) {
  const ids = [
    ...new Set([
      ...comments.map((comment) => comment.author_user_id ?? ''),
      ...memberIds,
    ]),
  ].filter(Boolean)

  client.setQueryData(['user-names', ids], NAMES)
}

function renderPanel(
  comments: readonly CommentWire[],
  props: { blockId?: string } = {},
) {
  api.state.comments = [...comments]

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })

  seedNames(client, comments, ['u-me', 'u-ada', 'u-bo'])

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
    const user = userEvent.setup()
    renderPanel([])

    const box = await screen.findByRole('combobox', {
      name: 'New comment body',
    })

    await user.type(box, 'Can @ada')
    await user.click(
      await screen.findByRole('option', { name: 'Ada Lovelace' }),
    )
    await user.type(box, 'check this?')
    await user.click(screen.getByRole('button', { name: /Add comment/ }))

    await waitFor(() => expect(sentTo('create_record_comment')).toHaveLength(1))
    expect(sentTo('create_record_comment')[0]).toEqual({
      p_record_id: 'rec-1',
      p_target_kind: 'record',
      p_target: {},
      p_body: 'Can @Ada Lovelace check this?',
      p_mentions: ['u-ada'],
    })
  })

  it('anchors a new comment to the block when scoped to one', async () => {
    const user = userEvent.setup()
    renderPanel([], { blockId: 'blk-1' })
    await user.type(
      await screen.findByRole('combobox', { name: 'New comment body' }),
      'Why this volume?',
    )
    await user.click(screen.getByRole('button', { name: /Add comment/ }))
    await waitFor(() => expect(sentTo('create_record_comment')).toHaveLength(1))
    expect(sentTo('create_record_comment')[0]).toMatchObject({
      p_target_kind: 'block',
      p_target: { blockId: 'blk-1' },
      p_mentions: [],
    })
  })

  it('shows only the threads on this block, and names the author', async () => {
    renderPanel(
      [
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
      ],
      { blockId: 'blk-1' },
    )
    expect(await screen.findByText('On this block')).toBeTruthy()
    expect(screen.queryByText('On the notebook')).toBeNull()
    expect(screen.queryByText('On another block')).toBeNull()
    expect(screen.getByText('Ada Lovelace')).toBeTruthy()
  })

  it('sends the people named in a reply', async () => {
    const user = userEvent.setup()
    renderPanel([wire({})])
    await user.click(
      await screen.findByRole('button', { name: 'Reply to thread' }),
    )
    await user.type(
      screen.getByRole('combobox', { name: 'Reply body' }),
      'Thanks @Bo Peep',
    )
    await user.click(screen.getByRole('button', { name: 'Send reply' }))
    await waitFor(() => expect(sentTo('reply_to_comment')).toHaveLength(1))
    expect(sentTo('reply_to_comment')[0]).toEqual({
      p_parent_id: 'c-1',
      p_body: 'Thanks @Bo Peep',
      p_mentions: ['u-bo'],
    })
  })
})
