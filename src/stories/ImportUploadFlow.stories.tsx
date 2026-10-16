import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { ImportUploadFlow } from '#/components/import/import-flow'
import type { CanonicalDatasetWire } from '#/lib/dataset-explorer-data'
import type { PublishedSchemaOption } from '#/lib/dataset-product'

/**
 * DSET-05 step 1 of the import flow. The component reads its Dataset list,
 * published Models, experiments and instruments through queries; stories
 * seed the two lists this step renders and leave the rest pending, so the
 * reachable states are the component's own — no request is issued.
 */
const WORKSPACE_ID = '0198d970-e266-4000-8000-00000000ffff'
const DATASETS_QUERY_KEY = ['ui-port', 'import', 'datasets'] as const
const SCHEMAS_QUERY_KEY = ['ui-port', 'import', 'schemas'] as const

function dataset(
  overrides: Partial<CanonicalDatasetWire> = {},
): CanonicalDatasetWire {
  return {
    id: 'ds-1',
    display_id: 'DS-0001',
    name: 'ELISA capsid titre',
    resource_name: 'scientific_rows_1',
    schema_version: 1,
    lifecycle: 'active',
    columns: [
      {
        id: 'field-1',
        field_name: 'raw',
        label: 'Raw',
        display_order: 1,
        logical_type: 'decimal',
        nullable: true,
        unit: { storageUnit: 'NTU' },
        validation: {},
        width: null,
        options: [],
      },
    ],
    ...overrides,
  }
}

const schemas: PublishedSchemaOption[] = [
  {
    schemaDefinitionId: 'sd-1',
    schemaVersionId: 'sv-1',
    key: 'plate-reader',
    name: 'Plate reader results',
    description: 'Absorbance and fluorescence plate reads',
    version: 2,
  },
]

function client(
  datasets: CanonicalDatasetWire[] | 'loading',
  publishedSchemas: PublishedSchemaOption[] = schemas,
) {
  const instance = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        // Every other read stays pending: this step renders without them.
        queryFn: () => new Promise(() => {}),
      },
    },
  })
  // 'loading' seeds nothing, so the Dataset read stays in flight.
  if (datasets !== 'loading') {
    instance.setQueryData(DATASETS_QUERY_KEY, datasets)
  }
  instance.setQueryData(SCHEMAS_QUERY_KEY, publishedSchemas)
  return instance
}

const meta = {
  title: 'Import/Upload flow',
  component: ImportUploadFlow,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <QueryClientProvider client={client([dataset()])}>
        <div className="w-[900px] max-w-full">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
  args: { workspaceId: WORKSPACE_ID, createdByUserId: 'user-1' },
} satisfies Meta<typeof ImportUploadFlow>
export default meta
type Story = StoryObj<typeof meta>

/** Datasets exist, so the append-or-create choice is offered. */
export const AppendOrCreate: Story = {}

/** One Dataset only — the select still opens. */
export const SingleDataset: Story = {
  decorators: [
    (Story) => (
      <QueryClientProvider
        client={client([
          dataset(),
          dataset({ id: 'ds-2', display_id: 'DS-0002', name: 'Hold time' }),
        ])}
      >
        <div className="w-[900px] max-w-full">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
}

/** A workspace with no Dataset yet: the new-Dataset branch is the only path. */
export const EmptyWorkspace: Story = {
  decorators: [
    (Story) => (
      <QueryClientProvider client={client([])}>
        <div className="w-[900px] max-w-full">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
}

/** While the Dataset list is in flight the step says so. */
export const ReadingDatasets: Story = {
  decorators: [
    (Story) => (
      <QueryClientProvider client={client('loading')}>
        <div className="w-[900px] max-w-full">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
}

/** A refused Dataset read is reported with a retry, not an empty list. */
export const DatasetReadRefused: Story = {
  decorators: [
    (Story) => {
      const refused = new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            queryFn: () => Promise.reject(new Error('offline')),
          },
        },
      })
      refused.setQueryData(SCHEMAS_QUERY_KEY, schemas)
      return (
        <QueryClientProvider client={refused}>
          <div className="w-[900px] max-w-full">
            <Story />
          </div>
        </QueryClientProvider>
      )
    },
  ],
}
