import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { NotebookHistoryPanel } from '#/components/notebook/notebook-history-panel'
import { sign002QueryKeys } from '#/lib/sign-002'
import type { TimelineEventWire } from '#/lib/sign-002'
import type { RevisionWire } from '#/lib/notebook-data'

/**
 * The notebook's History tab: the record timeline plus its revisions. Both
 * reads are seeded (or refused) through the query client, so each state below
 * is the panel's own output with no request issued.
 */
const RECORD_ID = '0198d970-e266-4000-8000-0000000000a1'
const REVISIONS_KEY = ['notebook-experience', 'revisions', RECORD_ID] as const

const events: TimelineEventWire[] = [
  {
    type: 'change_event',
    id: 'ev-1',
    seq: 1,
    ts: '2026-08-26T10:00:00.000000Z',
    title: 'record create',
    actorUserId: 'user-1',
  },
  {
    type: 'change_event',
    id: 'ev-2',
    seq: 2,
    ts: '2026-08-26T10:05:00.000000Z',
    title: 'record update',
    operation: 'update',
    actorUserId: 'user-1',
    changes: {
      title: { from: 'Stability run 3', to: 'Virus stability at 4 °C' },
    },
  },
  {
    type: 'revision',
    id: 'rev-1',
    seq: 3,
    ts: '2026-08-27T09:10:00.000000Z',
    title: 'revision created',
    reason: 'Submitted for scientific review',
    actorUserId: 'user-1',
  },
]

/** One submitted revision: the list links it to the record and its package. */
const revisions: RevisionWire[] = [
  {
    id: 'rev-2f4c9a10',
    record_id: RECORD_ID,
    structure_version: 3,
    metadata_version: 2,
    metadata_snapshot: { title: 'Virus stability at 4 °C' },
    block_snapshot: [],
    reason: 'Submitted for scientific review',
    superseded_by_revision_id: null,
    created_at: '2026-08-27T09:10:00.000000Z',
    created_by_user_id: 'user-1',
  },
]

function client(state: 'ready' | 'submitted' | 'loading' | 'error') {
  if (state === 'error') {
    return new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          queryFn: () => Promise.reject(new Error('offline')),
        },
      },
    })
  }
  const instance = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  if (state !== 'loading') {
    instance.setQueryData(sign002QueryKeys.timeline(RECORD_ID), events)
    instance.setQueryData(REVISIONS_KEY, state === 'submitted' ? revisions : [])
  }
  return instance
}

function withClient(state: 'ready' | 'submitted' | 'loading' | 'error') {
  return (Story: () => React.ReactNode) => (
    <QueryClientProvider client={client(state)}>
      <div className="w-[560px] max-w-full">
        <Story />
      </div>
    </QueryClientProvider>
  )
}

const meta = {
  title: 'Notebook/History panel',
  component: NotebookHistoryPanel,
  tags: ['autodocs'],
  decorators: [withClient('ready')],
  args: {
    recordId: RECORD_ID,
    currentUserId: 'user-1',
    currentUserName: 'Ava Chen',
  },
} satisfies Meta<typeof NotebookHistoryPanel>
export default meta
type Story = StoryObj<typeof meta>

/**
 * The timeline with the viewer's own events attributed by name, and the
 * revisions list stating that nothing has been submitted yet — the panel's own
 * empty state rather than a blank list.
 */
export const Default: Story = {}

/** A submitted revision, with the record link and the evidence package. */
export const SubmittedRevision: Story = {
  decorators: [withClient('submitted')],
}

/** While the timeline read is in flight the panel says so. */
export const Loading: Story = {
  decorators: [withClient('loading')],
}

/** A refused read is reported, not shown as an empty history. */
export const ReadError: Story = {
  decorators: [withClient('error')],
}
