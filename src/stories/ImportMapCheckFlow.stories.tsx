import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { ImportMapCheckFlow } from '#/components/import/import-flow'
import type { ImportSearch } from '#/components/import/import-flow'
import type { CanonicalDatasetWire } from '#/lib/dataset-explorer-data'
import { ImportRequestError, importQueryKeys } from '#/lib/import/data'
import type {
  ImportFileUploadResponse,
  ImportReviewResponse,
} from '#/lib/import/types'

/**
 * R5-SURF-04 steps 2 and 3 for one stored import. The stored file, the
 * Dataset list and the server review are seeded from static fixtures; the
 * flow is controlled through `search`, so the wrapper keeps it in state and
 * lets the step change when the flow advances.
 */
const DATASETS_QUERY_KEY = ['ui-port', 'import', 'datasets'] as const
const IMPORT_ID = 'file-1'
const DATASET_ID = 'ds-1'

const dataset: CanonicalDatasetWire = {
  id: DATASET_ID,
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
    {
      id: 'field-2',
      field_name: 'dilution',
      label: 'Dilution',
      display_order: 2,
      logical_type: 'text',
      nullable: true,
      unit: null,
      validation: {},
      width: null,
      options: [],
    },
  ],
}

const file: ImportFileUploadResponse = {
  ok: true,
  fileId: IMPORT_ID,
  filename: 'plate-01.csv',
  mediaType: 'text/csv',
  byteSize: 2048,
  checksum: 'a'.repeat(64),
  format: 'csv',
  datasetId: DATASET_ID,
  parsed: true,
  parser: {
    key: 'sheetbase.plate-reader-csv',
    label: 'Plate reader CSV',
    format: 'csv',
    version: 2,
    confidence: 1,
    parserId: 'parser-1',
    parserVersionId: 'parser-version-1',
    status: 'approved',
  },
  sheet: {
    name: 'Sheet 1',
    headers: ['raw', 'dilution'],
    sampleRows: [{ raw: '1.2', dilution: '1:10' }],
    rowCount: 96,
    sheetNames: ['Sheet 1'],
  },
  savedMapping: null,
}

const review: ImportReviewResponse = {
  ok: true,
  expectedRevision: 1,
  schemaVersionId: 'sv-1',
  summary: {
    total: 96,
    added: 96,
    planned: 0,
    new: 96,
    flagged: 2,
    skipped: 1,
  },
  rows: [
    {
      index: 1,
      outcome: 'new',
      plannedKey: null,
      plannedRowId: null,
      flags: [],
      values: { raw: '1.2', dilution: '1:10' },
    },
    {
      index: 2,
      outcome: 'flagged',
      plannedKey: null,
      plannedRowId: null,
      flags: [
        {
          fieldId: 'field-1',
          kind: 'below_detection',
          reason: 'Below the detection threshold',
        },
      ],
      values: { raw: '0.01', dilution: '1:10' },
    },
    {
      index: 3,
      outcome: 'skipped',
      plannedKey: null,
      plannedRowId: null,
      flags: [],
      values: { raw: '', dilution: '' },
    },
  ],
  columns: [
    {
      source: 'raw',
      fieldId: 'field-1',
      fieldLabel: 'Raw',
      unit: 'NTU',
      examples: ['1.2'],
      status: 'mapped',
      note: '',
    },
    {
      source: 'dilution',
      fieldId: 'field-2',
      fieldLabel: 'Dilution',
      unit: null,
      examples: ['1:10'],
      status: 'mapped',
      note: '',
    },
  ],
  errors: [],
}

function client() {
  const instance = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        // The review read is the only unseeded one and is served from here.
        queryFn: async () => review,
      },
    },
  })
  instance.setQueryData(DATASETS_QUERY_KEY, [dataset])
  instance.setQueryData(importQueryKeys.file(IMPORT_ID), file)
  return instance
}

