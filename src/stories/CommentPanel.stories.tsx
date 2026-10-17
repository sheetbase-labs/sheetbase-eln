import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { CommentPanel } from '#/components/comments/comment-panel'
import { commentsQueryKeys } from '#/lib/comments-data'
import type { CommentWire } from '#/lib/comments-data'

/**
 * REV-004 anchored comments. The panel reads through a query, so these
 * stories seed the cache (or refuse the read) with a static client: the
 * threads, counts and composer below are the panel's own output with no
 * network involved.
 */
const REVISION_ID = 'revision-1'
const RECORD_ID = 'record-1'

function wire(overrides: Partial<CommentWire> = {}): CommentWire {
  return {
    id: 'c1',
    workspace_id: 'workspace',
    revision_id: REVISION_ID,
    record_id: null,
    sheet_instance_id: null,
    root_id: 'c1',
    parent_id: null,
    target_kind: 'revision',
    target: {},
    body: 'Ct values for the 25 °C arm sit below the detection threshold after 48 hours.',
    mentions: [],
    state: 'open',
    resolved_at: null,
    resolved_by_user_id: null,
    author_user_id: 'user-2',
    created_at: '2026-07-29T11:52:00Z',
    updated_at: '2026-07-29T11:52:00Z',
    ...overrides,
  }
}

const threads: CommentWire[] = [
  wire(),
  wire({
    id: 'c2',
    root_id: 'c1',
    parent_id: 'c1',
    body: 'Noted — I will re-run the plate with the extended standard curve.',
    author_user_id: 'user-1',
    created_at: '2026-07-29T13:14:00Z',
    updated_at: '2026-07-29T13:14:00Z',
  }),
  wire({
    id: 'c3',
    root_id: 'c3',
    body: 'Please confirm the storage temperature recorded in the notebook matches the freezer log.',
    target_kind: 'block',
    target: { blockId: 'blk-results' },
    created_at: '2026-07-29T14:20:00Z',
    updated_at: '2026-07-29T14:20:00Z',
  }),
  wire({
    id: 'c4',
    root_id: 'c4',
    body: 'Resolved before submission.',
    state: 'resolved',
    resolved_at: '2026-07-29T15:00:00Z',
    resolved_by_user_id: 'user-1',
    created_at: '2026-07-29T09:00:00Z',
    updated_at: '2026-07-29T15:00:00Z',
  }),
]

function seededClient(rows: CommentWire[], key: readonly unknown[]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  client.setQueryData(key, rows)
  return client
}

const loaded = (rows: CommentWire[], key: readonly unknown[]) => [
  (Story: () => React.ReactNode) => (
    <QueryClientProvider client={seededClient(rows, key)}>
      <div className="w-[520px] max-w-full">
        <Story />
      </div>
    </QueryClientProvider>
  ),
]

const pending = [
  (Story: () => React.ReactNode) => (
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false, queryFn: () => new Promise(() => {}) },
          },
        })
      }
    >
      <div className="w-[520px] max-w-full">
        <Story />
      </div>
    </QueryClientProvider>
  ),
]

const refused = [
  (Story: () => React.ReactNode) => (
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: {
              retry: false,
              queryFn: () => Promise.reject(new Error('offline')),
            },
          },
        })
      }
    >
      <div className="w-[520px] max-w-full">
        <Story />
      </div>
    </QueryClientProvider>
  ),
]

const meta = {
  title: 'Comments/Comment panel',
  component: CommentPanel,
  tags: ['autodocs'],
  args: {
    revisionId: REVISION_ID,
    targetKind: 'revision',
    target: {},
    currentUserId: 'user-1',
    currentUserName: 'Ava Chen',
    canComment: true,
  },
} satisfies Meta<typeof CommentPanel>
export default meta
type Story = StoryObj<typeof meta>

/** Open and resolved threads, plus the composer. */
export const RevisionComments: Story = {
  decorators: loaded(threads, commentsQueryKeys.forRevision(REVISION_ID)),
}

/** A reviewer's new comment becomes a private draft, not a sent comment. */
export const ReviewerDraft: Story = {
  args: { onDraftComment: () => {} },
  decorators: loaded(threads, commentsQueryKeys.forRevision(REVISION_ID)),
}

/** Record-scoped comments: the composer is suppressed because the record
 * surface owns it, so the panel is a read. */
export const RecordComments: Story = {
  args: {
    revisionId: undefined,
    targetKind: undefined,
    target: undefined,
    recordId: RECORD_ID,
  },
  decorators: loaded(threads, commentsQueryKeys.forRecord(RECORD_ID)),
}

/** A viewer without write access can read threads but not reply. */
export const ReadOnly: Story = {
  args: { canComment: false },
  decorators: loaded(threads, commentsQueryKeys.forRevision(REVISION_ID)),
}

/** Historical targets allow replies but not a fresh root comment. */
export const NoFreshRoot: Story = {
  args: { canCreate: false },
  decorators: loaded(threads, commentsQueryKeys.forRevision(REVISION_ID)),
}

/** No threads on this revision: the panel's own empty state, not a blank list. */
export const Empty: Story = {
  decorators: loaded([], commentsQueryKeys.forRevision(REVISION_ID)),
}

export const Loading: Story = {
  decorators: pending,
}

export const LoadError: Story = {
  decorators: refused,
}
