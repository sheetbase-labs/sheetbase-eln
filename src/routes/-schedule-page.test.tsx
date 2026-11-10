/**
 * ADR-0054 / R5-CONFIG-06 — Schedule books instruments.
 *
 * The route is rendered over the real read models with only the `/api/db`
 * boundary faked, so the reader (which instruments are bookable), the week grid
 * and the picker all run for real: each grid row is an instrument linking to
 * /instruments/$id with its INS display id, and the picker offers the same
 * instruments by display id and name.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CalendarBookingWire } from '#/lib/calendar'
import { Schedule } from './-schedule-page'

const AMBR = '00000000-0000-4000-8000-0000000003e1'
const PR01 = '00000000-0000-4000-8000-0000000003e0'

/**
 * The `/api/db` boundary and the app's pinned clock. Hoisted so both are in
 * place before the data client and `#/lib/clock` are first imported.
 */
const api = vi.hoisted(() => {
  const today = new Date().toISOString().slice(0, 10)

  process.env.SHEETBASE_ENV = 'test'
  process.env.SHEETBASE_NOW = `${today}T10:30:00.000Z`

  const instruments = [
    {
      id: '00000000-0000-4000-8000-0000000003e0',
      display_id: 'INS-0007',
      name: 'Plate reader PR-01',
      location: null,
      retired_at: null,
    },
    {
      id: '00000000-0000-4000-8000-0000000003e1',
      display_id: 'INS-0008',
      name: 'Ambr 250',
      location: 'bay 2',
      retired_at: null,
    },
    {
      id: '00000000-0000-4000-8000-0000000003df',
      display_id: 'INS-0006',
      name: 'Retired reader',
      location: null,
      retired_at: '2026-09-01T00:00:00.000Z',
    },
  ]

  const bookings: CalendarBookingWire[] = []
  const rpcs: Array<{ name: string; args: unknown }> = []

  /** A PostgREST error body, when a refusal is tested. */
  interface Refusal {
    code: string
    message: string
  }

  let edited: CalendarBookingWire | null = null
  let refusal: Refusal | null = null

  const state = {
    today,
    instruments: [...instruments],
    defaultInstruments: instruments,
    bookings,
    rpcs,
    get edited() {
      return edited
    },
    set edited(row: CalendarBookingWire | null) {
      edited = row
    },
    get cancelError() {
      return refusal
    },
    set cancelError(body: Refusal | null) {
      refusal = body
    },
  }

  vi.stubGlobal(
    'fetch',
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input)
      const request = new Request(new URL(url, 'http://localhost'), init)
      const { pathname } = new URL(request.url)

      if (pathname.startsWith('/api/db/rpc/')) {
        const name = pathname.slice('/api/db/rpc/'.length)
        const args = JSON.parse(await request.text())

        state.rpcs.push({ name, args })

        if (name === 'cancel_booking' && state.cancelError) {
          return Response.json(state.cancelError, { status: 409 })
        }

        if (name === 'edit_booking') return Response.json(state.edited)

        return Response.json([])
      }

      if (pathname === '/api/db/instruments') {
        return Response.json(state.instruments)
      }

      if (pathname === '/api/db/calendar_bookings') {
        return Response.json(state.bookings)
      }

      return Response.json([])
    },
  )

  return state
})

afterEach(() => {
  cleanup()
  api.instruments = [...api.defaultInstruments]
  api.bookings = []
  api.edited = null
  api.cancelError = null
  api.rpcs = []
})

function renderSchedule() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  const root = createRootRoute()

  const route = createRoute({
    getParentRoute: () => root,
    path: '/schedule',
    beforeLoad: () => ({
      context: {
        user: { id: 'user-1' },
        workspace: { id: 'ws-1', name: 'Process Development' },
      },
    }),
    component: () => <Schedule />,
  })

  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ['/schedule'] }),
  })

  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

/** A calendar_bookings row as the PostgREST boundary returns it. */
function bookingRow(
  overrides: Partial<CalendarBookingWire>,
): CalendarBookingWire {
  const day = api.today

  return {
    id: 'b-1',
    workspace_id: 'ws-1',
    resource_id: PR01,
    project_id: null,
    title: 'Overnight digest',
    status: 'tentative',
    all_day: false,
    starts_at: `${day}T19:00:00.000Z`,
    ends_at: `${day}T20:30:00.000Z`,
    timezone: 'UTC',
    location: null,
    color: null,
    notes: null,
    linked_experiment_record_id: null,
    linked_experiment_identifier: null,
    linked_experiment_title: null,
    metadata_version: 1,
    cancelled_at: null,
    created_at: `${day}T00:00:00.000Z`,
    updated_at: `${day}T00:00:00.000Z`,
    created_by_user_id: null,
    updated_by_user_id: null,
    ...overrides,
  }
}

