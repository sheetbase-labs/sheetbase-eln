import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { ObjectHistoryDialog } from '#/components/audit/object-history-dialog'
import type { AuditEventWire } from '#/lib/audit-history'

/**
 * GOV-03 history surface for objects whose main workspace is a full-bleed
 * editor. The dialog reads its own paginated stream when it opens, so the
 * stories seed the first page (or refuse the read): click the History trigger
 * to see the timeline the story provides.
 */
const OBJECT_ID = '0198d970-e266-4000-8000-000000000030'

function event(overrides: Partial<AuditEventWire> = {}): AuditEventWire {
  return {
    sequence: 1,
    id: '00000000-0000-4000-8000-000000000001',
    createdAt: '2026-08-26T10:00:00.000000Z',
    entityType: 'sheet',
    entityUuid: OBJECT_ID,
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

const firstPage = {
  formatVersion: 1 as const,
  events: [
    event({
      sequence: 41,
      id: '00000000-0000-4000-8000-000000000041',
      payload: {
        title: 'Observation worksheet',
        changes: { name: { from: 'Worksheet', to: 'Observation worksheet' } },
      },
    }),
    event({
      sequence: 42,
      id: '00000000-0000-4000-8000-000000000042',
      entityType: 'row',
      entityUuid: '00000000-0000-4000-8000-0000000000cc',
      actorUserId: 'actor-2',
      actorName: 'Marco Silva',
      payload: { changes: { value: { from: 41.9, to: 42.7 } } },
    }),
  ],
  hasMore: false,
  nextCursor: null,
}

function client(seed: boolean) {
  const instance = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn: () =>
          seed
            ? Promise.resolve(firstPage)
            : Promise.reject(new Error('offline')),
      },
    },
  })
  if (seed) {
    instance.setQueryData(['audit-events', 'object', OBJECT_ID], {
      pages: [firstPage],
      pageParams: [undefined],
    })
  }
  return instance
}

const meta = {
  title: 'Audit/Object history dialog',
  component: ObjectHistoryDialog,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <QueryClientProvider client={client(true)}>
        <div className="p-6">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
  args: { objectId: OBJECT_ID, objectLabel: 'Sheet' },
} satisfies Meta<typeof ObjectHistoryDialog>
export default meta
type Story = StoryObj<typeof meta>

/** The trigger as the catalogue row renders it; click to open the stream. */
export const Default: Story = {}

/** A caller-named trigger for surfaces that say what is being read. */
export const CustomTriggerLabel: Story = {
  args: { triggerLabel: 'Sheet history' },
}

/** A refused read inside the dialog reports the failure rather than an
 * empty timeline. */
export const ReadRefused: Story = {
  decorators: [
    (Story) => (
      <QueryClientProvider client={client(false)}>
        <div className="p-6">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
}
