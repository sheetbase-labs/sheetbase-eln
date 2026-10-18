import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { AnalysisPanel } from '#/components/viz/analysis-panel'
import { analysisDefinitionQueryKeys } from '#/lib/analysis-definitions-data'
import type { AnalysisDefinitionWire } from '#/lib/analysis-definitions-data'
import type { CanonicalDatasetSource } from '#/lib/chart-data'
import type { AnalysisDefinition } from '#/lib/analysis-definition'

/**
 * SCI-02 analysis studio. The panel reads its saved definitions through a
 * query, so these stories seed the query cache with static wires and a
 * `staleTime: Infinity` client: no request leaves the browser, and the panel
 * still renders the real saved-definition list it would show on load.
 */
const WORKSPACE_ID = '00000000-0000-4000-8000-00000000ffff'
const DATASET_ID = '11111111-1111-1111-8111-111111111111'
const TIME = 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa01'
const RECOVERY = 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa02'
const CONDITION = 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa03'

const datasets: CanonicalDatasetSource[] = [
  {
    datasetId: DATASET_ID,
    name: 'Stability — recovery',
    workspaceId: WORKSPACE_ID,
    schemaVersionId: '00000000-0000-4000-8000-00000000fffe',
    schemaVersionNumber: 2,
    revision: 3,
    columns: [
      { id: TIME, label: 'Time (h)', logicalType: 'decimal' },
      { id: RECOVERY, label: 'Recovery (%)', logicalType: 'decimal' },
      { id: CONDITION, label: 'Condition', logicalType: 'category' },
    ],
  },
  {
    datasetId: '22222222-2222-2222-8222-222222222222',
    name: 'Plate reader kinetics',
    workspaceId: WORKSPACE_ID,
    schemaVersionId: '00000000-0000-4000-8000-00000000fffd',
    schemaVersionNumber: 1,
    revision: 1,
    columns: [
      { id: TIME, label: 'Time (h)', logicalType: 'decimal' },
      { id: RECOVERY, label: 'OD₆₀₀', logicalType: 'decimal' },
    ],
  },
]

const definition: AnalysisDefinition = {
  definitionVersion: 1,
  datasets: [{ datasetId: DATASET_ID }],
  kind: 'descriptive',
  value: { fieldId: RECOVERY },
  group: { fieldId: CONDITION },
}

const saved: AnalysisDefinitionWire[] = [
  {
    id: 'saved-1',
    workspace_id: WORKSPACE_ID,
    owner_user_id: 'user-1',
    name: 'Recovery by storage condition',
    version: 4,
    definition,
    source_revisions: [
      { datasetId: DATASET_ID, revision: 3, schemaVersionNumber: 2 },
    ],
    created_at: '2026-07-02T09:00:00Z',
    updated_at: '2026-07-29T14:12:00Z',
  },
  {
    id: 'saved-2',
    workspace_id: WORKSPACE_ID,
    owner_user_id: 'user-2',
    name: 'Linear loss rate, 4 °C arm',
    version: 1,
    definition: { ...definition, kind: 'regression' },
    source_revisions: [
      { datasetId: DATASET_ID, revision: 1, schemaVersionNumber: 1 },
    ],
    created_at: '2026-06-18T11:30:00Z',
    updated_at: '2026-06-18T11:30:00Z',
  },
]

function clientWith(definitions: AnalysisDefinitionWire[]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  client.setQueryData(analysisDefinitionQueryKeys.all, definitions)
  return client
}

const meta = {
  title: 'Visualization/Analysis panel',
  component: AnalysisPanel,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <QueryClientProvider client={clientWith(saved)}>
        <div className="h-[560px] w-[880px] max-w-full">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
  args: { datasets, workspaceId: WORKSPACE_ID, userId: 'user-1' },
} satisfies Meta<typeof AnalysisPanel>
export default meta
type Story = StoryObj<typeof meta>

/** Nothing selected yet: the studio waits for a dataset and lists the saves. */
export const Default: Story = {}

/** A workspace that has not saved an analysis yet. */
export const NoSavedAnalyses: Story = {
  decorators: [
    (Story) => (
      <QueryClientProvider client={clientWith([])}>
        <div className="h-[560px] w-[880px] max-w-full">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
}

/** One dataset to choose from — the select still opens. */
export const SingleDataset: Story = {
  args: { datasets: datasets.slice(0, 1) },
}
