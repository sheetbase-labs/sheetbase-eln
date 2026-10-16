import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'
import type { DataClient } from '#/lib/data-client'

import { PromoteRejected } from '#/components/sheet/promote-rejected'
import type { ColumnPromotion } from '#/lib/schema-evolution'

/**
 * The returned-promotion banner. It reads the instance's promotions and
 * renders nothing unless this field's latest promotion came back, so the
 * story seeds that read: a returned promotion shows the banner, an accepted
 * one shows nothing at all.
 */
const INSTANCE_ID = '0198d970-e266-4000-8000-000000000030'
const FIELD_ID = '0198d970-e266-4000-8000-00000000f001'

function promotion(overrides: Partial<ColumnPromotion> = {}): ColumnPromotion {
  return {
    id: 'promotion-1',
    sheet_instance_id: INSTANCE_ID,
    field_id: FIELD_ID,
    target: 'dataset_schema',
    schema_definition_id: 'sd-1',
    schema_version_id: 'sv-1',
    model_key: null,
    state: 'returned',
    approval_request_id: 'approval-1',
    requested_by_user_id: 'user-1',
    requested_at: '2026-08-01T09:00:00Z',
    decided_at: '2026-08-02T11:30:00Z',
    reason: 'Use an existing Model field instead of a new one.',
    ...overrides,
  }
}

function client(rows: ColumnPromotion[]) {
  const instance = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  instance.setQueryData(['column-promotions', INSTANCE_ID, FIELD_ID], rows)
  return instance
}

const stubClient = {} as DataClient

const meta = {
  title: 'Sheet/Promote rejected',
  component: PromoteRejected,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <QueryClientProvider client={client([promotion()])}>
        <div className="w-[640px]">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
  args: {
    instanceId: INSTANCE_ID,
    fieldId: FIELD_ID,
    client: stubClient,
    onEditAndResubmit: () => {},
    onKeepLocal: () => {},
  },
} satisfies Meta<typeof PromoteRejected>
export default meta
type Story = StoryObj<typeof meta>

/** Returned: the banner names the decision and offers both next steps. */
export const Returned: Story = {}

/** With one action only, the banner offers just that one. */
export const EditOnly: Story = { args: { onKeepLocal: undefined } }

/** No promotion for this field: the banner renders nothing. */
export const NoPromotion: Story = {
  decorators: [
    (Story) => (
      <QueryClientProvider client={client([])}>
        <div className="w-[640px]">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
}

/** A pending request is not a rejection, so nothing is shown. */
export const PendingPromotion: Story = {
  decorators: [
    (Story) => (
      <QueryClientProvider
        client={client([
          promotion({ state: 'pending', decided_at: null, reason: null }),
        ])}
      >
        <div className="w-[640px]">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
}