describe('ADR-0054 Schedule', () => {
  it('links each grid row to its instrument with the INS display id', async () => {
    renderSchedule()

    const ambr = await screen.findByRole('link', { name: /INS-0008/ })
    expect(ambr.getAttribute('href')).toBe(`/instruments/${AMBR}`)
    expect(ambr.textContent).toContain('Ambr 250')

    const plate = screen.getByRole('link', { name: /INS-0007/ })
    expect(plate.getAttribute('href')).toBe(`/instruments/${PR01}`)
    expect(plate.textContent).toContain('Plate reader PR-01')

    // A retired instrument is not a Schedule row at all.
    expect(screen.queryByRole('link', { name: /INS-0006/ })).toBeNull()
    expect(screen.queryByRole('link', { name: /Retired reader/ })).toBeNull()
  })

  it('offers the instruments by display id and name in the picker', async () => {
    const user = userEvent.setup()
    renderSchedule()
    await screen.findByRole('link', { name: /INS-0008/ })

    await user.click(screen.getByRole('button', { name: 'Book instrument' }))
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: /Instrument/,
      }),
    )
    const dialogs = screen.getAllByRole('dialog')

    const options = within(dialogs[dialogs.length - 1])
      .getAllByRole('option')
      .map((option) => option.textContent)

    expect(options).toEqual(['INS-0007Plate reader PR-01', 'INS-0008Ambr 250'])
  })
})

describe('Schedule grid bounds, empty state and phone navigation', () => {
  it('draws a booking outside 08:00–18:00 inside the widened grid', async () => {
    api.bookings = [bookingRow({})]
    const user = userEvent.setup()
    renderSchedule()
    await user.click(await screen.findByRole('tab', { name: 'Day' }))

    // The 20:00 hour is only drawn because the window widened to the booking.
    expect(await screen.findByText('20:00')).toBeTruthy()

    const bar = screen.getByTitle(
      '19:00–20:30 · A colleague · Overnight digest',
    ).parentElement!

    const percent = (value: string) =>
      Number(/calc\((-?[\d.]+)%/.exec(value)?.[1])

    const left = percent(bar.style.left)
    const width = percent(bar.style.width)
    expect(left).toBeGreaterThanOrEqual(0)
    expect(width).toBeGreaterThan(0)
    expect(left + width).toBeLessThanOrEqual(100)
  })

  it('shows each booking in the week with its times, title and who booked it', async () => {
    api.bookings = [bookingRow({})]
    renderSchedule()

    const grid = await screen.findByRole('region', {
      name: 'Instrument schedule',
    })

    const chip = await within(grid).findByTitle(
      '19:00–20:30 · A colleague · Overnight digest',
    )

    expect(chip.textContent).toContain('19:00–20:30')
    expect(chip.textContent).toContain('Overnight digest')
  })

  it('marks where today has got to in the day view, and only on today', async () => {
    const day = api.today
    api.bookings = [
      bookingRow({
        starts_at: `${day}T09:00:00.000Z`,
        ends_at: `${day}T11:00:00.000Z`,
      }),
    ]
    const user = userEvent.setup()
    renderSchedule()
    await user.click(await screen.findByRole('tab', { name: 'Day' }))
    const line = await screen.findByTestId('schedule-now')

    const marker = line.querySelector('div')
    const left = Number(/([\d.]+)%/.exec(marker?.style.left ?? '')?.[1])

    // 08:00–18:00 window: 10:30 is a quarter of the way along.
    expect(left).toBeCloseTo(25, 0)

    await user.click(screen.getByRole('button', { name: /next/i }))
    expect(screen.queryByTestId('schedule-now')).toBeNull()
  })

  it('states that no instruments are configured instead of drawing an empty grid', async () => {
    api.instruments = []
    renderSchedule()

    expect(await screen.findByText('No instruments configured')).toBeTruthy()
    // No empty frame and no instrument rows behind the statement.
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByLabelText('Instrument schedule')).toBeNull()
  })

  it('moves the phone day list when the week is stepped', async () => {
    const user = userEvent.setup()
    renderSchedule()
    await screen.findByRole('link', { name: /INS-0008/ })

    const shownDay = () =>
      screen
        .getByRole('region', { name: /^Bookings,/ })
        .getAttribute('aria-label')

    const before = shownDay()
    await user.click(screen.getByRole('button', { name: 'Next week' }))
    expect(shownDay()).not.toBe(before)
  })
})

