import { QueryClient } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DatasetLandingLink, invalidateDatasetLanding } from './dataset-landing'

afterEach(cleanup)

describe('connector ingest landing', () => {
  it('links to the Dataset imports tab', async () => {
    const router = createRouter({
      routeTree: createRootRoute({
        component: () => <DatasetLandingLink datasetId="ds-1" />,
      }),
      history: createMemoryHistory({ initialEntries: ['/'] }),
    })

    render(<RouterProvider router={router} />)

    expect(
      (
        await screen.findByRole('link', { name: /Open the dataset/ })
      ).getAttribute('href'),
    ).toBe('/datasets/ds-1?view=imports')
  })

  it('refreshes the dataset list and its import receipts', () => {
    const client = new QueryClient()
    const spy = vi.spyOn(client, 'invalidateQueries')
    invalidateDatasetLanding(client, 'ds-1')
    const keys = spy.mock.calls.map((call) => call[0]?.queryKey)
    expect(keys).toContainEqual(['import', 'records', 'ds-1'])
    expect(keys).toContainEqual(['ui-port', 'datasets', 'page'])
  })
})
