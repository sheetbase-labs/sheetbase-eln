/**
 * R5-SURF-01 — the dataset Imports tab. A committed import receipt appears in
 * the table; no imports, denied and failure are distinct states.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DataClientError } from '#/lib/data-client'
import type { DatasetImportRecord } from '#/lib/import/types'
import { DatasetImportsTab } from './dataset-imports-tab'

const dataClient = vi.hoisted(() => ({ rpc: vi.fn(), list: vi.fn() }))

vi.mock('#/lib/notebook-data', async (importOriginal) => ({
  ...(await importOriginal()),
  notebookDataClient: dataClient,
}))

const committed: DatasetImportRecord = {
  id: 'imp-1',
  dataset_id: 'ds-1',
  experiment_record_id: null,
  parser_id: 'p-1',
  parser_version_id: 'pv-1',
  file_id: 'f-1',
  connector_run_id: null,
  imported_row_ids: ['r1', 'r2'],
  parser_provenance: { name: 'Ambr parser', version: 3 },
  source_provenance: { filename: 'readings.csv' },
  outcome: { added: 2 },
  snapshot_version_id: 'v-1',
  status: 'committed',
  error_detail: null,
  created_at: '2026-09-25T10:11:00.000Z',
}

function renderTab() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <DatasetImportsTab datasetId="ds-1" />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('DatasetImportsTab', () => {
  it('lists a committed import receipt from the canonical read model', async () => {
    dataClient.rpc.mockResolvedValue([committed])
    renderTab()

    expect(await screen.findByText('readings.csv')).toBeTruthy()
    expect(screen.getByText('Ambr parser v3')).toBeTruthy()
    expect(screen.getByText('Committed')).toBeTruthy()
    expect(screen.getByText('2')).toBeTruthy()
    expect(dataClient.rpc).toHaveBeenCalledWith('dataset_import_list', {
      p_dataset_id: 'ds-1',
    })
  })

  it('shows an honest empty state when nothing has been imported', async () => {
    dataClient.rpc.mockResolvedValue([])
    renderTab()

    expect(await screen.findByText('No imports yet')).toBeTruthy()
  })

  it('shows a denied state rather than an empty list', async () => {
    dataClient.rpc.mockRejectedValue(
      new DataClientError('permission_denied', 'denied', 403),
    )
    renderTab()

    expect(
      await screen.findByText('Imports are not available to you'),
    ).toBeTruthy()
    expect(screen.queryByText('No imports yet')).toBeNull()
  })
})
