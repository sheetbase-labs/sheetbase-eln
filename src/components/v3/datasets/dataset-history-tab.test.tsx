/**
 * R5-SURF-01 — the dataset History tab. A real change_events page renders
 * through the shared timeline; no changes, denied and failure are distinct.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DataClientError } from '#/lib/data-client'
import { DatasetHistoryTab } from './dataset-history-tab'

const dataClient = vi.hoisted(() => ({ rpc: vi.fn(), list: vi.fn() }))

vi.mock('#/lib/notebook-data', async (importOriginal) => ({
  ...(await importOriginal()),
  notebookDataClient: dataClient,
}))

const page = {
  formatVersion: 1 as const,
  events: [
    {
      sequence: 7,
      id: 'event-1',
      createdAt: '2026-09-25T10:11:00.000000Z',
      entityType: 'dataset',
      entityUuid: 'ds-1',
      operation: 'update',
      recordId: null,
      projectId: null,
      actorUserId: 'user-1',
      actorName: 'Priya Raman',
      actorCredentialId: null,
      clientId: null,
      payload: { changes: { name: { from: 'Old name', to: 'New name' } } },
    },
  ],
  hasMore: false,
  nextCursor: null,
}

function renderTab() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <DatasetHistoryTab datasetId="ds-1" />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('DatasetHistoryTab', () => {
  it('renders the dataset’s change_events page through the timeline', async () => {
    dataClient.rpc.mockResolvedValue(page)
    renderTab()

    expect(await screen.findByText('Priya Raman')).toBeTruthy()
    expect(screen.getByText('Old name')).toBeTruthy()
    expect(screen.getByText('New name')).toBeTruthy()
    expect(dataClient.rpc).toHaveBeenCalledWith(
      'audit_events',
      expect.objectContaining({ p_object: 'ds-1', p_limit: 50 }),
    )
  })

  it('shows an honest empty state when the dataset has no changes', async () => {
    dataClient.rpc.mockResolvedValue({ ...page, events: [] })
    renderTab()

    expect(
      await screen.findByText('No recorded activity for this object yet.'),
    ).toBeTruthy()
  })

  it('shows a denied state rather than an empty list', async () => {
    dataClient.rpc.mockRejectedValue(
      new DataClientError('permission_denied', 'denied', 403),
    )
    renderTab()

    expect(
      await screen.findByText('History is not available for this dataset.'),
    ).toBeTruthy()
  })
})
