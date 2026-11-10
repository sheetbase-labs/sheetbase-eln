/**
 * J-INS-13 — an enterprise connector's bucket/host settings can be edited.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConnectorConfigCard } from './config-card'
import type * as ConnectorClientModule from '#/lib/connectors/client'
import type { updateConnector } from '#/lib/connectors/client'
import type { ConnectorWire } from '#/lib/connectors/types'

const update = vi.hoisted(() =>
  vi.fn(
    async (
      _client: Parameters<typeof updateConnector>[0],
      _input: Parameters<typeof updateConnector>[1],
    ) => ({}),
  ),
)

// Only the RPC is replaced: the card saves through `updateConnector`, and the
// rest of the connector client is the real one.
// oxlint-disable-next-line anti-slop/no-module-mocking -- the card builds its own data client at import, so updateConnector is the only seam this unit test can stand in at; every other connector-client function stays real.
vi.mock('#/lib/connectors/client', async (importOriginal) => {
  const actual = await importOriginal<typeof ConnectorClientModule>()

  return { ...actual, updateConnector: update }
})

const CONNECTOR: ConnectorWire = {
  id: 'c1',
  workspace_id: 'ws',
  key: 'lab-bucket',
  name: 'Lab bucket',
  connector_type: 'storage',
  direction: 'inbound',
  status: 'active',
  parser_id: null,
  config: { adapter: 's3' },
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

function renderCard(canManage: boolean) {
  const client = new QueryClient()

  return render(
    <QueryClientProvider client={client}>
      <ConnectorConfigCard
        workspaceId="ws"
        connector={CONNECTOR}
        adapter="s3"
        canManage={canManage}
      />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  update.mockClear()
})

describe('ConnectorConfigCard', () => {
  it('saves the bucket through updateConnector, keeping the adapter key', async () => {
    const user = userEvent.setup()
    renderCard(true)
    expect(screen.getByText('Not configured yet')).toBeTruthy()
    await user.type(screen.getByLabelText(/Bucket/), 'lab-data')
    await user.click(screen.getByRole('button', { name: 'Save settings' }))
    await waitFor(() => expect(update).toHaveBeenCalled())
    expect(update.mock.calls[0]?.[1]).toMatchObject({
      workspaceId: 'ws',
      connectorId: 'c1',
      config: { adapter: 's3', bucket: 'lab-data', forcePathStyle: false },
    })
  })

  it('shows field errors and does not call the server for an empty bucket', async () => {
    const user = userEvent.setup()
    renderCard(true)
    await user.click(screen.getByRole('button', { name: 'Save settings' }))
    expect(await screen.findByText('Bucket is required.')).toBeTruthy()
    expect(update).not.toHaveBeenCalled()
  })

  it('tells a viewer who can set it instead of offering a form', () => {
    renderCard(false)
    expect(
      screen.getByText(/Ask a workspace owner, admin or data steward/),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Save settings' })).toBeNull()
  })
})
