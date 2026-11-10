import { QueryClientProvider } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { LiveBlockComments } from '#/components/notebook/live-block-comments'
import { commentsQueryKeys } from '#/lib/comments-data'
import type { CommentWire } from '#/lib/comments-data'

import { screenQueryClient } from './screen-stories'

/**
 * Per-block discussion for a deployment without the collaboration room. The
 * button shows the count of open threads anchored to this block; the threads
 * are ordinary comment rows read through one query, which a story seeds.
 */
const RECORD_ID = 'record-1'
const BLOCK_ID = 'block-results'

function comment(overrides: Partial<CommentWire>): CommentWire {
  return {
    id: 'c1',
    workspace_id: 'workspace',
    revision_id: null,
    record_id: RECORD_ID,
    sheet_instance_id: null,
    root_id: 'c1',
    parent_id: null,
    target_kind: 'block',
    target: { blockId: BLOCK_ID },
    body: 'Is this the blank-corrected reading?',
    mentions: [],
    state: 'open',
    resolved_at: null,
    resolved_by_user_id: null,
    author_user_id: 'user-2',
    created_at: '2026-10-20T10:00:00Z',
    updated_at: '2026-10-20T10:00:00Z',
    ...overrides,
  }
}

const open = screenQueryClient({
  data: [
    {
      key: commentsQueryKeys.forRecord(RECORD_ID),
      value: [
        comment({}),
        comment({ id: 'c2', root_id: 'c2', body: 'Please add the plate ID.' }),
      ],
    },
  ],
})

const none = screenQueryClient({
  data: [{ key: commentsQueryKeys.forRecord(RECORD_ID), value: [] }],
})

const meta = {
  title: 'Notebook/Live block comments',
  component: LiveBlockComments,
  tags: ['autodocs'],
  args: {
    workspaceId: 'workspace',
    recordId: RECORD_ID,
    blockId: BLOCK_ID,
    canComment: true,
  },
  decorators: [
    (Story, context) => {
      // Storybook keeps `parameters` as an open bag; every story in this file
      // supplies the client it seeded, built by `screenQueryClient`.
      const client: QueryClient = context.parameters.client

      return (
        <QueryClientProvider client={client}>
          <div className="group flex justify-end rounded-md border p-3">
            <Story />
          </div>
        </QueryClientProvider>
      )
    },
  ],
} satisfies Meta<typeof LiveBlockComments>

export default meta

type Story = StoryObj<typeof meta>

/** Two open threads on the block: the button carries the count. */
export const OpenThreads: Story = { parameters: { client: open } }

/** No threads: the button stays hidden until the block is hovered or focused. */
export const NoThreads: Story = { parameters: { client: none } }
