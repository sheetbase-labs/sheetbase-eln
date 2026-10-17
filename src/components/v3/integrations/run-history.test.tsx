/**
 * INT-01 — the run history's detail row is a disclosure.
 *
 * It used to be a quiet `Show`/`Hide` button with no `aria-expanded` at all, so
 * the only signal of what the control would do was its own label; the detail row
 * was rendered by a hand-rolled ternary. It is now a Collapsible, and each run
 * is its own row group so the trigger row and its detail row can be siblings.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RunHistory } from './run-history'
import type { ConnectorRunWire } from '#/lib/connectors/types'

const runs = vi.hoisted(() => ({ current: [] as unknown[] }))

vi.mock('#/lib/connectors/client', () => ({
  connectorQueryKeys: {
    runs: (id: string) => ['connector-runs', id],
    runLogs: (id: string) => ['connector-run-logs', id],
  },
  describeConnectorsError: (error: unknown) =>
    error instanceof Error ? error.message : 'Unknown error',
  listConnectorRuns: async () => runs.current,
  listRunLogs: async () => [],
}))

vi.mock('#/lib/data-client', () => ({
  createDataClient: () => ({}),
}))

const RUN: ConnectorRunWire = {
  id: 'run-1',
  workspace_id: 'ws-1',
  connector_id: 'conn-1',
  started_at: '2026-10-16T09:12:00.000Z',
  finished_at: '2026-10-16T09:12:04.000Z',
  trigger_kind: 'manual',
  status: 'succeeded',
  attempt: 1,
  retry_of_run_id: null,
  request_digest: 'abcdef0123456789',
  error_code: null,
  error_message: null,
  result: { kind: 'csv', rowCount: 3142 },
}

function renderHistory() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <RunHistory connectorId="conn-1" />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  runs.current = []
})

describe('RunHistory detail rows', () => {
  it('states the disclosure on the control and renders the payload only when open', async () => {
    const user = userEvent.setup()
    runs.current = [RUN]
    renderHistory()

    const trigger = await screen.findByRole('button', { name: 'Show' })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText(/3142 rows/)).toBeNull()

    await user.click(trigger)

    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: 'Hide' })
          .getAttribute('aria-expanded'),
      ).toBe('true'),
    )
    expect(screen.getByText(/3142 rows/)).toBeTruthy()
    // The detail row is a row of the same table, in its own row group.
    const detail = screen.getByText(/3142 rows/).closest('tr')
    expect(detail?.parentElement?.tagName).toBe('TBODY')
  })

  it('keeps one detail row open at a time', async () => {
    const user = userEvent.setup()
    runs.current = [RUN, { ...RUN, id: 'run-2' }]
    renderHistory()

    const triggers = await screen.findAllByRole('button', { name: 'Show' })
    expect(triggers).toHaveLength(2)

    await user.click(triggers[0])
    await user.click(triggers[1])

    expect(screen.getAllByRole('button', { name: 'Show' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Hide' })).toHaveLength(1)
  })
})
