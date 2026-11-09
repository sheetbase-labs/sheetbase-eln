import { QueryClientProvider } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { expect, screen, userEvent } from 'storybook/test'

import { NewProtocolDialog } from '#/components/protocols/new-protocol-dialog'
import { ProtocolHazards } from '#/components/protocols/protocol-hazards'
import { ProtocolInspector } from '#/components/protocols/protocol-inspector'
import { ProtocolTrainingRoster } from '#/components/protocols/protocol-training-roster'
import {
  ProtocolVersionsPanel,
  protocolVersionsKey,
} from '#/components/protocols/protocol-versions-panel'
import { modelApprovalQueryKeys } from '#/components/models/model-approval-data'
import {
  PROTOCOL_REVISION_KIND,
  protocolTrainingKey,
} from '#/lib/controlled-protocols'
import type {
  ProtocolTrainingStatus,
  ProtocolVersion,
} from '#/lib/controlled-protocols'
import { materialSafetyKeys } from '#/lib/material-safety'
import { screenQueryClient, screenRoutes, withApiReads } from './screen-stories'
import type { ReadSeed } from './screen-stories'

/**
 * The protocol page's parts (`src/components/protocols/`): the versions
 * panel and its approval trail, the right-hand inspector, the training roster,
 * the hazards of the materials a protocol uses, and the dialog that starts a
 * protocol. The working document and the per-version training notice have
 * their own stories in `protocols.stories.tsx`.
 */
const PROTOCOL_ID = '00000000-0000-4000-8000-00000000b701'
const WORKSPACE_ID = '00000000-0000-4000-8000-00000000b700'
const ADA = 'usr_01h3c9k2m4n5p6q7'
const GRACE = 'usr_01h9x7w2q3e4r5t6'

