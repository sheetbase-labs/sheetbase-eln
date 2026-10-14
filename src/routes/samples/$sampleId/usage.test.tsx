/**
 * LAB-01 step 3 / QA-121 — the sample Usage tab lists live usage.
 *
 * The tab merges the `consume` rows of the sample ledger with the reservations
 * that still hold volume, and its count is the number of rows it shows. A
 * cancelled reservation holds no volume, so it must not appear in the list or
 * inflate the count.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SampleActionsProvider } from '#/components/v3/samples/withdraw-dialog'
import { Route } from './usage'

const samples = vi.hoisted(() => ({
  fetchSampleEvents: vi.fn(),
  fetchSampleReservations: vi.fn(),
  fetchSampleQuantityBalances: vi.fn(),
  cancelSampleReservation: vi.fn(),
  describeSampleError: vi.fn(() => 'Could not complete it.'),
  sampleQueryKeys: {
    balances: (recordId: string) => ['balances', recordId],
    reservations: (recordId: string) => ['reservations', recordId],
  },
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    useParams: () => ({ sampleId: 's-1' }),
    options: config,
  }),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}))

// The tab only borrows the frame's event query key; mocking it keeps the
// sample frame (and its dialogs) out of this harness.
vi.mock('../$sampleId', () => ({
  sampleEventsQueryKey: (recordId: string) => ['sample-events', recordId],
}))

vi.mock('#/lib/notebook-data', () => ({ notebookDataClient: {} }))

vi.mock('#/lib/samples', () => samples)

vi.mock('#/lib/user-names', () => ({
  useUserNames: () => ({ names: {}, userLabel: (id: string) => id }),
}))

vi.mock('#/components/v3/ui/sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}))

const SampleUsage = Route.options.component as React.ComponentType

function reservation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'r-1',
    sampleRecordId: 's-1',
    experimentRecordId: 'exp-1',
    quantity: 2,
    unit: 'mg',
    planned: true,
    state: 'active',
    notes: null,
    createdByUserId: 'u-1',
    cancelledByUserId: null,
    cancelledAt: null,
    createdAt: '2026-09-16T00:00:00.000Z',
    updatedAt: '2026-09-16T00:00:00.000Z',
    ...overrides,
  }
}

function consumeEvent() {
  return {
    id: 'e-1',
    recordId: 's-1',
    operation: 'consume',
    quantityDelta: -3,
    quantityBefore: 12.5,
    quantityAfter: 9.5,
    quantityUnit: 'mg',
    fromLocation: null,
    toLocation: null,
    actorUserId: 'u-1',
    purposeRecordId: null,
    notes: null,
    createdAt: '2026-09-11T10:40:00.000Z',
  }
}

beforeEach(() => {
  samples.fetchSampleQuantityBalances.mockResolvedValue({
    sampleRecordId: 's-1',
    unit: 'mg',
    current: 9.5,
    used: 3,
    reserved: 2,
    free: 7.5,
  })
  samples.fetchSampleEvents.mockResolvedValue([consumeEvent()])
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('QA-121 — the Usage list counts live usage', () => {
  it('leaves a cancelled reservation out of the list and its count', async () => {
    samples.fetchSampleReservations.mockResolvedValue([
      reservation({ id: 'r-live', experimentRecordId: 'exp-live' }),
      reservation({
        id: 'r-cancelled',
        experimentRecordId: 'exp-cancelled',
        state: 'cancelled',
        cancelledAt: '2026-09-16T09:00:00.000Z',
        cancelledByUserId: 'u-1',
      }),
    ])
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <SampleUsage />
      </QueryClientProvider>,
    )

    // One withdrawal plus one live reservation: the header count and the rows
    // it counts agree, and nothing cancelled is listed.
    const table = await screen.findByRole('table', { name: 'Sample usage' })
    const header = screen.getByRole('heading', { name: 'Usage' })
    expect(header.nextElementSibling?.textContent).toBe('2')
    expect(table.querySelectorAll('tbody tr')).toHaveLength(2)
    expect(screen.queryByText('Cancelled')).toBeNull()
  })
})

describe('QA3 — the Usage tab offers only the actions the sample state allows', () => {
  function renderWithActions(canWithdraw: boolean) {
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <SampleActionsProvider
          actions={{
            openWithdraw: vi.fn(),
            openReserve: vi.fn(),
            canWithdraw,
          }}
        >
          <SampleUsage />
        </SampleActionsProvider>
      </QueryClientProvider>,
    )
  }

  it('withholds Withdraw when the sample cannot be withdrawn', async () => {
    samples.fetchSampleReservations.mockResolvedValue([])
    renderWithActions(false)

    expect(
      await screen.findByRole('button', { name: 'Reserve volume…' }),
    ).toBeTruthy()
    expect(
      screen.queryByRole('button', { name: 'Withdraw volume…' }),
    ).toBeNull()
  })

  it('offers Withdraw when the sample can be withdrawn', async () => {
    samples.fetchSampleReservations.mockResolvedValue([])
    renderWithActions(true)

    expect(
      await screen.findByRole('button', { name: 'Withdraw volume…' }),
    ).toBeTruthy()
  })
})
