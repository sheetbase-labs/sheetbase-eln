import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { ColumnPromotionsPanel } from '#/components/sheets/column-promotions-panel'

import {
  screenQueryClient,
  screenRoutes,
  stubDataClient,
} from './screen-stories'

/**
 * Column promotions waiting on a steward or on being applied. The panel reads
 * through the data client it is given, so each story hands it a stub that
 * answers the three reads by name and refuses every write.
 */
const promotion = {
  id: 'promotion-1',
  sheet_instance_id: 'sheet-1',
  field_id: 'field-1',
  target: 'model_field',
  schema_definition_id: null,
  schema_version_id: null,
  model_key: 'Sample',
  state: 'pending',
  approval_request_id: 'request-1',
  reason: 'Used in every plate run now',
  requested_by_user_id: 'user-1',
  requested_at: '2026-10-20T09:00:00Z',
  decided_at: null,
}

const request = {
  id: 'request-1',
  workspace_id: 'workspace',
  object_kind: 'column_promotion',
  object_id: 'promotion-1',
  object_revision: 1,
  required_approver_roles: ['steward'],
  required_approvals: 1,
  require_independence: true,
  state: 'pending',
  reason: null,
  decision_reason: null,
  approved_by_user_ids: [],
  submitted_by_user_id: 'user-1',
  submitted_at: '2026-10-20T09:00:00Z',
  decided_by_user_id: null,
  decided_at: null,
  created_at: '2026-10-20T09:00:00Z',
  updated_at: '2026-10-20T09:00:00Z',
}

const reads = {
  column_promotions: [promotion],
  approval_requests: [request],
  approval_request_decisions: [],
}

const client = screenQueryClient({
  data: [{ key: ['user-names', ['user-1']], value: { 'user-1': 'Ava Chen' } }],
})

const meta = {
  title: 'Sheets/Column promotions panel',
  component: ColumnPromotionsPanel,
  tags: ['autodocs'],
  parameters: {
    tanstack: {
      router: {
        route: screenRoutes('/sheets', ['/sheets/$sheetId']),
        path: '/sheets',
      },
    },
  },
  args: {
    role: 'steward',
    user: { id: 'user-2', name: 'Priya Shah' },
    client: stubDataClient(reads),
  },
  decorators: [
    (Story) => (
      <QueryClientProvider client={client}>
        <div className="w-[720px] max-w-full">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
} satisfies Meta<typeof ColumnPromotionsPanel>

export default meta

type Story = StoryObj<typeof meta>

/** A steward who did not ask for it: they can approve or return it. */
export const ToDecide: Story = {}

/** The person who asked is waiting on a steward. */
export const Waiting: Story = {
  args: { role: 'scientist', user: { id: 'user-1', name: 'Ava Chen' } },
}

/** Approved: the requester can apply it. */
export const ToApply: Story = {
  args: {
    role: 'scientist',
    user: { id: 'user-1', name: 'Ava Chen' },
    client: stubDataClient({
      ...reads,
      approval_requests: [{ ...request, state: 'approved' }],
    }),
  },
}

/** Nothing is waiting anywhere in the workspace. */
export const Empty: Story = {
  args: {
    client: stubDataClient({
      column_promotions: [],
      approval_requests: [],
      approval_request_decisions: [],
    }),
  },
}

/** The read failed. */
export const Failed: Story = {
  args: { client: stubDataClient({ column_promotions: 'error' }) },
}
