import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import {
  DatasetImportBlockEditor,
  DatasetImportBlockPreview,
} from '#/components/notebook/dataset-import-block'
import { importQueryKeys } from '#/lib/import/data'
import { notebookQueryKeys } from '#/lib/notebook-data'

import { holdRead, screenQueryClient, screenRoutes } from './screen-stories'

/**
 * A dataset-import block in the notebook. The preview reads the import receipt
 * the block pins; the editor needs a signed-in workspace, which a story has no
 * session for, so it renders the state a notebook shows before that context has
 * loaded, and its read-only form (the pinned receipt).
 */
const DATASET_ID = '0198d970-e266-4000-8000-0000000000d1'
const IMPORT_ID = '0198d970-e266-4000-8000-0000000000e1'
const VERSION_ID = '0198d970-e266-4000-8000-0000000000f1'
const FILE_ID = '0198d970-e266-4000-8000-0000000000c1'

const pinned = {
  fileId: FILE_ID,
  datasetId: DATASET_ID,
  importId: IMPORT_ID,
  datasetVersionId: VERSION_ID,
}

const receipt = {
  id: IMPORT_ID,
  dataset_id: DATASET_ID,
  experiment_record_id: null,
  parser_id: null,
  parser_version_id: null,
  file_id: FILE_ID,
  connector_run_id: null,
  imported_row_ids: Array.from({ length: 96 }, (_, i) => `row-${i}`),
  parser_provenance: {},
  source_provenance: {
    filename: 'plate-reader-run-14.csv',
    checksum: 'a3f5c2',
  },
  outcome: {},
  snapshot_version_id: VERSION_ID,
  status: 'committed',
  error_detail: null,
  created_at: '2026-10-21T09:30:00Z',
}

const withReceipt = screenQueryClient({
  data: [{ key: importQueryKeys.imports(DATASET_ID), value: [receipt] }],
})

holdRead(withReceipt, notebookQueryKeys.record('record-1'))

const missingReceipt = screenQueryClient({
  data: [{ key: importQueryKeys.imports(DATASET_ID), value: [] }],
})

const loading = screenQueryClient()

holdRead(loading, importQueryKeys.imports(DATASET_ID))

holdRead(loading, notebookQueryKeys.record('record-1'))

const meta = {
  title: 'Notebook/Dataset import block',
  component: DatasetImportBlockPreview,
  tags: ['autodocs'],
  args: { payload: pinned, recordId: 'record-1' },
  parameters: {
    tanstack: {
      router: {
        route: screenRoutes('/records/$recordId/notebook', [
          '/sheets/new',
          '/datasets/$datasetId/rows',
          '/analysis/new',
          '/import/$importId',
        ]),
        path: '/records/record-1/notebook',
        params: { recordId: 'record-1' },
      },
    },
  },
  decorators: [
    (Story, context) => (
      <QueryClientProvider
        client={
          // SAFETY: this file sets `parameters.client` on every story, and the harness types it as the `screenQueryClient` result it is built from; Storybook passes parameters through unchanged.
          context.parameters.client as ReturnType<typeof screenQueryClient>
        }
      >
        <div className="w-[640px] max-w-full rounded-md border">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
} satisfies Meta<typeof DatasetImportBlockPreview>

export default meta

type Story = StoryObj<typeof meta>

/** The committed receipt the block pins, with the ways to use the data. */
export const Pinned: Story = { parameters: { client: withReceipt } }

/** A block with no import yet: it says what to do. */
export const NotImported: Story = {
  parameters: { client: loading },
  args: { payload: {} },
}

/** A file was uploaded but the import has not been committed. */
export const FileRetained: Story = {
  parameters: { client: loading },
  args: { payload: { fileId: FILE_ID } },
}

/** The receipt is still loading. */
export const Loading: Story = { parameters: { client: loading } }

/** The pinned receipt cannot be found, which the block says plainly. */
export const ReceiptUnavailable: Story = {
  parameters: { client: missingReceipt },
}

/** The editor of a block read-only: the same pinned receipt. */
export const EditorReadOnly: Story = {
  parameters: { client: withReceipt },
  render: () => (
    <DatasetImportBlockEditor
      block={{
        id: 'block-1',
        recordId: 'record-1',
        type: 'dataset_import',
        payload: pinned,
        payloadSchemaVersion: 1,
        order: 1,
        version: 1,
      }}
      save={async () => ({ ok: true })}
      readOnly
    />
  ),
}

/** The editor before the notebook's record and workspace have loaded. */
export const EditorLoading: Story = {
  parameters: { client: loading },
  render: () => (
    <DatasetImportBlockEditor
      block={{
        id: 'block-1',
        recordId: 'record-1',
        type: 'dataset_import',
        payload: {},
        payloadSchemaVersion: 1,
        order: 1,
        version: 1,
      }}
      save={async () => ({ ok: true })}
    />
  ),
}
