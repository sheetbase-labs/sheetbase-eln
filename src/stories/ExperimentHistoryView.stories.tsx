import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { ExperimentHistoryView } from '#/components/audit/experiment-history'
import type { AuditEventWire } from '#/lib/audit-history'

/**
 * The presentational half of the experiment audit trail: the table, its
 * category filters, the actor filter and the CSV export link. It takes the
 * events directly, so no query client is needed here.
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
    payload: { title: 'Virus stability at 4 °C' },
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
    entityType: 'signature',
    entityUuid: '00000000-0000-4000-8000-0000000000aa',
    operation: 'create',
    actorCredentialId: 'cred-1',
    actorName: null,
    payload: { meaning: 'reviewed', signerName: 'Priya Raman' },
  }),
]

const meta = {
  title: 'Audit/Experiment history view',
  component: ExperimentHistoryView,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="h-[520px] w-[900px] max-w-full">
        <Story />
      </div>
    ),
  ],
  args: {
    recordId: RECORD_ID,
    identifier: IDENTIFIER,
    events,
    snapshotBefore: 5,
    timeZone: 'Europe/London',
  },
} satisfies Meta<typeof ExperimentHistoryView>
export default meta
type Story = StoryObj<typeof meta>

/** Category counts, the actor filter and the export link. */
export const Default: Story = {}

/** An empty stream still renders the table chrome with zero counts. */
export const Empty: Story = {
  args: { events: [], snapshotBefore: 1 },
}

/** Events from a credential rather than a person are attributed as such. */
export const ApiCredential: Story = {
  args: {
    events: [
      event({
        actorUserId: null,
        actorName: null,
        actorCredentialId: 'cred-1',
        operation: 'create',
      }),
    ],
  },
}

/** A long captured value is shown in full when its row is selected. */
export const LongValues: Story = {
  args: {
    events: [
      event({
        payload: {
          title: 'Virus stability at 4 °C',
          changes: {
            text: {
              from: 'Incubate 24 h.',
              to: 'Incubate 24 h at 37 °C, then harvest at 72 h and measure genome titre.',
            },
          },
        },
      }),
    ],
  },
}
