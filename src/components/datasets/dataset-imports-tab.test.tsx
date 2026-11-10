import { QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { DatasetImportRecord } from '#/lib/import/types'
import { DatasetImportsTab } from './dataset-imports-tab'
import { datasetTabTestServer } from './dataset-tab-test-server'

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

async function renderTab(...replies: Parameters<typeof datasetTabTestServer>) {
  const context = await datasetTabTestServer(...replies)

  const root = createRootRoute({
    component: () => (
      <DatasetImportsTab datasetId="ds-1" client={context.client} />
    ),
  })

  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  render(
    <QueryClientProvider client={context.queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )

  return context
}

describe('DatasetImportsTab', () => {
  it('lists a committed import receipt from the canonical read model', async () => {
    const { requests } = await renderTab({ body: JSON.stringify([committed]) })
    expect(await screen.findByText('readings.csv')).toBeTruthy()
    expect(screen.getByText('Ambr parser v3')).toBeTruthy()
    expect(screen.getByText('Committed')).toBeTruthy()
    expect(screen.getByText('2')).toBeTruthy()
    expect(requests).toEqual([
      {
        path: '/api/db/rpc/dataset_import_list',
        body: JSON.stringify({ p_dataset_id: 'ds-1' }),
      },
    ])
  })

  it('opens a failed import at its retained file so it can be retried', async () => {
    await renderTab({
      body: JSON.stringify([
        {
          ...committed,
          status: 'failed',
          file_id: 'file-9',
          outcome: {},
          experiment_record_id: 'experiment-9',
          parser_provenance: {
            ...committed.parser_provenance,
            key: 'retained-parser',
          },
        },
      ]),
    })
    const link = await screen.findByRole('link', { name: 'readings.csv' })

    const destination = new URL(
      link.getAttribute('href') ?? '',
      'http://localhost',
    )

    expect(destination.pathname).toBe('/import/file-9')
    expect(destination.searchParams.get('step')).toBe('map')
    expect(destination.searchParams.get('dataset')).toBe('ds-1')
    expect(destination.searchParams.get('experiment')).toBe('experiment-9')
    expect(destination.searchParams.get('parser')).toBe('retained-parser')
  })

  it('shows an honest empty state when nothing has been imported', async () => {
    await renderTab({ body: '[]' })
    expect(await screen.findByText('No imports yet')).toBeTruthy()
    expect(
      screen
        .getByRole('button', { name: 'Import a file' })
        .getAttribute('href'),
    ).toContain('dataset=ds-1')
  })

  it('shows a denied state rather than an empty list', async () => {
    await renderTab({
      status: 403,
      body: JSON.stringify({
        error: { code: 'permission_denied', message: 'denied' },
      }),
    })
    expect(
      await screen.findByText('Imports aren’t available to you'),
    ).toBeTruthy()
    expect(screen.queryByText('No imports yet')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it('keeps loading distinct from empty, then renders receipts', async () => {
    let release: () => void = () => undefined

    const ready = new Promise<void>((resolve) => {
      release = resolve
    })

    await renderTab({ body: JSON.stringify([committed]), ready })
    expect(await screen.findByText('Loading imports…')).toBeTruthy()
    expect(screen.queryByText('No imports yet')).toBeNull()
    release()
    expect(await screen.findByText('readings.csv')).toBeTruthy()
  })

  it('offers retry for a server error instead of claiming no imports', async () => {
    await renderTab({
      status: 500,
      body: JSON.stringify({
        error: { code: 'upstream_error', message: 'failed' },
      }),
    })
    expect(
      await screen.findByRole('button', { name: 'Try again' }),
    ).toBeTruthy()
    expect(screen.queryByText('No imports yet')).toBeNull()
    expect(screen.queryByText('Imports aren’t available to you')).toBeNull()
  })
})
