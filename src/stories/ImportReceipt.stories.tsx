import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { ImportReceipt } from '#/components/import/import-receipt'

import { screenRoutes } from './screen-stories'

/**
 * A committed import as a read-only receipt: what was imported, with which
 * parser and mapping, into which snapshot. The one thing it offers is a
 * corrected file, which a story never uploads.
 */
const receipt = {
  id: '0198d970-e266-4000-8000-0000000000e1',
  dataset_id: 'dataset-1',
  experiment_record_id: null,
  instrument_id: null,
  mapping: {
    sheetName: 'Plate 1',
    sources: [
      { source: 'Well', fieldId: 'field-1', unit: null },
      { source: 'OD600', fieldId: 'field-2', unit: 'AU', sourceUnit: 'AU' },
      { source: 'Notes', fieldId: null, unit: null },
    ],
  },
  parser_id: 'parser-1',
  parser_version_id: 'parser-version-1',
  file_id: 'file-1',
  connector_run_id: null,
  imported_row_ids: Array.from({ length: 96 }, (_, i) => `row-${i}`),
  parser_provenance: {
    key: 'plate-reader-csv',
    name: 'Plate reader CSV',
    version: 2,
  },
  source_provenance: {
    filename: 'plate-reader-run-14.csv',
    checksum: 'a3f5c2d1',
  },
  outcome: { added: 94, flagged: 2, skipped: 0 },
  snapshot_version_id: 'snapshot-1',
  status: 'committed',
  error_detail: null,
  created_at: '2026-10-21T09:30:00Z',
}

const meta = {
  title: 'Import/Import receipt',
  component: ImportReceipt,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    tanstack: {
      router: {
        route: screenRoutes('/import/$importId', [
          '/datasets',
          '/datasets/$datasetId',
          '/datasets/$datasetId/rows',
        ]),
        path: '/import/file-1',
        params: { importId: 'file-1' },
      },
    },
  },
  args: { importId: 'file-1', receipt },
} satisfies Meta<typeof ImportReceipt>

export default meta

type Story = StoryObj<typeof meta>

/** A committed import with its mapping and outcome. */
export const Committed: Story = {}

/** An import with no mapping recorded: it says it was mapped by hand. */
export const NoRecordedMapping: Story = {
  args: {
    receipt: {
      ...receipt,
      mapping: null,
      parser_id: null,
      parser_provenance: {},
      outcome: {},
      source_provenance: {},
    },
  },
}
