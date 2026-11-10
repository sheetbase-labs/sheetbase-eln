import { QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { DatasetUsedByTab } from './dataset-used-by-tab'
import { datasetTabTestServer } from './dataset-tab-test-server'

const discovery = {
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
}

async function renderTab(...replies: Parameters<typeof datasetTabTestServer>) {
  const context = await datasetTabTestServer(...replies)

  const root = createRootRoute({
    component: () => (
      <DatasetUsedByTab datasetId="ds-1" client={context.client} />
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

describe('DatasetUsedByTab', () => {
  it('lists external dependents and hides the dataset’s own snapshots', async () => {
    const { requests } = await renderTab({ body: JSON.stringify(discovery) })
    expect(await screen.findByText('Ambr analysis sheet')).toBeTruthy()
    expect(screen.getByText('Binds this dataset')).toBeTruthy()
    expect(screen.queryByText('S-14')).toBeNull()
    expect(requests).toEqual([
      {
        path: '/api/db/rpc/discover_object_dependencies',
        body: JSON.stringify({ p_kind: 'dataset', p_object_id: 'ds-1' }),
      },
    ])
    expect(
      screen.getByRole('link', { name: 'sheet-1' }).getAttribute('href'),
    ).toBe('/sheets/sheet-1')
  })

  it('shows an honest empty state when nothing references the dataset', async () => {
    await renderTab({
      body: JSON.stringify({ ...discovery, dependencies: [] }),
    })
    expect(
      await screen.findByText('Nothing references this dataset yet'),
    ).toBeTruthy()
  })

  it('keeps supported citation destinations and unknown relation labels', async () => {
    await renderTab({
      body: JSON.stringify({
        ...discovery,
        dependencies: [
          {
            kind: 'dataset',
            id: 'data-2',
            relation: 'future_relation',
            label: 'Other dataset',
          },
          {
            kind: 'record',
            id: 'record-2',
            relation: 'record_link',
            label: 'Record',
          },
          {
            kind: 'future_kind',
            id: 'unknown-2',
            relation: 'future_link',
            label: '',
          },
        ],
      }),
    })
    expect(await screen.findByText('Other dataset')).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'data-2' }).getAttribute('href'),
    ).toBe('/datasets/data-2')
    expect(
      screen.getByRole('link', { name: 'record-2' }).getAttribute('href'),
    ).toBe('/records/record-2')
    expect(screen.queryByRole('link', { name: 'unknown-' })).toBeNull()
    expect(screen.getByText('future relation')).toBeTruthy()
    expect(screen.getByText('future kind')).toBeTruthy()
  })

  it('shows a denied state rather than an empty list', async () => {
    await renderTab({
      status: 403,
      body: JSON.stringify({
        error: { code: 'permission_denied', message: 'denied' },
      }),
    })
    expect(
      await screen.findByText('References aren’t available to you'),
    ).toBeTruthy()
    expect(screen.queryByText('Nothing references this dataset yet')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it('keeps loading distinct from an empty dependency list', async () => {
    let release: () => void = () => undefined

    const ready = new Promise<void>((resolve) => {
      release = resolve
    })

    await renderTab({ body: JSON.stringify(discovery), ready })
    expect(await screen.findByText('Loading references…')).toBeTruthy()
    expect(screen.queryByText('Nothing references this dataset yet')).toBeNull()
    release()
    expect(await screen.findByText('Ambr analysis sheet')).toBeTruthy()
  })

  it('offers retry for a server error without claiming no dependents', async () => {
    await renderTab({
      status: 500,
      body: JSON.stringify({
        error: { code: 'upstream_error', message: 'failed' },
      }),
    })
    expect(
      await screen.findByRole('button', { name: 'Try again' }),
    ).toBeTruthy()
    expect(screen.queryByText('Nothing references this dataset yet')).toBeNull()
    expect(screen.queryByText('References aren’t available to you')).toBeNull()
  })
})
