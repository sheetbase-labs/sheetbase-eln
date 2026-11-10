import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { SourceComparison } from './source-comparison'
import type { CanonicalDatasetSource } from '#/lib/chart-data'
import { choose } from '../../../tests/unit/picker'
import { sourceHttpFixture } from './source-http-fixture'
import type { ChartRow } from '#/lib/chart-spec'

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
})

function renderComparison(
  rows: ChartRow[] = [],
  snapshotRows: ChartRow[] = rows,
) {
  const fixture = sourceHttpFixture({ sources: SOURCES, rows, snapshotRows })

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  render(
    <QueryClientProvider client={client}>
      <SourceComparison
        client={fixture.client}
        sourceA={SOURCES[0]}
        rowsA={[
          { __sheetbaseRowId: 'r1', sample: 'S1', titre: 10 },
          { __sheetbaseRowId: 'r2', sample: 'S2', titre: 20 },
        ]}
        snapshotA={null}
        sources={SOURCES}
      />
    </QueryClientProvider>,
  )

  return fixture.requests
}

describe('SourceComparison', () => {
  it('compares a snapshot of the same dataset by row key and reports the change', async () => {
    renderComparison([
      { __sheetbaseRowId: 'r1', sample: 'S1', titre: 10 },
      { __sheetbaseRowId: 'r2', sample: 'S2', titre: 26 },
    ])
    await screen.findByRole('option', { name: /Snapshot v1/ })
    await userEvent
      .setup()
      .selectOptions(screen.getByLabelText('B rows'), 'ver-1')
    await screen.findByText('B · ELISA run 1 (snapshot)')

    const paired = await screen.findByRole('table', { name: 'Paired rows' })
    expect(within(paired).getAllByText('both')).toHaveLength(2)
    expect(
      screen.getByText(/2 matched · 0 only in A · 0 only in B · 1 differ/),
    ).toBeTruthy()
    expect(screen.getByText('Difference in means (B − A)')).toBeTruthy()
  })

  it('matches across datasets by an explicit field, never by row key', async () => {
    const user = userEvent.setup()

    const requests = renderComparison([
      { __sheetbaseRowId: 'x9', sample: 'S2', titre: 22 },
      { __sheetbaseRowId: 'x8', sample: 'S3', titre: 5 },
    ])

    await screen.findByRole('table', { name: 'Paired rows' })

    await choose(user, /^B dataset/, 'ELISA run 2')

    expect(
      await screen.findByText(/1 matched · 1 only in A · 1 only in B/),
    ).toBeTruthy()

    const options = within(screen.getByLabelText('Match rows by'))
      .getAllByRole('option')
      .map((option) => option.textContent)

    expect(options).not.toContain('Dataset row key')
    expect(
      requests
        .filter((request) => request.path === '/api/db/rpc/query_dataset_rows')
        .at(-1),
    ).toEqual({
      path: '/api/db/rpc/query_dataset_rows',
      datasetId: 'ds-b',
      versionId: undefined,
    })
  })

  it('reads a chosen snapshot as side B', async () => {
    const user = userEvent.setup()

    const requests = renderComparison(
      [{ __sheetbaseRowId: 'r1', sample: 'S1', titre: 10 }],
      [{ __sheetbaseRowId: 'r1', sample: 'S1', titre: 30 }],
    )

    await screen.findByRole('option', { name: /Snapshot v1/ })

    await user.selectOptions(screen.getByLabelText('B rows'), 'ver-1')

    await screen.findByText('B · ELISA run 1 (snapshot)')
    expect(
      requests
        .filter(
          (request) =>
            request.path === '/api/db/rpc/query_dataset_version_rows',
        )
        .at(-1),
    ).toEqual({
      path: '/api/db/rpc/query_dataset_version_rows',
      datasetId: undefined,
      versionId: 'ver-1',
    })
    expect(
      requests
        .filter((request) => request.path === '/api/db/dataset_versions')
        .at(-1),
    ).toEqual({
      path: '/api/db/dataset_versions',
      datasetId: 'ds-a',
      versionId: 'ver-1',
    })
    const paired = screen.getByRole('table', { name: 'Paired rows' })
    expect(within(paired).getByText('30')).toBeTruthy()
    await user.selectOptions(screen.getByLabelText('B rows'), '')
    await screen.findByText('B · ELISA run 1')
    expect(within(paired).queryByText('30')).toBeNull()
    expect(requests).toContainEqual({
      path: '/api/db/rpc/query_dataset_rows',
      datasetId: 'ds-a',
      versionId: undefined,
    })
  })
})
