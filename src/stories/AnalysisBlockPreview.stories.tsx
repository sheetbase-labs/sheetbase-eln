import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { AnalysisBlockPreview } from '#/components/notebook/block-preview'
import type { FrozenAnalysis } from '#/lib/analysis-block'

/**
 * The analysis block's read view (SCI-03). Its payload names a saved
 * analysis; the preview renders what the block carries — the cited method,
 * the frozen numbers when they exist, and an honest state when none is
 * configured. A named analysis is read from its definition, so the stories
 * supply that read: in flight on first paint, and refused when it fails.
 */
function client(behaviour: 'pending' | 'refused') {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn:
          behaviour === 'pending'
            ? () => new Promise(() => {})
            : () => Promise.reject(new Error('offline')),
      },
    },
  })
}

const meta = {
  title: 'Notebook/Analysis block preview',
  component: AnalysisBlockPreview,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <QueryClientProvider client={client('pending')}>
        <div className="w-[680px] max-w-full">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
  args: {},
} satisfies Meta<typeof AnalysisBlockPreview>
export default meta
type Story = StoryObj<typeof meta>

/** Nothing configured yet: the block says what to do. */
export const Unconfigured: Story = { args: { payload: {} } }

/** A named analysis: its definition read is in flight, as on first paint. */
export const NamedAnalysis: Story = {
  args: {
    payload: {
      title: 'Recovery by storage condition',
      provenance: 'Grouped descriptive statistics · ANOVA',
      definitionId: 'analysis-1',
    },
  },
}

/** The saved analysis cannot be read: the block says so instead of guessing. */
export const ReadRefused: Story = {
  args: {
    payload: {
      title: 'Recovery by storage condition',
      provenance: 'Grouped descriptive statistics · ANOVA',
      definitionId: 'analysis-1',
    },
  },
  decorators: [
    (Story) => (
      <QueryClientProvider client={client('refused')}>
        <div className="w-[680px] max-w-full">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
}

const frozen: FrozenAnalysis = {
  revisionId: null,
  frozenAt: '2026-10-22T12:00:00Z',
  frozenByUserId: 'scientist',
  methodVersion: 1,
  exclusionPolicy: 'exclude_bound_fields',
  definition: {
    definitionVersion: 1,
    kind: 'descriptive',
    datasets: [{ datasetId: 'dataset-1' }],
    value: { fieldId: 'recovery' },
  },
  definitionName: 'Recovery',
  definitionVersion: 1,
  columns: [
    {
      fieldId: 'recovery',
      label: 'Recovery (%)',
      logicalType: 'decimal',
      unit: { storageUnit: '%' },
    },
  ],
  datasetProvenance: [
    {
      datasetId: 'dataset-1',
      datasetVersionId: 'snapshot-1',
      schemaVersionNumber: 1,
      sourceDatasetRevision: 1,
      rowCount: 3,
      checksum: '12345678',
    },
  ],
}

function FrozenPreview({
  includeFlagged = false,
}: {
  includeFlagged?: boolean
}) {
  const evidence: FrozenAnalysis = {
    ...frozen,
    exclusionPolicy: includeFlagged
      ? 'include_flagged'
      : 'exclude_bound_fields',
  }
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  })
  queryClient.setQueryData(
    ['analysis-frozen-version-rows', 'snapshot-1', 3, evidence.exclusionPolicy],
    {
      rows: [
        { recovery: 1, __sheetbaseRowId: 'r1' },
        { recovery: 3, __sheetbaseRowId: 'r2' },
        { recovery: 100, __sheetbaseRowId: 'r3' },
      ],
      totalCount: 3,
      matchesProvenance: true,
      flags: includeFlagged
        ? []
        : [
            {
              id: 'flag-1',
              datasetId: 'dataset-1',
              rowId: 'r3',
              fieldId: 'recovery',
              kind: 'out_of_range',
              reason: 'Rejected outlier',
              comment: null,
              setAt: frozen.frozenAt,
            },
          ],
    },
  )
  return (
    <QueryClientProvider client={queryClient}>
      <AnalysisBlockPreview payload={{ title: 'Recovery', frozen: evidence }} />
    </QueryClientProvider>
  )
}

export const FrozenExclusions: Story = {
  args: { payload: {} },
  render: () => <FrozenPreview />,
}
export const FrozenAllValues: Story = {
  args: { payload: {} },
  render: () => <FrozenPreview includeFlagged />,
}
