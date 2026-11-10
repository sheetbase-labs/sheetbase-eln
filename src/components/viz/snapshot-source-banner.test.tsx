import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SnapshotSourceBanner } from './snapshot-source-banner'
import { sourceHttpFixture, versionSummary } from './source-http-fixture'

afterEach(cleanup)

function renderBanner(onUseLive = vi.fn()) {
  const fixture = sourceHttpFixture({
    versions: [
      versionSummary({
        label: 'v3 · before the re-read',
        rowCount: 96,
        createdAt: '2026-10-02T09:00:00Z',
      }),
    ],
  })

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  render(
    <QueryClientProvider client={client}>
      <SnapshotSourceBanner
        client={fixture.client}
        datasetId="ds-1"
        datasetVersionId="ver-1"
        onUseLive={onUseLive}
      />
    </QueryClientProvider>,
  )

  return onUseLive
}

describe('SnapshotSourceBanner', () => {
  it('names the snapshot and says its rows are fixed', async () => {
    renderBanner()
    expect(await screen.findByText('v3 · before the re-read')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('96 rows')
    expect(screen.getByRole('status').textContent).toContain('2 Oct 2026')
    expect(screen.getByRole('status').textContent).toContain(
      'don’t change when the dataset does',
    )
  })

  it('offers the way back to live data', async () => {
    const onUseLive = renderBanner()
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Use live data' }))
    expect(onUseLive).toHaveBeenCalledOnce()
  })
})
