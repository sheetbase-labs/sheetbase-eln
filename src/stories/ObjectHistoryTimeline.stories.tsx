import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { ObjectHistoryTimeline } from '#/components/audit/object-history-timeline'
import type { AuditEventWire } from '#/lib/audit-history'

/**
 * GOV-03 object history timeline. Events are the authoritative
 * `api.change_events` rows, so these fixtures carry the same payload keys the
 * RPC returns and the timeline describes them itself (who / what / before →
 * after) — nothing here is pre-rendered prose.
 */
function event(overrides: Partial<AuditEventWire> = {}): AuditEventWire {
  return {
    sequence: 1,
    id: '00000000-0000-4000-8000-000000000001',
    createdAt: '2026-08-26T10:00:00.000000Z',
    entityType: 'record',
    entityUuid: '00000000-0000-4000-8000-000000000001',
    operation: 'update',
    recordId: null,
    projectId: '10000000-0000-4000-8000-000000000009',
    actorUserId: 'actor-1',
    actorName: 'Ada Scientist',
    actorCredentialId: null,
    clientId: null,
    payload: {},
    ...overrides,
  }
}

const events: AuditEventWire[] = [
  event({
    sequence: 12,
    id: '00000000-0000-4000-8000-000000000012',
    createdAt: '2026-08-26T14:12:00.000000Z',
    payload: {
      title: 'Virus stability at 4 °C',
      changes: {
        title: { from: 'Stability run 3', to: 'Virus stability at 4 °C' },
      },
    },
  }),
  event({
    sequence: 13,
    id: '00000000-0000-4000-8000-000000000013',
    createdAt: '2026-08-26T15:40:00.000000Z',
    entityType: 'block',
    entityUuid: '00000000-0000-4000-8000-0000000000bb',
    operation: 'update',
    actorUserId: 'actor-2',
    actorName: 'Marco Silva',
    payload: {
      type: 'rich_text',
      blockId: '00000000-0000-4000-8000-0000000000bb',
      changes: {
        text: { from: 'Incubate 24 h.', to: 'Incubate 24 h at 37 °C.' },
      },
    },
  }),
  event({
    sequence: 14,
    id: '00000000-0000-4000-8000-000000000014',
    createdAt: '2026-08-27T09:05:00.000000Z',
    entityType: 'file',
    entityUuid: '00000000-0000-4000-8000-0000000000ff',
    operation: 'create',
    payload: {
      filename: 'qPCR-plate-1.csv',
      byteSize: 18432,
      checksum: 'b'.repeat(64),
    },
  }),
  event({
    sequence: 15,
    id: '00000000-0000-4000-8000-000000000015',
    createdAt: '2026-08-27T11:20:00.000000Z',
    entityType: 'signature',
    entityUuid: '00000000-0000-4000-8000-0000000000aa',
    operation: 'create',
    actorCredentialId: 'cred-1',
    actorName: null,
    payload: {
      meaning: 'reviewed',
      signerName: 'Priya Raman',
    },
  }),
]

const meta = {
  title: 'Audit/Object history timeline',
  component: ObjectHistoryTimeline,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-[560px] max-w-full">
        <Story />
      </div>
    ),
  ],
  args: { events, onLoadMore: () => {} },
} satisfies Meta<typeof ObjectHistoryTimeline>
export default meta
type Story = StoryObj<typeof meta>

/** A rename, a block edit, a file and a signature, grouped by day. */
export const Default: Story = {}

export const Loading: Story = { args: { loading: true } }

/** No events yet: the timeline says so rather than inventing history. */
export const Empty: Story = { args: { events: [] } }

/** Permission and read failures are distinct from an empty history. */
export const PermissionDenied: Story = {
  args: {
    events: [],
    error: 'Your role does not permit reading this object’s history.',
  },
}

/** More pages exist: the caller owns pagination, the timeline reports it. */
export const LoadMore: Story = { args: { hasMore: true } }

export const LoadingMore: Story = {
  args: { hasMore: true, loadingMore: true },
}

/** A bounded scroll region for embedding in a panel. */
export const BoundedHeight: Story = { args: { maxHeight: '16rem' } }
