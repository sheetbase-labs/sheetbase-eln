import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import {
  PinnedRelationshipPanel,
  RelationshipList,
  RelationshipPanel,
} from '#/components/knowledge/relationship-panel'
import type { RelationshipLinks, RelationshipRow } from '#/lib/relationships'
import {
  relationshipCounterpartyIds,
  relationshipQueryKeys,
} from '#/lib/relationships'
import type { NotebookLink } from '#/lib/notebook-data'

/**
 * KNOW-01 — bidirectional relationship traversal for one record.
 *
 * The pure list renders fixed rows covering every honest state: available with
 * a stable-ID destination, archived, permission-restricted (generic title, no
 * identifier), a collapsed duplicate, and — on the historical snapshot — rows
 * that deliberately do not navigate. The live panel reads through its query
 * seam, seeded through the client, so no request is issued.
 */
const RECORD_ID = 'rec-1'

const outgoing: RelationshipRow[] = [
  {
    linkId: 'out-1',
    direction: 'outgoing',
    linkType: 'sample',
    label: 'uses',
    otherRecordId: 'rec-2',
    state: 'available',
    title: 'Cell line',
    identifier: 'SMP-2',
    destination: '/samples?selected=rec-2',
    createdAt: '2026-08-03T00:00:00Z',
    createdByUserId: 'user-1',
    duplicateCount: 1,
  },
  {
    linkId: 'out-arch',
    direction: 'outgoing',
    linkType: 'general',
    label: 'related to',
    otherRecordId: 'rec-3',
    state: 'archived',
    title: 'Old run',
    identifier: 'EXP-3',
    destination: null,
    createdAt: '2026-08-03T00:00:00Z',
    createdByUserId: null,
    duplicateCount: 1,
  },
  {
    linkId: 'out-dupe',
    direction: 'outgoing',
    linkType: 'dataset',
    label: 'produced',
    otherRecordId: 'rec-4',
    state: 'available',
    title: 'Plate 4 reads',
    identifier: 'DS-4',
    destination: '/datasets/rec-4',
    createdAt: '2026-08-04T00:00:00Z',
    createdByUserId: 'user-2',
    duplicateCount: 3,
  },
]

const incoming: RelationshipRow[] = [
  {
    linkId: 'in-1',
    direction: 'incoming',
    linkType: 'general',
    label: 'related to',
    otherRecordId: 'rec-hidden',
    state: 'permission-restricted',
    title: 'Restricted record',
    identifier: null,
    destination: null,
    createdAt: '2026-08-03T00:00:00Z',
    createdByUserId: null,
    duplicateCount: 1,
  },
]

const links: RelationshipLinks = {
  outgoing: [
    {
      id: 'out-1',
      sourceRecordId: RECORD_ID,
      targetRecordId: 'rec-2',
      targetKind: 'sample',
      targetIdentifier: 'SMP-2',
      linkType: 'sample',
      createdAt: '2026-08-03T00:00:00Z',
      createdByUserId: 'user-1',
    },
    {
      id: 'out-arch',
      sourceRecordId: RECORD_ID,
      targetRecordId: 'rec-3',
      targetKind: 'experiment',
      targetIdentifier: 'EXP-3',
      linkType: 'general',
      createdAt: '2026-08-03T00:00:00Z',
      createdByUserId: null,
    },
  ] satisfies NotebookLink[],
  incoming: [
    {
      id: 'in-1',
      sourceRecordId: 'rec-hidden',
      targetRecordId: RECORD_ID,
      targetKind: 'experiment',
      targetIdentifier: 'EXP-1',
      linkType: 'general',
      createdAt: '2026-08-03T00:00:00Z',
      createdByUserId: null,
    },
  ] satisfies NotebookLink[],
}

/** The historical (`?revision=`) snapshot: pinned outgoing rows, no actions. */
const pinnedLinks: NotebookLink[] = [
  {
    id: 'pin-1',
    sourceRecordId: RECORD_ID,
    targetRecordId: null,
    targetKind: 'sample',
    targetIdentifier: 'SMP-2',
    linkType: 'sample',
    createdAt: '2026-08-03T00:00:00Z',
    createdByUserId: 'user-1',
  },
  {
    id: 'pin-2',
    sourceRecordId: RECORD_ID,
    targetRecordId: null,
    targetKind: 'dataset',
    targetIdentifier: 'DS-4',
    linkType: 'dataset',
    createdAt: '2026-08-04T00:00:00Z',
    createdByUserId: 'user-2',
  },
]

function withLinks() {
  return (Story: () => React.ReactNode) => {
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: Infinity,
          queryFn: () => new Promise(() => {}),
        },
      },
    })
    client.setQueryData(relationshipQueryKeys.links(RECORD_ID), links)
    client.setQueryData(
      relationshipQueryKeys.endpoints(
        relationshipCounterpartyIds(RECORD_ID, links).join(','),
      ),
      new Map([
        [
          'rec-2',
          {
            id: 'rec-2',
            kind: 'sample',
            identifier: 'SMP-2',
            title: 'Cell line',
            archivedAt: null,
            deletedAt: null,
          },
        ],
        [
          'rec-3',
          {
            id: 'rec-3',
            kind: 'experiment',
            identifier: 'EXP-3',
            title: 'Old run',
            archivedAt: '2026-02-01T00:00:00Z',
            deletedAt: null,
          },
        ],
        [
          'rec-hidden',
          {
            id: 'rec-hidden',
            kind: 'experiment',
            identifier: 'EXP-1',
            title: 'Restricted record',
            archivedAt: null,
            deletedAt: null,
          },
        ],
      ]),
    )
    return (
      <QueryClientProvider client={client}>
        <div className="w-[360px] max-w-full">
          <Story />
        </div>
      </QueryClientProvider>
    )
  }
}

const meta = {
  title: 'Knowledge/Relationship panel',
  component: RelationshipList,
  tags: ['autodocs'],
  args: { outgoing, incoming },
} satisfies Meta<typeof RelationshipList>
export default meta
type Story = StoryObj<typeof meta>

/** Both directions, with counts, in the canonical entity row. */
export const BothDirections: Story = {}

/** One direction only: the empty direction renders no heading at all. */
export const OutgoingOnly: Story = {
  args: { incoming: [] },
}

/**
 * No relationships in either direction: `RelationshipList` renders nothing and
 * `RelationshipPanel` below it returns null by contract — the silence is the
 * state, and the record inspector simply has no Relationships section.
 */
export const None: Story = {
  args: { outgoing: [], incoming: [] },
}

/** The historical snapshot: pinned outgoing rows, no links and no actions. */
export const HistoricalSnapshot: Story = {
  render: () => <PinnedRelationshipPanel links={pinnedLinks} />,
}

/** The live panel reading both directions through its query seam. */
export const Panel: Story = {
  render: () => <RelationshipPanel recordId={RECORD_ID} />,
  decorators: [withLinks()],
}

/** While the links read is in flight the panel says it is reading. */
export const PanelLoading: Story = {
  render: () => <RelationshipPanel recordId={RECORD_ID} />,
  decorators: [
    (Story) => (
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: {
              queries: { retry: false, queryFn: () => new Promise(() => {}) },
            },
          })
        }
      >
        <div className="w-[360px] max-w-full">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
}
