import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import {
  RecordLineageList,
  RecordLineageSection,
} from '#/components/knowledge/record-lineage-section'
import {
  LINEAGE_MINI_DEPTH,
  buildLineageGraph,
  lineageQueryKeys,
} from '#/lib/lineage-data'
import type {
  RecordLinkWire,
  RecordWire,
  ReviewSubmissionWire,
} from '#/lib/lineage-data'

/**
 * KNOW-02 — the per-object lineage miniature in the record inspector.
 *
 * The graph is built by the same `buildLineageGraph` the app uses, from fixed
 * wire fixtures, so every row below is the component's own output: live
 * destinations, the frozen evidence revision, the honest missing row, and the
 * seed's own row deliberately excluded. `RecordLineageSection` reads through
 * its query seam, seeded through the client, so no request is issued.
 */
const SEED_ID = 'seed-id'

function record(id: string, kind: string, identifier: string): RecordWire {
  return {
    id,
    workspace_id: 'ws-1',
    project_id: 'proj-1',
    kind,
    identifier,
    title: `${identifier} title`,
    status: 'draft',
    properties: {},
    tags: [],
    structure_version: 1,
    metadata_version: 1,
    created_at: '2025-07-14T09:12:00Z',
    updated_at: '2025-07-14T09:12:00Z',
    archived_at: null,
    deleted_at: null,
    created_by_user_id: 'user-1',
    updated_by_user_id: null,
  }
}

function link(
  id: string,
  sourceId: string,
  targetId: string | null,
  targetIdentifier: string,
): RecordLinkWire {
  return {
    id,
    source_record_id: sourceId,
    target_record_id: targetId,
    target_kind: 'experiment',
    target_identifier: targetIdentifier,
    link_type: 'sample',
    link_metadata: {},
    created_at: '2025-07-14T09:12:00Z',
    created_by_user_id: 'user-1',
  }
}

function submission(): ReviewSubmissionWire {
  return {
    id: 'sub-9',
    workspace_id: 'ws-1',
    record_id: SEED_ID,
    revision_id: 'rev-9',
    state: 'submitted',
    workflow_definition_key: 'default-scientific-review',
    workflow_definition_version: 1,
    assigned_reviewer_user_ids: [],
    submitted_by_user_id: 'user-1',
    submitted_at: '2025-07-15T09:12:00Z',
    created_at: '2025-07-15T09:12:00Z',
    updated_at: '2025-07-15T09:12:00Z',
  }
}

/** A sample upstream, a downstream experiment, a frozen revision, one gone. */
const graph = buildLineageGraph(
  [
    record('up-id', 'sample', 'SMP-UP-1'),
    record(SEED_ID, 'experiment', 'EXP-SEED-1'),
    record('down-id', 'experiment', 'EXP-DOWN-1'),
  ],
  [
    link('l-up', 'up-id', SEED_ID, 'EXP-SEED-1'),
    link('l-down', SEED_ID, 'down-id', 'EXP-DOWN-1'),
    link('l-gone', SEED_ID, null, 'GONE-1'),
  ],
  [submission()],
  [],
  [],
  [],
  SEED_ID,
  LINEAGE_MINI_DEPTH,
)

/** A seed with no neighbours at all. */
const soloGraph = buildLineageGraph(
  [record(SEED_ID, 'experiment', 'EXP-SEED-1')],
  [],
  [],
  [],
  [],
  [],
  SEED_ID,
  LINEAGE_MINI_DEPTH,
)

function withGraph(seedGraph: typeof graph, pending = false) {
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
    if (!pending) {
      client.setQueryData(
        lineageQueryKeys.graphFor(SEED_ID, LINEAGE_MINI_DEPTH),
        seedGraph,
      )
    }
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
  title: 'Knowledge/Lineage section',
  component: RecordLineageList,
  tags: ['autodocs'],
  args: { graph, seedRecordId: SEED_ID },
} satisfies Meta<typeof RecordLineageList>
export default meta
type Story = StoryObj<typeof meta>

/** The miniature: typed rows, live destinations, the missing row as text. */
export const Neighbours: Story = {}

/** No neighbours: the section says so rather than rendering an empty list. */
export const NoNeighbours: Story = {
  args: { graph: soloGraph },
}

/** The inspector section, reading the same graph through its query seam. */
export const Section: Story = {
  render: () => <RecordLineageSection recordId={SEED_ID} />,
  decorators: [withGraph(graph)],
}

/** While the read is in flight the section says it is reading. */
export const SectionLoading: Story = {
  render: () => <RecordLineageSection recordId={SEED_ID} />,
  decorators: [withGraph(graph, true)],
}

/** The seed has no lineage: the inspector hint, not a blank panel. */
export const SectionNoNeighbours: Story = {
  render: () => <RecordLineageSection recordId={SEED_ID} />,
  decorators: [withGraph(soloGraph)],
}
