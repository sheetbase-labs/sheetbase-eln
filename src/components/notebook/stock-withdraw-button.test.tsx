import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDataClient } from '#/lib/data-client'
import type { DataClient } from '#/lib/data-client'
import { toast, Toaster } from '#/components/ui/sonner'

import { StockWithdrawButton } from './stock-withdraw-button'

afterEach(() => {
  toast.dismiss()
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
  const queryClient = new QueryClient()
  render(
    <QueryClientProvider client={queryClient}>
      <StockWithdrawButton
        item={item}
        experimentId="exp-1"
        note={note}
        onWithdrawn={onWithdrawn}
        client={client}
      />
      <Toaster />
    </QueryClientProvider>,
  )

  return { onWithdrawn, queryClient }
}

describe('StockWithdrawButton', () => {
  it('withdraws, tells the block, and confirms', async () => {
    const transport = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(
        input instanceof Request ? input.url : input,
        'http://localhost',
      )

      if (url.pathname === '/api/db/rpc/record_reagent_movement')
        return Response.json({})

      if (url.pathname !== '/api/db/records')
        throw new Error(`Unexpected request: ${url.pathname}`)

      return Response.json(
        url.searchParams.get('select') === 'identifier'
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
    })

    const { onWithdrawn, queryClient } = mount(createDataClient(transport))

    const stockKeys = [
      ['ui-port', 'materials', 'page'],
      ['ui-port', 'materials', 'lot', 'lot-1'],
      ['ui-port', 'materials', 'ledger', 'lot-1'],
      ['reg-003', 'reagents', 'detail', 'lot-1'],
      ['reg-003', 'reagents', 'movements', 'lot-1'],
    ]

    for (const key of stockKeys) queryClient.setQueryData(key, { quantity: 10 })
    const unrelatedKey = ['ui-port', 'sample', 'sample-2']
    queryClient.setQueryData(unrelatedKey, { quantity: 20 })

    fireEvent.click(screen.getByRole('button', { name: 'Withdraw from stock' }))
    await vi.waitFor(() => expect(onWithdrawn).toHaveBeenCalled())
    expect(onWithdrawn.mock.calls[0][0]).toMatch(/^Withdrawn from stock/)

    for (const key of stockKeys) {
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true)
    }

    expect(queryClient.getQueryState(unrelatedKey)?.isInvalidated).toBe(false)
    expect(transport).toHaveBeenCalledWith(
      '/api/db/rpc/record_reagent_movement',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          p_reagent_record_id: 'lot-1',
          p_operation: 'consume',
          p_quantity_delta: 5,
          p_reason: 'Used in EXP-1',
          p_expected_metadata_version: 2,
        }),
      }),
    )
  })

  it('refreshes sample stock, history and experiment links without invalidating other notebooks', async () => {
    const row = {
      id: 'sample-1',
      identifier: 'SMP-1',
      kind: 'sample',
      title: 'Culture',
      status: 'available',
      tags: [],
      metadata_version: 2,
      properties: { quantity: 10, quantityUnit: 'mL' },
      custom_fields: {},
    }

    const transport = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(
        input instanceof Request ? input.url : input,
        'http://localhost',
      )

      if (url.pathname === '/api/db/records') return Response.json([row])

      if (url.pathname === '/api/db/rpc/withdraw_sample') {
        return Response.json({
          sample: { ...row, properties: { quantity: 5, quantityUnit: 'mL' } },
          derivedSampleId: null,
          derivedSample: null,
        })
      }

      throw new Error(`Unexpected request: ${url.pathname}`)
    })

    const queryClient = new QueryClient()

    const stockKeys = [
      ['ui-port', 'samples', 'page', 'counts'],
      ['ui-port', 'sample', 'sample-1'],
      ['ui-port', 'sample-events', 'sample-1'],
      ['reg-002', 'samples', 'balances', 'sample-1'],
      ['ui-port', 'sample-linked-experiments', 'sample-1'],
      ['ui-port', 'sample-used-in', 'sample-1'],
      ['ui-port', 'experiment-links', 'exp-1'],
      ['ui-port', 'experiment-samples-table', 'exp-1', ['sample-1']],
    ]

    for (const key of stockKeys) queryClient.setQueryData(key, row)
    const unrelatedKey = ['ui-port', 'experiment-links', 'exp-2']
    queryClient.setQueryData(unrelatedKey, [])
    const onWithdrawn = vi.fn()
    render(
      <QueryClientProvider client={queryClient}>
        <StockWithdrawButton
          item={{
            ...item,
            kind: 'sample',
            materialRecordId: 'sample-1',
            identifier: 'SMP-1',
          }}
          experimentId="exp-1"
          onWithdrawn={onWithdrawn}
          client={createDataClient(transport)}
        />
      </QueryClientProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw from stock' }))
    await vi.waitFor(() => expect(onWithdrawn).toHaveBeenCalled())

    for (const key of stockKeys) {
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true)
    }

    expect(queryClient.getQueryState(unrelatedKey)?.isInvalidated).toBe(false)
  })

  it('shows the refusal instead of failing silently', async () => {
    const transport = vi.fn<typeof fetch>(async () => Response.json([]))
    mount(createDataClient(transport))
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw from stock' }))
    expect(await screen.findByText('RGT-1 could not be read.')).toBeTruthy()
  })

  it('shows the marker, not a second button, once withdrawn', () => {
    const transport = vi.fn<typeof fetch>()
    mount(createDataClient(transport), 'Withdrawn from stock 2026-10-19')
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('Withdrawn from stock 2026-10-19')).toBeTruthy()
    expect(transport).not.toHaveBeenCalled()
  })
})
