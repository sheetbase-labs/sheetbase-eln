/**
 * J-INS-13 — an enterprise connector's bucket/host settings can be edited.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConnectorConfigCard } from './config-card'
import type { ConnectorWire } from '#/lib/connectors/types'

const update = vi.hoisted(() =>
  vi.fn(async (_client: unknown, _input: unknown) => ({})),
)

vi.mock('#/lib/connectors/client', () => ({
  connectorQueryKeys: { connector: (id: string) => ['connector', id] },
  describeConnectorsError: (error: unknown) =>
    error instanceof Error ? error.message : 'Unknown error',
  updateConnector: update,
}))
vi.mock('#/lib/data-client', () => ({ createDataClient: () => ({}) }))

const CONNECTOR = {
  id: 'c1',
  name: 'Lab bucket',
  config: { adapter: 's3' },
} as unknown as ConnectorWire

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
    expect(screen.getByText('Not configured yet.')).toBeTruthy()
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
      screen.getByText(/Ask a workspace owner, admin or steward/),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Save settings' })).toBeNull()
  })
})
