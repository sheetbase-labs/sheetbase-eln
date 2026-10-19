import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DataClient } from '#/lib/data-client'

import { ScanSampleActions } from './scan-sample-actions'

vi.mock('#/components/v3/ui/sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
  Toaster: () => null,
}))

afterEach(cleanup)

function sampleWire(overrides: Record<string, unknown> = {}) {
  return {
    id: 's-1',
    identifier: 'SMP-1',
    kind: 'sample',
    title: 'Lysate',
    status: 'available',
    tags: [],
    metadata_version: 5,
    properties: {
      quantity: 12.5,
      quantityUnit: 'mL',
      storageLocation: 'Freezer 1',
    },
    custom_fields: {},
    archived_at: null,
    ...overrides,
  }
}

function mount(opts: {
  sample?: Record<string, unknown> | null
  onChanged?: () => void
}) {
  const rpc = vi.fn(async (name: string) =>
    name === 'transfer_sample' ? sampleWire() : {},
  )
  const list = vi.fn(async (table: string, query: string) => {
    if (table === 'records' && query.includes('kind=eq.sample&select'))
      return opts.sample === null ? [] : [opts.sample ?? sampleWire()]
    if (table === 'records') return []
    return []
  })
  const client = { rpc, list } as unknown as DataClient
  const root = createRootRoute({
    component: () => (
      <QueryClientProvider client={new QueryClient()}>
        <ScanSampleActions
          sampleId="s-1"
          returnTo="/scan?code=SMP-1"
          client={client}
          onChanged={opts.onChanged}
        />
      </QueryClientProvider>
    ),
  })
  render(
    <RouterProvider
      router={createRouter({
        routeTree: root,
        history: createMemoryHistory({ initialEntries: ['/'] }),
      })}
    />,
  )
  return { rpc, list }
}

describe('ScanSampleActions', () => {
  it('shows the quantity and place, and the three bench actions', async () => {
    mount({})
    expect(await screen.findByText('12.5 mL · Freezer 1')).toBeTruthy()
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Withdraw' })
        .disabled,
    ).toBe(false)
    expect(screen.getByRole('button', { name: 'Move' })).toBeTruthy()
    expect(screen.getByText('Record reading')).toBeTruthy()
  })

  it('moves the sample in place and tells the scan to refresh', async () => {
    const onChanged = vi.fn()
    const { rpc } = mount({ onChanged })
    await screen.findByText('12.5 mL · Freezer 1')
    fireEvent.click(screen.getByRole('button', { name: 'Move' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/New location/), {
      target: { value: 'Bench' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }))
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('transfer_sample', {
        p_record_id: 's-1',
        p_to_location: 'Bench',
        p_expected_metadata_version: 5,
        p_notes: null,
      }),
    )
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('holds Withdraw for a quarantined sample and says why', async () => {
    mount({ sample: sampleWire({ status: 'quarantined' }) })
    await screen.findByText('12.5 mL · Freezer 1')
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Withdraw' })
        .disabled,
    ).toBe(true)
    expect(
      screen.getByText(
        /Withdraw is unavailable while this sample is quarantined/,
      ),
    ).toBeTruthy()
  })

  it('says the sample could not be read rather than showing dead buttons', async () => {
    mount({ sample: null })
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Withdraw' })).toBeNull()
  })
})
