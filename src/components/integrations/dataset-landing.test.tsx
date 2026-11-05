import { QueryClient } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DatasetLandingLink, invalidateDatasetLanding } from './dataset-landing'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    search,
    children,
  }: {
    to: string
    params: Record<string, string>
    search: Record<string, string>
    children: React.ReactNode
  }) => (
    <a
      href={`${to.replace('$datasetId', params.datasetId)}?view=${search.view}`}
    >
      {children}
    </a>
  ),
}))

afterEach(cleanup)

describe('connector ingest landing', () => {
  it('links to the Dataset imports tab', () => {
    render(<DatasetLandingLink datasetId="ds-1" />)
    expect(
      screen
        .getByRole('link', { name: /Open the dataset/ })
        .getAttribute('href'),
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