const meta = {
  title: 'Protocols/Page parts',
  parameters: {
    tanstack: {
      router: {
        route: screenRoutes('/protocols/$protocolId', [
          '/experiments/$expId',
          '/materials/$materialId',
        ]),
        path: '/protocols/$protocolId',
        params: { protocolId: PROTOCOL_ID },
      },
    },
  },
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

function inside(queryClient: QueryClient, width = 760) {
  return (Story: () => React.ReactNode) => (
    <QueryClientProvider client={queryClient}>
      <div style={{ width }} className="max-w-full">
        <Story />
      </div>
    </QueryClientProvider>
  )
}

const seeded = (data: ReadSeed[]) => screenQueryClient({ data })

const version = (
  n: number,
  status: ProtocolVersion['status'],
  summary = '',
): ProtocolVersion => ({
  id: `00000000-0000-4000-8000-00000000b7${n}0`,
  workspace_id: WORKSPACE_ID,
  protocol_record_id: PROTOCOL_ID,
  version: n,
  status,
  effective_at: status === 'effective' ? '2026-09-02T00:00:00Z' : null,
  review_due_at: status === 'effective' ? '2027-09-02T00:00:00Z' : null,
  change_summary: summary,
  created_by_user_id: ADA,
  created_at: '2026-08-28T00:00:00Z',
})

const v1 = version(1, 'superseded', 'First release.')
const v2 = version(2, 'effective', 'Hold parameters clarified.')
const v3 = version(3, 'draft', 'Add a second wash step.')

const names = (ids: string[]): ReadSeed => ({
  key: ['user-names', ids],
  value: { [ADA]: 'Ada Okafor', [GRACE]: 'Grace Owner' },
})

const emptyApprovals = (ids: string[]): ReadSeed => ({
  key: modelApprovalQueryKeys.index(ids, PROTOCOL_REVISION_KIND),
  value: {
    requests: [],
    decisions: [],
    byVersion: new Map(),
    byRequest: new Map(),
  },
})

// --- Versions ---------------------------------------------------------------

const versionIds = [v3.id, v2.id, v1.id]

export const VersionsWithDraft: Story = {
  render: () => (
    <ProtocolVersionsPanel
      protocolRecordId={PROTOCOL_ID}
      workspaceId={WORKSPACE_ID}
      role="owner"
      user={{ id: ADA, name: 'Ada Okafor' }}
    />
  ),
  decorators: [
    withApiReads('error'),
    inside(
      seeded([
        {
          key: protocolVersionsKey(PROTOCOL_ID),
          value: [v3, v2, v1],
        },
        emptyApprovals(versionIds),
        names([ADA]),
      ]),
    ),
  ],
}

export const VersionsOnlyEffective: Story = {
  render: () => (
    <ProtocolVersionsPanel
      protocolRecordId={PROTOCOL_ID}
      workspaceId={WORKSPACE_ID}
      role="viewer"
      user={null}
    />
  ),
  decorators: [
    withApiReads('error'),
    inside(
      seeded([
        { key: protocolVersionsKey(PROTOCOL_ID), value: [v2] },
        emptyApprovals([v2.id]),
        names([ADA]),
      ]),
    ),
  ],
}

export const VersionsNone: Story = {
  render: () => (
    <ProtocolVersionsPanel
      protocolRecordId={PROTOCOL_ID}
      workspaceId={WORKSPACE_ID}
      role="owner"
      user={null}
    />
  ),
  decorators: [
    withApiReads('error'),
    inside(
      seeded([
        { key: protocolVersionsKey(PROTOCOL_ID), value: [] },
        emptyApprovals([]),
      ]),
    ),
  ],
}

// --- Inspector --------------------------------------------------------------

export const Inspector: Story = {
  render: () => (
    <ProtocolInspector
      protocolId={PROTOCOL_ID}
      version={v2}
      versions={[v1, v2]}
    />
  ),
  decorators: [
    withApiReads('error'),
    inside(
      seeded([
        emptyApprovals([v1.id, v2.id]),
        {
          key: ['ui-port', 'protocol-inspector', 'training', PROTOCOL_ID],
          value: [
            { user_id: ADA, status: 'trained' },
            { user_id: GRACE, status: 'required' },
          ],
        },
        {
          key: ['ui-port', 'protocol-inspector', 'used-by', PROTOCOL_ID],
          value: [
            {
              id: 'e-1',
              identifier: 'EXP-0117',
              title: 'Harvest clarification',
              status: 'in_progress',
              protocol_version_id: v2.id,
            },
            {
              id: 'e-2',
              identifier: 'EXP-0098',
              title: 'Earlier run',
              status: 'closed',
              protocol_version_id: v1.id,
            },
          ],
        },
        names([ADA, GRACE]),
      ]),
      320,
    ),
  ],
}

export const InspectorNothingYet: Story = {
  render: () => (
    <ProtocolInspector protocolId={PROTOCOL_ID} version={v3} versions={[v3]} />
  ),
  decorators: [
    withApiReads('error'),
    inside(
      seeded([
        emptyApprovals([v3.id]),
        {
          key: ['ui-port', 'protocol-inspector', 'training', PROTOCOL_ID],
          value: [],
        },
        {
          key: ['ui-port', 'protocol-inspector', 'used-by', PROTOCOL_ID],
          value: [],
        },
      ]),
      320,
    ),
  ],
}

// --- Training roster --------------------------------------------------------

const standing = (
  userId: string,
  status: ProtocolTrainingStatus['status'],
  extra: Partial<ProtocolTrainingStatus> = {},
): ProtocolTrainingStatus => ({
  protocol_record_id: PROTOCOL_ID,
  user_id: userId,
  status,
  current_version_id: v2.id,
  current_version: 2,
  trained_version: status === 'trained' ? 2 : null,
  trained_at: status === 'trained' ? '2026-09-10T09:00:00Z' : null,
  recorded_by_user_id: status === 'trained' ? GRACE : null,
  due_at: null,
  notes: null,
  overdue: false,
  ...extra,
})

const members = [
  { user_id: ADA, name: 'Ada Okafor' },
  { user_id: GRACE, name: 'Grace Owner' },
]

export const TrainingRoster: Story = {
  render: () => (
    <ProtocolTrainingRoster protocolId={PROTOCOL_ID} members={members} writer />
  ),
  decorators: [
    withApiReads('error'),
    inside(
      seeded([
        {
          key: protocolTrainingKey(PROTOCOL_ID),
          value: [
            standing(ADA, 'trained'),
            standing(GRACE, 'required', {
              due_at: '2026-10-01T00:00:00Z',
              overdue: true,
            }),
          ],
        },
        names([ADA, GRACE, GRACE]),
        names([ADA, GRACE]),
      ]),
    ),
  ],
}

export const TrainingRosterEmpty: Story = {
  render: () => (
    <ProtocolTrainingRoster
      protocolId={PROTOCOL_ID}
      members={members}
      writer={false}
    />
  ),
  decorators: [
    withApiReads('error'),
    inside(seeded([{ key: protocolTrainingKey(PROTOCOL_ID), value: [] }])),
  ],
}

// --- Hazards ----------------------------------------------------------------

const materialLinks = [
  { targetKind: 'material', targetRecordId: 'm-1' },
  { targetKind: 'material', targetRecordId: 'm-2' },
]

export const HazardsListed: Story = {
  render: () => <ProtocolHazards links={materialLinks} />,
  decorators: [
    withApiReads('error'),
    inside(
      seeded([
        {
          key: ['protocol-hazards', 'names', 'm-1,m-2'],
          value: [
            { id: 'm-1', identifier: 'MAT-0012', title: 'Acetonitrile' },
            {
              id: 'm-2',
              identifier: 'MAT-0031',
              title: 'Trifluoroacetic acid',
            },
          ],
        },
        {
          key: materialSafetyKeys.many(['m-1', 'm-2']),
          value: new Map([
            [
              'm-1',
              {
                recordId: 'm-1',
                pictograms: ['GHS02', 'GHS07'],
                signalWord: 'danger',
                hazardStatements: ['H225', 'H302'],
                sheet: null,
                updatedAt: '2026-10-01T00:00:00Z',
              },
            ],
            [
              'm-2',
              {
                recordId: 'm-2',
                pictograms: ['GHS05'],
                signalWord: 'danger',
                hazardStatements: ['H314'],
                sheet: null,
                updatedAt: '2026-10-01T00:00:00Z',
              },
            ],
          ]),
        },
      ]),
    ),
  ],
}

export const HazardsNoMaterials: Story = {
  render: () => (
    <div>
      <ProtocolHazards links={[]} />
      <p className="m-0 text-label text-fg-muted">
        A protocol that links no materials shows no hazards section at all.
      </p>
    </div>
  ),
  decorators: [inside(seeded([]), 480)],
}

// --- New protocol -----------------------------------------------------------

export const NewProtocolOpen: Story = {
  render: () => <NewProtocolDialog />,
  decorators: [
    withApiReads('error'),
    inside(
      seeded([
        {
          key: ['ui-port', 'writable-projects', 'projects'],
          value: [
            {
              id: 'p-1',
              title: 'Process Development',
              archived_at: null,
              status: 'active',
              display_id: 'PRJ-0001',
              stage: null,
              modality: null,
            },
          ],
        },
        {
          key: ['ui-port', 'writable-projects', 'access'],
          value: [{ project_id: 'p-1', can_edit: true, can_manage: true }],
        },
      ]),
      240,
    ),
  ],
  play: async () => {
    await userEvent.click(await screen.findByRole('button'))
    await expect(await screen.findByRole('dialog')).toBeInTheDocument()
  },
}
