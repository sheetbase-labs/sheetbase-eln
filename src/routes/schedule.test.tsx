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
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type * as router from '@tanstack/react-router'
import type * as notebookData from '#/lib/notebook-data'

import { DataClientError } from '#/lib/data-client'
import { Schedule } from './schedule'

const AMBR = '00000000-0000-4000-8000-0000000003e1'
const PR01 = '00000000-0000-4000-8000-0000000003e0'

const fake = vi.hoisted(() => {
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
  const state = {
    instruments: [...instruments],
    bookings: [] as Record<string, unknown>[],
  }
  const list = async (resource: string) => {
    switch (resource) {
      case 'instruments':
        return state.instruments
      case 'calendar_bookings':
        return state.bookings
      default:
        return []
    }
  }
  return {
    list,
    rpc: vi.fn(async () => []),
    state,
    defaultInstruments: instruments,
  }
})

vi.mock('#/lib/notebook-data', async (importOriginal) => ({
  ...(await importOriginal<typeof notebookData>()),
  notebookDataClient: fake,
}))

vi.mock('#/components/v3/ui/sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}))

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof router>()
  return {
    ...actual,
    createFileRoute: () => (options: object) => ({
      options,
      useSearch: () => ({}),
      useRouteContext: () => ({
        context: {
          user: { id: 'user-1' },
          workspace: { id: 'ws-1', name: 'Process Development' },
        },
      }),
    }),
    redirect: vi.fn(),
    Link: ({
      to,
      children,
      params,
      ...rest
    }: React.ComponentProps<'a'> & {
      to?: unknown
      params?: Record<string, string>
    }) => {
      const href =
        typeof to === 'string' && params
          ? Object.entries(params).reduce(
              (path, [key, value]) => path.replace(`$${key}`, value),
              to,
            )
          : typeof to === 'string'
            ? to
            : '#'
      return (
        <a href={href} {...rest}>
          {children}
        </a>
      )
    },
  }
})

afterEach(() => {
  cleanup()
  fake.state.instruments = [...fake.defaultInstruments]
  fake.state.bookings = []
  fake.rpc.mockReset()
})

function renderSchedule() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <Schedule />
    </QueryClientProvider>,
  )
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
    const dialog = screen.getByRole('dialog')
    const options = within(dialog)
      .getAllByRole('option')
      .map((option) => option.textContent)

    expect(options).toEqual([
      'Choose…',
      'INS-0007 · Plate reader PR-01',
      'INS-0008 · Ambr 250',
    ])
  })
})

/** A calendar_bookings row as the PostgREST boundary returns it. */
function bookingRow(overrides: Record<string, unknown>) {
  const day = new Date().toISOString().slice(0, 10)
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

describe('Schedule grid bounds, empty state and phone navigation', () => {
  it('draws a booking outside 08:00–18:00 inside the widened grid', async () => {
    fake.state.bookings = [bookingRow({})]
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

  it('states that no instruments are configured instead of drawing an empty grid', async () => {
    fake.state.instruments = []
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
    fake.state.bookings = [bookingRow({})]
    fake.rpc.mockResolvedValue([])
    const user = userEvent.setup()
    renderSchedule()
    await user.click(await screen.findByRole('tab', { name: 'Day' }))

    // A booking is no longer inert: clicking it opens the detail/cancel dialog.
    await user.click(screen.getByTitle(TITLE))
    const dialog = await screen.findByRole('dialog')
    await user.click(
      within(dialog).getByRole('button', { name: 'Cancel booking' }),
    )

    expect(fake.rpc).toHaveBeenCalledWith('cancel_booking', {
      p_booking_id: 'b-1',
      p_expected_metadata_version: null,
    })
    // The row is gone once the server accepts the cancellation.
    await vi.waitFor(() => expect(screen.queryByTitle(TITLE)).toBeNull())
  })

  it('says why when the server refuses to cancel', async () => {
    fake.state.bookings = [bookingRow({})]
    fake.rpc.mockRejectedValueOnce(
      new DataClientError('SB024', 'This booking is already cancelled.', 409),
    )
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
    fake.state.bookings = [
      bookingRow({
        linked_experiment_record_id: 'exp-1',
        linked_experiment_identifier: 'EXP-0145',
        linked_experiment_title: 'Titration',
        notes: 'Bring the plate',
      }),
    ]
    const day = new Date().toISOString().slice(0, 10)
    fake.rpc.mockResolvedValue(
      // The RPC answers with the saved booking row.
      bookingRow({
        title: 'Overnight digest, later',
        starts_at: `${day}T21:00:00.000Z`,
        ends_at: `${day}T22:00:00.000Z`,
        metadata_version: 2,
        linked_experiment_record_id: 'exp-1',
        linked_experiment_identifier: 'EXP-0145',
        linked_experiment_title: 'Titration',
      }) as never,
    )
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
      expect(fake.rpc).toHaveBeenCalledWith(
        'edit_booking',
        expect.objectContaining({
          p_booking_id: 'b-1',
          p_title: 'Overnight digest, later',
          p_expected_metadata_version: 1,
        }),
      ),
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
