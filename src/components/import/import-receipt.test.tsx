import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { DatasetImportRecord } from '#/lib/import/types'
import { ImportReceipt } from './import-receipt'

const receipt: DatasetImportRecord = {
  id: 'receipt-7',
  dataset_id: 'dataset-3',
  experiment_record_id: null,
  instrument_id: 'instrument-9',
  mapping: {
    sheetName: 'Mapped plate',
    sources: [
      {
        source: 'Reading',
        fieldId: 'field-13',
        unit: 'NTU',
        sourceUnit: 'NTU',
      },
      { source: 'Omitted', fieldId: null, unit: null },
    ],
  },
  parser_id: 'parser-5',
  parser_version_id: 'parser-version-2',
  file_id: 'file-11',
  connector_run_id: null,
  imported_row_ids: ['canonical-row-a', 'canonical-row-b', 'canonical-row-c'],
  parser_provenance: {
    name: 'Frozen reader',
    key: 'frozen-reader',
    version: 2,
  },
  source_provenance: { filename: 'retained.csv', checksum: 'receipt-checksum' },
  outcome: { added: 3 },
  snapshot_version_id: 'immutable-snapshot-17',
  status: 'committed',
  error_detail: null,
  created_at: '2026-10-21T09:30:00Z',
}

afterEach(cleanup)

async function renderReceipt(value: DatasetImportRecord) {
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => <ImportReceipt importId="file-11" receipt={value} />,
    }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  await router.load()
  render(<RouterProvider router={router} />)
}

describe('frozen import receipt presentation', () => {
  it('retains native nonfinite numbers, recorded labels and immutable destinations', async () => {
    await renderReceipt({
      ...receipt,
      parser_provenance: { ...receipt.parser_provenance, version: Infinity },
      source_provenance: {
        ...receipt.source_provenance,
        sheetName: 'Raw plate',
      },
      outcome: {
        added: NaN,
        skipped: -Infinity,
        flagged: Infinity,
        custom: -7,
        ignored: '19',
        nested: { added: 99 },
      },
    })

    expect(await screen.findByText('Frozen reader vInfinity')).toBeTruthy()
    expect(
      screen.getByText(
        'nan added · -infinity skipped · infinity flagged · -7 custom',
      ),
    ).toBeTruthy()
    expect(screen.getByText('Raw plate')).toBeTruthy()
    expect(screen.getByText('receipt-checksum')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'retained.csv' })).toBeTruthy()
    expect(screen.getByText('field-13')).toBeTruthy()
    expect(screen.queryByText('Omitted')).toBeNull()
    expect(
      screen
        .getByRole('link', { name: 'Open the dataset' })
        .getAttribute('href'),
    ).toBe('/datasets/dataset-3?view=imports')
    expect(
      screen.getByRole('link', { name: 'immutabl' }).getAttribute('href'),
    ).toBe('/datasets/dataset-3/rows?snapshot=immutable-snapshot-17')
  })

  it('uses historical fallbacks without accepting numeric strings or rewriting mapping', async () => {
    await renderReceipt({
      ...receipt,
      parser_provenance: { name: false, version: '2' },
      source_provenance: { filename: '', sheetName: null, checksum: 42 },
      outcome: { added: '13', planned: null, nested: {} },
      snapshot_version_id: null,
    })

    expect(await screen.findByText('Mapped by hand')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Imported file' })).toBeTruthy()
    expect(screen.getByText('Mapped plate')).toBeTruthy()
    expect(screen.getByText('Not recorded')).toBeTruthy()
    expect(screen.getByText('3 imported')).toBeTruthy()
    expect(screen.getByText('field-13')).toBeTruthy()
    expect(screen.queryByText('Snapshot')).toBeNull()
  })
})
