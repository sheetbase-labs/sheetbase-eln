/**
 * R5-SURF-01 — the dataset Used by tab. External dependents from
 * `discover_object_dependencies` appear; the dataset's own snapshots do not.
 * Empty, denied and failure are distinct states.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DataClientError } from '#/lib/data-client'
import { DatasetUsedByTab } from './dataset-used-by-tab'

const dataClient = vi.hoisted(() => ({ rpc: vi.fn(), list: vi.fn() }))

vi.mock('#/lib/notebook-data', async (importOriginal) => ({
  ...(await importOriginal()),
  notebookDataClient: dataClient,
}))

function renderTab() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <DatasetUsedByTab datasetId="ds-1" />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('DatasetUsedByTab', () => {
  it('lists external dependents and hides the dataset’s own snapshots', async () => {
    dataClient.rpc.mockResolvedValue({
      kind: 'dataset',
      id: 'ds-1',
      dependencies: [
        {
          kind: 'sheet_instance',
          id: 'sheet-1',
          relation: 'resolved_dataset_binding',
          liveness: 'active',
          effect: 'blocks_deletion',
          label: 'Ambr analysis sheet',
        },
        {
          kind: 'dataset_version',
          id: 'version-1',
          relation: 'snapshot_of_dataset',
          liveness: 'historical',
          effect: 'blocks_deletion',
          label: 'S-14',
        },
      ],
    })
    renderTab()

    expect(await screen.findByText('Ambr analysis sheet')).toBeTruthy()
    expect(screen.getByText('Binds this dataset')).toBeTruthy()
    expect(screen.queryByText('S-14')).toBeNull()
    expect(dataClient.rpc).toHaveBeenCalledWith(
      'discover_object_dependencies',
      {
        p_kind: 'dataset',
        p_object_id: 'ds-1',
      },
    )
  })

  it('shows an honest empty state when nothing references the dataset', async () => {
    dataClient.rpc.mockResolvedValue({
      kind: 'dataset',
      id: 'ds-1',
      dependencies: [],
    })
    renderTab()

    expect(
      await screen.findByText('Nothing references this dataset yet'),
    ).toBeTruthy()
  })

  it('shows a denied state rather than an empty list', async () => {
    dataClient.rpc.mockRejectedValue(
      new DataClientError('permission_denied', 'denied', 403),
    )
    renderTab()

    expect(
      await screen.findByText('References are not available to you'),
    ).toBeTruthy()
  })
})
