/**
 * LAB-01 step 3 / QA-121 — the sample Usage tab lists live usage.
 *
 * The tab merges the `consume` rows of the sample ledger with the reservations
 * that still hold volume, and its count is the number of rows it shows. A
 * cancelled reservation holds no volume, so it must not appear in the list or
 * inflate the count.
 *
 * Only the `/api/db` boundary is answered here: the sample data layer, the
 * route's params and the grid all run for real.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SampleEventWire, SampleReservationWire } from '#/lib/samples'
import { SampleActionsProvider } from '#/components/samples/quantity-actions-provider'
import { Route } from './usage'

const api = vi.hoisted(() => {
  const reservations: SampleReservationWire[] = []
  const events: SampleEventWire[] = []

  const state = {
    reservations,
    events,
    balances: {
      sampleRecordId: 's-1',
      unit: 'mg',
      current: 9.5,
      used: 3,
      reserved: 2,
      free: 7.5,
    },
  }

  vi.stubGlobal(
    'fetch',
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input)
      const request = new Request(new URL(url, 'http://localhost'), init)
      const { pathname } = new URL(request.url)

      if (pathname === '/api/db/rpc/sample_quantity_balances') {
        return Response.json(state.balances)
      }

      if (pathname === '/api/db/sample_reservations') {
        return Response.json(state.reservations)
      }

      if (pathname === '/api/db/sample_events')
        return Response.json(state.events)

      return Response.json([])
    },
  )

  return state
})

// jsdom reports no layout, so the grid's virtualiser would render no rows: give
// every element the viewport a browser would report for the list area.
for (const prop of ['offsetHeight', 'clientHeight'] as const) {
  Object.defineProperty(HTMLElement.prototype, prop, {
    configurable: true,
    get: () => 600,
  })
}

const SampleUsageOption = Route.options.component

if (!SampleUsageOption) throw new Error('the route declares its component')

const SampleUsage = SampleUsageOption

function reservation(
  overrides: Partial<SampleReservationWire> = {},
): SampleReservationWire {
  return {
    id: 'r-1',
    workspace_id: 'w-1',
    sample_record_id: 's-1',
    experiment_record_id: 'exp-1',
    quantity: '2',
    unit: 'mg',
    planned: true,
    state: 'active',
    notes: null,
    created_by_user_id: 'u-1',
    cancelled_by_user_id: null,
    cancelled_at: null,
    created_at: '2026-09-16T00:00:00.000Z',
    updated_at: '2026-09-16T00:00:00.000Z',
    ...overrides,
  }
}

function consumeEvent(): SampleEventWire {
  return {
    id: 'e-1',
    workspace_id: 'w-1',
    record_id: 's-1',
    operation: 'consume',
    quantity_delta: '-3',
    quantity_before: '12.5',
    quantity_after: '9.5',
    quantity_unit: 'mg',
    from_location: null,
    to_location: null,
    actor_user_id: 'u-1',
    purpose_record_id: null,
    notes: null,
    created_at: '2026-09-11T10:40:00.000Z',
  }
}

beforeEach(() => {
  api.balances = {
    sampleRecordId: 's-1',
    unit: 'mg',
    current: 9.5,
    used: 3,
    reserved: 2,
    free: 7.5,
  }
  api.events = [consumeEvent()]
})

afterEach(() => {
  cleanup()
  api.reservations = []
  api.events = []
})

/** The tab inside the router it reads its sample id from. */
function renderUsage(children: React.ReactNode = <SampleUsage />) {
  const root = createRootRoute()

  const route = createRoute({
    getParentRoute: () => root,
    path: '/samples/$sampleId/usage',
    component: () => <>{children}</>,
  })

  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ['/samples/s-1/usage'] }),
  })

  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

describe('QA-121 — the Usage list counts live usage', () => {
  it('leaves a cancelled reservation out of the list and its count', async () => {
    api.reservations = [
      reservation({ id: 'r-live', experiment_record_id: 'exp-live' }),
      reservation({
        id: 'r-cancelled',
        experiment_record_id: 'exp-cancelled',
        state: 'cancelled',
        cancelled_at: '2026-09-16T09:00:00.000Z',
        cancelled_by_user_id: 'u-1',
      }),
    ]
    renderUsage()

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
    renderUsage(
      <SampleActionsProvider
        actions={{
          openWithdraw: vi.fn(),
          openReserve: vi.fn(),
          canWithdraw,
        }}
      >
        <SampleUsage />
      </SampleActionsProvider>,
    )
  }

  it('withholds Withdraw when the sample cannot be withdrawn', async () => {
    api.reservations = []
    renderWithActions(false)

    expect(
      await screen.findByRole('button', { name: 'Reserve volume…' }),
    ).toBeTruthy()
    expect(
      screen.queryByRole('button', { name: 'Withdraw volume…' }),
    ).toBeNull()
  })

  it('offers Withdraw when the sample can be withdrawn', async () => {
    api.reservations = []
    renderWithActions(true)

    expect(
      await screen.findByRole('button', { name: 'Withdraw volume…' }),
    ).toBeTruthy()
  })
})