/**
 * A client whose stored-file read has already failed with the server's own
 * not-found code, the way `fetchImportFile` reports an unknown or foreign id.
 * `retryOnMount` is off so the primed error is the state the flow renders
 * rather than one the component immediately refetches past.
 */
function notFoundClient() {
  const instance = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        retryOnMount: false,
        queryFn: () => new Promise(() => {}),
      },
    },
  })
  void instance.fetchQuery({
    queryKey: importQueryKeys.file(IMPORT_ID),
    queryFn: () =>
      Promise.reject(
        new ImportRequestError(404, 'not_found', 'No such import.'),
      ),
  })
  instance.setQueryData(DATASETS_QUERY_KEY, [dataset])
  return instance
}

/** The stored file exists but was never pinned to a Dataset. */
function untargetedClient() {
  const instance = new QueryClient({
    defaultOptions: {
      queries: { retry: false, queryFn: () => new Promise(() => {}) },
    },
  })
  instance.setQueryData(importQueryKeys.file(IMPORT_ID), {
    ...file,
    datasetId: null,
  })
  instance.setQueryData(DATASETS_QUERY_KEY, [dataset])
  return instance
}

function Caller({ initialSearch }: { initialSearch: ImportSearch }) {
  const [search, setSearch] = useState(initialSearch)
  return (
    <ImportMapCheckFlow
      importId={IMPORT_ID}
      search={search}
      onSearch={(next) => setSearch(next)}
    />
  )
}

const meta = {
  title: 'Import/Map and check flow',
  component: ImportMapCheckFlow,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <QueryClientProvider client={client()}>
        <div className="w-[1000px] max-w-full">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
  args: {
    importId: IMPORT_ID,
    search: { step: 'map', dataset: DATASET_ID },
    onSearch: () => {},
  },
} satisfies Meta<typeof ImportMapCheckFlow>
export default meta
type Story = StoryObj<typeof meta>

/** Step 2: the file's headers against the Dataset's fields. */
export const MapColumns: Story = {
  render: () => <Caller initialSearch={{ step: 'map', dataset: DATASET_ID }} />,
}

/** Step 3: the rows the mapping produces, with flags and skips stated. */
export const ReviewRows: Story = {
  render: () => (
    <Caller
      initialSearch={{
        step: 'check',
        dataset: DATASET_ID,
        map: 'raw:field-1,dilution:field-2',
      }}
    />
  ),
}

/** The Dataset was deleted or is not visible: the flow says which. */
export const TargetUnavailable: Story = {
  render: () => (
    <Caller initialSearch={{ step: 'map', dataset: 'ds-missing' }} />
  ),
}

/** A file the server could not parse: no mapping is offered. */
export const UnparsedFile: Story = {
  decorators: [
    (Story) => (
      <QueryClientProvider
        client={((): QueryClient => {
          const refused = client()
          refused.setQueryData(importQueryKeys.file(IMPORT_ID), {
            ...file,
            parsed: false,
            parseError: 'The header row could not be read.',
            parser: null,
            sheet: null,
          })
          return refused
        })()}
      >
        <div className="w-[1000px] max-w-full">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
  render: () => <Caller initialSearch={{ step: 'map', dataset: DATASET_ID }} />,
}

/**
 * The id names no retained import: the flow states that and offers the upload
 * step, rather than an empty map step.
 */
export const ImportNotFound: Story = {
  decorators: [
    (Story) => (
      <QueryClientProvider client={notFoundClient()}>
        <div className="w-[1000px] max-w-full">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
  render: () => <Caller initialSearch={{ step: 'map' }} />,
}

/**
 * The stored file was never pinned to a Dataset: the flow says so and offers
 * the restart, rather than reading columns against nothing.
 */
export const NoTarget: Story = {
  decorators: [
    (Story) => (
      <QueryClientProvider client={untargetedClient()}>
        <div className="w-[1000px] max-w-full">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
  render: () => <Caller initialSearch={{ step: 'map' }} />,
}
