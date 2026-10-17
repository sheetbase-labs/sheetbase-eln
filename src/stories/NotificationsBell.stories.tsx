import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { NotificationsBell } from '#/components/collaboration/notifications-bell'
import { notificationsQueryKeys } from '#/lib/notifications-data'
import type { NotificationItem } from '#/lib/notifications-data'

/**
 * WORK-03.3 notification popover. The list is fed by a query, so stories
 * seed the cache with static items; the popover opens on the trigger, and
 * the row links resolve through the Storybook TanStack router.
 */
function item(overrides: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id: 'n1',
    eventType: 'revision.submitted',
    title: 'Revision submitted for review',
    body: 'Virus stability at 4 °C · EXP-2026-0042',
    recordId: 'record-1',
    projectId: 'project-1',
    createdAt: '2026-07-29T14:03:00Z',
    readAt: null,
    ...overrides,
  }
}

const mixed: NotificationItem[] = [
  item(),
  item({
    id: 'n2',
    eventType: 'comment.created',
    title: 'Ava Chen commented',
    body: 'Ct values for the 25 °C arm sit below the detection threshold.',
    recordId: 'record-1',
    createdAt: '2026-07-29T13:14:00Z',
  }),
  item({
    id: 'n3',
    eventType: 'revision.signed',
    title: 'Revision countersigned',
    body: null,
    createdAt: '2026-07-28T09:00:00Z',
    readAt: '2026-07-28T09:05:00Z',
  }),
  item({
    id: 'n4',
    eventType: 'workflow.assigned',
    title: 'You were assigned a review',
    body: 'Hold time confirmation · EXP-2026-0051',
    recordId: null,
    createdAt: '2026-07-27T16:40:00Z',
    readAt: '2026-07-27T17:00:00Z',
  }),
]

function seededClient(items: NotificationItem[]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  client.setQueryData(notificationsQueryKeys.list(), items)
  return client
}

const meta = {
  title: 'Collaboration/Notifications bell',
  component: NotificationsBell,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <QueryClientProvider client={seededClient(mixed)}>
        <div className="flex justify-end p-6">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
} satisfies Meta<typeof NotificationsBell>
export default meta
type Story = StoryObj<typeof meta>

/** Two unread items, so the unread dot shows on the trigger. */
export const Unread: Story = {}

/** Everything read: no dot, and “Mark all read” is disabled. */
export const AllRead: Story = {
  decorators: [
    (Story) => (
      <QueryClientProvider
        client={seededClient(
          mixed.map((row) => ({ ...row, readAt: row.createdAt })),
        )}
      >
        <div className="flex justify-end p-6">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
}

export const Empty: Story = {
  decorators: [
    (Story) => (
      <QueryClientProvider client={seededClient([])}>
        <div className="flex justify-end p-6">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
}

/** A long body truncates on one line inside the popover. */
export const LongBody: Story = {
  decorators: [
    (Story) => (
      <QueryClientProvider
        client={seededClient([
          item({
            body: 'Ava Chen commented on the long-term stability section of the submitted revision, requesting that the composition analysis be repeated before the next withdrawal',
          }),
        ])}
      >
        <div className="flex justify-end p-6">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
}
