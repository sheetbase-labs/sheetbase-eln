import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { ExperimentHistory } from '#/components/audit/experiment-history'
import type { AuditEventWire } from '#/lib/audit-history'
import { workspaceGeneralQueryKey } from '#/lib/workspace-general'
import type { WorkspaceGeneral } from '#/lib/workspace-general'

/**
 * The experiment audit trail: the fetch wrapper (`ExperimentHistory`) and the
 * table/row detail it renders (`ExperimentHistoryView`). The wrapper's two
 * reads are seeded by the query client, so both halves are covered without a
 * request.
 */
const RECORD_ID = '0198d970-e266-4000-8000-0000000000a1'
const IDENTIFIER = 'EXP-2026-0042'

function event(overrides: Partial<AuditEventWire> = {}): AuditEventWire {
  return {
    sequence: 1,
    id: '00000000-0000-4000-8000-000000000001',
    createdAt: '2026-08-26T10:00:00.000000Z',
    entityType: 'record',
    entityUuid: RECORD_ID,
    operation: 'update',
    recordId: RECORD_ID,
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
    payload: {
      title: 'Virus stability at 4 °C',
      changes: {
        title: { from: 'Stability run 3', to: 'Virus stability at 4 °C' },
      },
    },
  }),
  event({
    sequence: 2,
    id: '00000000-0000-4000-8000-000000000002',
    createdAt: '2026-08-26T11:30:00.000000Z',
    entityType: 'block',
    entityUuid: '00000000-0000-4000-8000-0000000000bb',
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
    sequence: 3,
    id: '00000000-0000-4000-8000-000000000003',
    createdAt: '2026-08-27T09:05:00.000000Z',
    entityType: 'file',
    entityUuid: '00000000-0000-4000-8000-0000000000ff',
    operation: 'create',
    payload: { filename: 'qPCR-plate-1.csv' },
  }),
  event({
    sequence: 4,
    id: '00000000-0000-4000-8000-000000000004',
    createdAt: '2026-08-27T14:00:00.000000Z',
    entityType: 'status',
    entityUuid: RECORD_ID,
    payload: { changes: { status: { from: 'draft', to: 'submitted' } } },
  }),
]

const workspace: WorkspaceGeneral = {
  name: 'Stability programme',
  site: 'Cambridge',
  timezone: 'Europe/London',
  dateFormat: 'DD MMM YYYY',
  numberFormat: 'decimal',
  publicationApprovalRequired: true,
  offlineEditingAllowed: false,
  requireChangeReason: false,
  lockOnSign: true,
  regulatedLab: false,
  idPrefixes: { experiment: 'EXP' },
}

function client(state: 'ready' | 'loading' | 'error' = 'ready') {
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
  if (state === 'ready') {
    instance.setQueryData(['record-audit-history', RECORD_ID], {
      events,
      snapshotBefore: 5,
    })
    instance.setQueryData(workspaceGeneralQueryKey, workspace)
  }
  return instance
}

const meta = {
  title: 'Audit/Experiment history',
  component: ExperimentHistory,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <QueryClientProvider client={client()}>
        <div className="h-[520px] w-[900px] max-w-full">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
  args: { recordId: RECORD_ID, identifier: IDENTIFIER },
} satisfies Meta<typeof ExperimentHistory>
export default meta
type Story = StoryObj<typeof meta>

/** The full trail with category counts, actor filter and CSV export. */
export const Default: Story = {}

export const Loading: Story = {
  decorators: [
    (Story) => (
      <QueryClientProvider client={client('loading')}>
        <div className="h-[520px] w-[900px] max-w-full">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
}

/** Either read failing is reported once, with a retry. */
export const ReadError: Story = {
  decorators: [
    (Story) => (
      <QueryClientProvider client={client('error')}>
        <div className="h-[520px] w-[900px] max-w-full">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
}