describe('Schedule booking cancellation', () => {
  const TITLE = '19:00–20:30 · A colleague · Overnight digest'

  it('opens a booking and cancels it through the cancel_booking RPC', async () => {
    api.bookings = [bookingRow({})]
    const user = userEvent.setup()
    renderSchedule()
    await user.click(await screen.findByRole('tab', { name: 'Day' }))

    // A booking is no longer inert: clicking it opens the detail/cancel dialog.
    await user.click(screen.getByTitle(TITLE))
    const dialog = await screen.findByRole('dialog')
    await user.click(
      within(dialog).getByRole('button', { name: 'Cancel booking' }),
    )

    expect(api.rpcs).toContainEqual({
      name: 'cancel_booking',
      args: { p_booking_id: 'b-1', p_expected_metadata_version: null },
    })
    // The row is gone once the server accepts the cancellation.
    await vi.waitFor(() => expect(screen.queryByTitle(TITLE)).toBeNull())
  })

  it('says why when the server refuses to cancel', async () => {
    api.bookings = [bookingRow({})]
    api.cancelError = {
      code: 'SB024',
      message: 'This booking is already cancelled.',
    }
    const user = userEvent.setup()
    renderSchedule()
    await user.click(await screen.findByRole('tab', { name: 'Day' }))

    await user.click(screen.getByTitle(TITLE))
    const dialog = await screen.findByRole('dialog')
    await user.click(
      within(dialog).getByRole('button', { name: 'Cancel booking' }),
    )

    // The refusal is the server's reason, and the dialog stays open.
    expect((await within(dialog).findByRole('alert')).textContent).toMatch(
      /already cancelled/i,
    )
    expect(screen.getByTitle(TITLE)).toBeTruthy()
  })
})

describe('Schedule booking detail and edit', () => {
  const TITLE = '19:00–20:30 · A colleague · Overnight digest'

  it('names the experiment, links it, and edits the booking in place', async () => {
    api.bookings = [
      bookingRow({
        linked_experiment_record_id: 'exp-1',
        linked_experiment_identifier: 'EXP-0145',
        linked_experiment_title: 'Titration',
        notes: 'Bring the plate',
      }),
    ]
    const day = api.today
    api.edited = bookingRow({
      title: 'Overnight digest, later',
      starts_at: `${day}T21:00:00.000Z`,
      ends_at: `${day}T22:00:00.000Z`,
      metadata_version: 2,
      linked_experiment_record_id: 'exp-1',
      linked_experiment_identifier: 'EXP-0145',
      linked_experiment_title: 'Titration',
    })
    const user = userEvent.setup()
    renderSchedule()
    await user.click(await screen.findByRole('tab', { name: 'Day' }))
    await user.click(screen.getByTitle(TITLE))
    const dialog = await screen.findByRole('dialog')

    expect(
      within(dialog)
        .getByRole('link', { name: 'EXP-0145' })
        .getAttribute('href'),
    ).toBe('/experiments/exp-1')
    expect(within(dialog).getByText('Bring the plate')).toBeTruthy()

    await user.click(
      within(dialog).getByRole('button', { name: 'Edit booking…' }),
    )
    const edit = (await screen.findAllByRole('dialog')).at(-1)!
    const what = within(edit).getByLabelText(/^What/)
    await user.clear(what)
    await user.type(what, 'Overnight digest, later')
    await user.click(within(edit).getByRole('button', { name: 'Save changes' }))

    await vi.waitFor(() =>
      expect(api.rpcs).toContainEqual({
        name: 'edit_booking',
        args: expect.objectContaining({
          p_booking_id: 'b-1',
          p_title: 'Overnight digest, later',
          p_expected_metadata_version: 1,
        }),
      }),
    )
    // The grid shows the saved booking, not the old one.
    await vi.waitFor(() =>
      expect(
        screen.getByTitle(
          '21:00–22:00 · A colleague · Overnight digest, later',
        ),
      ).toBeTruthy(),
    )
  })
})
