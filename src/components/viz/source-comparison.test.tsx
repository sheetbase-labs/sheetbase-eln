import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SourceComparison } from './source-comparison'
import type { CanonicalDatasetSource } from '#/lib/chart-data'

const resolve = vi.hoisted(() => vi.fn())

vi.mock('#/lib/chart-data', () => ({
  sciDataClient: {},
  resolveDatasetRef: resolve,
}))
vi.mock('#/lib/dataset-explorer-data', () => ({
  listDatasetVersionSummaries: async (_client: unknown, datasetId: string) =>
    datasetId === 'ds-a'
      ? [
          {
            id: 'ver-1',
            label: 'v1',
            createdAt: '2026-10-01T00:00:00Z',
            rowsRemovedAt: null,
          },
        ]
      : [],
}))

const source = (id: string, name: string): CanonicalDatasetSource => ({
  datasetId: id,
  name,
  workspaceId: 'ws',
  schemaVersionId: 'sv',
  schemaVersionNumber: 1,
  revision: 1,
  columns: [
    { id: 'sample', label: 'Sample', logicalType: 'text' },
    { id: 'titre', label: 'Titre', logicalType: 'decimal' },
  ],
})

const SOURCES = [source('ds-a', 'ELISA run 1'), source('ds-b', 'ELISA run 2')]

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderComparison() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <SourceComparison
        sourceA={SOURCES[0]!}
        rowsA={[
          { __sheetbaseRowId: 'r1', sample: 'S1', titre: 10 },
          { __sheetbaseRowId: 'r2', sample: 'S2', titre: 20 },
        ]}
        snapshotA={null}
        sources={SOURCES}
      />
    </QueryClientProvider>,
  )
}

describe('SourceComparison', () => {
  it('compares a snapshot of the same dataset by row key and reports the change', async () => {
    resolve.mockResolvedValue({
      source: SOURCES[0],
      truncated: false,
      totalCount: 2,
      flags: [],
      rows: [
        { __sheetbaseRowId: 'r1', sample: 'S1', titre: 10 },
        { __sheetbaseRowId: 'r2', sample: 'S2', titre: 26 },
      ],
    })
    renderComparison()

    const paired = await screen.findByRole('table', { name: 'Paired rows' })
    expect(within(paired).getAllByText('both')).toHaveLength(2)
    expect(
      screen.getByText(/2 matched · 0 only in A · 0 only in B · 1 differ/),
    ).toBeTruthy()
    expect(screen.getByText('Difference in means (B − A)')).toBeTruthy()
  })

  it('matches across datasets by an explicit field, never by row key', async () => {
    const user = userEvent.setup()
    resolve.mockResolvedValue({
      source: SOURCES[1],
      truncated: false,
      totalCount: 2,
      flags: [],
      rows: [
        { __sheetbaseRowId: 'x9', sample: 'S2', titre: 22 },
        { __sheetbaseRowId: 'x8', sample: 'S3', titre: 5 },
      ],
    })
    renderComparison()
    await screen.findByRole('table', { name: 'Paired rows' })

    await user.selectOptions(screen.getByLabelText('B dataset'), 'ds-b')

    expect(
      await screen.findByText(/1 matched · 1 only in A · 1 only in B/),
    ).toBeTruthy()
    const options = within(screen.getByLabelText('Match rows by'))
      .getAllByRole('option')
      .map((option) => option.textContent)
    expect(options).not.toContain('Dataset row key')
    expect(resolve).toHaveBeenLastCalledWith(expect.anything(), {
      datasetId: 'ds-b',
    })
  })

  it('reads a chosen snapshot as side B', async () => {
    const user = userEvent.setup()
    resolve.mockResolvedValue({
      source: SOURCES[0],
      truncated: false,
      totalCount: 0,
      flags: [],
      rows: [],
    })
    renderComparison()
    await screen.findByRole('option', { name: /Snapshot v1/ })

    await user.selectOptions(screen.getByLabelText('B rows'), 'ver-1')

    expect(resolve).toHaveBeenLastCalledWith(expect.anything(), {
      datasetId: 'ds-a',
      datasetVersionId: 'ver-1',
    })
  })
})
