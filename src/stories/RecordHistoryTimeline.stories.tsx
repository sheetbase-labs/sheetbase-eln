import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { RecordHistoryTimeline } from '#/components/audit/record-history-timeline'
import type { TimelineEventWire } from '#/lib/sign-002'

/**
 * SIGN-002 complete chronological history for a record revision.
 * `mapTimelineEvents` turns each event into its presentational phrase, so
 * fixtures carry the type-specific details the RPC returns.
 */
function event(overrides: Partial<TimelineEventWire> = {}): TimelineEventWire {
  return {
    type: 'change_event',
    id: 'ev-1',
    seq: 1,
    ts: '2026-08-26T10:00:00.000000Z',
    title: 'record create',
    actorUserId: 'actor-1',
    ...overrides,
  }
}

const events: TimelineEventWire[] = [
  event({ seq: 1, ts: '2026-08-26T10:00:00.000000Z' }),
  event({
    id: 'ev-2',
    seq: 2,
    ts: '2026-08-26T10:05:00.000000Z',
    operation: 'update',
    title: 'record update',
    changes: {
      title: { from: 'Stability run 3', to: 'Virus stability at 4 °C' },
    },
  }),
  event({
    type: 'revision',
    id: 'rev-1',
    seq: 3,
    ts: '2026-08-27T09:10:00.000000Z',
    title: 'revision created',
    reason: 'Submitted for scientific review',
  }),
  event({
    type: 'submission',
    id: 'sub-1',
    seq: 4,
    ts: '2026-08-27T09:12:00.000000Z',
    title: 'revision submitted',
    state: 'submitted',
  }),
  event({
    type: 'check',
    id: 'check-1',
    seq: 5,
    ts: '2026-08-27T09:13:00.000000Z',
    title: 'checks run',
    overallStatus: 'warning',
  }),
  event({
    type: 'decision',
    id: 'dec-1',
    seq: 6,
    ts: '2026-08-27T14:00:00.000000Z',
    title: 'review decision',
    decision: 'approve',
    actorUserId: 'actor-2',
  }),
  event({
    type: 'signature',
    id: 'sig-1',
    seq: 7,
    ts: '2026-08-27T14:05:00.000000Z',
    title: 'signature approve-for-record',
    signatureMeaning: 'approve-for-record',
    actorUserId: 'actor-2',
  }),
  event({
    type: 'comment',
    id: 'cmt-1',
    seq: 8,
    ts: '2026-08-27T15:30:00.000000Z',
    title: 'comment created',
    state: 'open',
    actorUserId: 'actor-3',
  }),
]

const meta = {
  title: 'Audit/Record history timeline',
  component: RecordHistoryTimeline,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-[560px] max-w-full">
        <Story />
      </div>
    ),
  ],
  args: {
    events,
    currentUserId: 'actor-1',
    currentUserName: 'Ava Chen',
    onRefresh: () => {},
  },
} satisfies Meta<typeof RecordHistoryTimeline>
export default meta
type Story = StoryObj<typeof meta>

/** The viewer's own events are attributed to their name; collaborators fall
 * back to a terse user-id label. */
export const Default: Story = {}

/** With a revision pinned, the footer states the integrity digest. */
export const WithIntegrityFooter: Story = {
  args: {
    revisionId: '0198d970-e266-4000-8000-00000000007c',
    integrityDigest: '4c9620bbd4f931955d4d42820a77fa9d',
  },
}

export const Loading: Story = { args: { loading: true } }

export const Empty: Story = { args: { events: [] } }

/** A failed read is reported with a refresh affordance, not an empty list. */
export const ReadError: Story = {
  args: { events: [], error: new Error('offline') },
}

export const Refreshing: Story = { args: { refreshing: true } }
