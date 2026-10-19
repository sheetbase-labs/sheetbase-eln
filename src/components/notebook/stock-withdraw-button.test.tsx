import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DataClient } from '#/lib/data-client'

import { StockWithdrawButton } from './stock-withdraw-button'

const toast = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}))
vi.mock('#/components/v3/ui/sonner', () => toast)

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const item = {
  kind: 'material' as const,
  materialRecordId: 'lot-1',
  identifier: 'RGT-1',
  quantity: 5,
  unit: { symbol: 'mL' },
}

function mount(client: DataClient, note?: string, onWithdrawn = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <StockWithdrawButton
        item={item}
        experimentId="exp-1"
        note={note}
        onWithdrawn={onWithdrawn}
        client={client}
      />
    </QueryClientProvider>,
  )
  return onWithdrawn
}

describe('StockWithdrawButton', () => {
  it('withdraws, tells the block, and confirms', async () => {
    const rpc = vi.fn(async () => ({}))
    const list = vi.fn(async (_t: string, q: string) =>
      q.includes('select=identifier')
        ? [{ identifier: 'EXP-1' }]
        : [
            {
              id: 'lot-1',
              identifier: 'RGT-1',
              kind: 'material',
              title: 'Buffer',
              status: 'available',
              tags: [],
              metadata_version: 2,
              properties: { quantity: 10, unit: 'mL' },
              custom_fields: {},
            },
          ],
    )
    const onWithdrawn = mount({ rpc, list } as unknown as DataClient)
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw from stock' }))
    await vi.waitFor(() => expect(onWithdrawn).toHaveBeenCalled())
    expect(onWithdrawn.mock.calls[0][0]).toMatch(/^Withdrawn from stock/)
    expect(rpc).toHaveBeenCalledWith(
      'record_reagent_movement',
      expect.objectContaining({ p_operation: 'consume', p_quantity_delta: 5 }),
    )
  })

  it('shows the refusal instead of failing silently', async () => {
    const list = vi.fn(async () => [])
    mount({ rpc: vi.fn(), list } as unknown as DataClient)
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw from stock' }))
    await vi.waitFor(() =>
      expect(toast.toast.error).toHaveBeenCalledWith(
        'RGT-1 could not be read.',
      ),
    )
  })

  it('shows the marker, not a second button, once withdrawn', () => {
    mount({} as DataClient, 'Withdrawn from stock 2026-10-19')
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('Withdrawn from stock 2026-10-19')).toBeTruthy()
  })
})
