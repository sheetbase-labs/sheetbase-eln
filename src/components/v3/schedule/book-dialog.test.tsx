import { choose } from '../../../../tests/unit/picker'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UserEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DataClientError } from '#/lib/data-client'
import type { CalendarBookingWire } from '#/lib/calendar'
import type * as NotebookData from '#/lib/notebook-data'

import { BookDialog } from './book-dialog'
import type { ScheduleBooking, ScheduleInstrument } from './schedule-data'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    search,
    children,
  }: {
    to: string
    params?: Record<string, string>
    search?: Record<string, string>
    children: React.ReactNode
  }) => {
    const path = Object.entries(params ?? {}).reduce(
      (acc, [key, value]) => acc.replace(`$${key}`, value),
      to,
    )
    const query = search ? `?${new URLSearchParams(search).toString()}` : ''
    return <a href={`${path}${query}`}>{children}</a>
  },
}))

// The dialog submits through the canonical create_booking RPC; mock only the
// data client so the test can observe the RPC call and its params. `list`
// answers the workspace settings read the dialog makes to learn the workspace
// time zone a booking's wall clock means.
const { rpc, list } = vi.hoisted(() => ({ rpc: vi.fn(), list: vi.fn() }))
vi.mock('#/lib/notebook-data', async (importOriginal) => ({
  ...(await importOriginal<typeof NotebookData>()),
  notebookDataClient: { rpc, list },
}))

beforeEach(() => {
  list.mockResolvedValue([{ timezone: 'Europe/London' }])
})

afterEach(() => {
  cleanup()
  rpc.mockReset()
  list.mockReset()
})

const INSTRUMENTS: ScheduleInstrument[] = [
  { id: 'res-pr01', displayId: 'INS-0007', name: 'Plate reader PR-01' },
  { id: 'res-pcr', displayId: 'INS-0009', name: 'Thermocycler PCR-02' },
]

const WIRE: CalendarBookingWire = {
  id: 'booking-1',
  workspace_id: 'ws-1',
  resource_id: 'res-pr01',
  project_id: null,
  title: 'ELISA plate 5',
  status: 'tentative',
  all_day: false,
  starts_at: '2026-10-12T14:00:00.000Z',
  ends_at: '2026-10-12T16:00:00.000Z',
  timezone: 'UTC',
  location: null,
  color: null,
  notes: null,
  linked_experiment_record_id: null,
  linked_experiment_identifier: null,
  linked_experiment_title: null,
  metadata_version: 1,
  cancelled_at: null,
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
  created_by_user_id: 'user-1',
  updated_by_user_id: 'user-1',
}

const BOOKED: ScheduleBooking = {
  id: 'booking-1',
  resourceId: 'res-pr01',
  title: 'ELISA plate 5',
  date: '2026-10-12',
  start: '14:00',
  end: '16:00',
  timezone: 'UTC',
  createdByUserId: 'user-1',
  notes: null,
  metadataVersion: 1,
}

function renderDialog(onBooked = vi.fn()) {
  const view = render(
    <BookDialog
      instruments={INSTRUMENTS}
      workspaceId="ws-1"
      defaultDate="2026-10-12"
      onBooked={onBooked}
    />,
  )
  return { onBooked, rerender: view.rerender }
}

async function openAndFill(
  user: UserEvent,
  { instrument = 'res-pr01', title = 'ELISA plate 5' } = {},
) {
  await user.click(screen.getByRole('button', { name: 'Book instrument' }))
  const dialog = screen.getByRole('dialog')
  await choose(
    user,
    /Instrument/,
    instrument === 'res-pcr' ? /PCR-02/ : /PR-01/,
  )
  fireEvent.change(within(dialog).getByLabelText(/What/), {
    target: { value: title },
  })
  fireEvent.change(within(dialog).getByLabelText(/From/), {
    target: { value: '14:00' },
  })
  fireEvent.change(within(dialog).getByLabelText(/To/), {
    target: { value: '16:00' },
  })
  return dialog
}

describe('BookDialog', () => {
  it('books the chosen instrument and time through the create_booking RPC', async () => {
    rpc.mockResolvedValueOnce(WIRE)
    const user = userEvent.setup()
    const { onBooked } = renderDialog()

    const dialog = await openAndFill(user)
    await user.click(within(dialog).getByRole('button', { name: 'Book' }))

    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith(
      'create_booking',
      expect.objectContaining({
        p_workspace_id: 'ws-1',
        p_resource_id: 'res-pr01',
        p_title: 'ELISA plate 5',
        // 14:00 on 12 October in London (BST) is 13:00 UTC.
        p_starts_at: '2026-10-12T13:00:00.000Z',
        p_ends_at: '2026-10-12T15:00:00.000Z',
        p_timezone: 'Europe/London',
      }),
    )
    await vi.waitFor(() => expect(onBooked).toHaveBeenCalledWith(BOOKED))
  })

  it.each([
    ['2026-01-15', '2026-01-15T14:00:00.000Z'],
    ['2026-07-15', '2026-07-15T13:00:00.000Z'],
  ])(
    'books the typed wall clock as an instant in the workspace zone on %s',
    async (date, startsAt) => {
      rpc.mockResolvedValueOnce(WIRE)
      const user = userEvent.setup()
      renderDialog()

      const dialog = await openAndFill(user)
      fireEvent.change(within(dialog).getByLabelText(/Date/), {
        target: { value: date },
      })
      await user.click(within(dialog).getByRole('button', { name: 'Book' }))

      // The wall clock is what the person typed; the instant is that clock in
      // the workspace's zone (GMT in January, BST in July).
      await vi.waitFor(() =>
        expect(rpc).toHaveBeenCalledWith(
          'create_booking',
          expect.objectContaining({
            p_starts_at: startsAt,
            p_timezone: 'Europe/London',
          }),
        ),
      )
    },
  )

  it('refuses the booking when the workspace time zone cannot be read', async () => {
    list.mockRejectedValueOnce(new Error('settings unavailable'))
    const user = userEvent.setup()
    renderDialog()

    const dialog = await openAndFill(user)
    await user.click(within(dialog).getByRole('button', { name: 'Book' }))

    // No guessed zone: the booking is not written with an instant the person
    // did not ask for.
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /Couldn’t read the workspace time zone/i,
    )
    expect(rpc).not.toHaveBeenCalled()
  })

  it('refuses an end time that is not after the start before calling the RPC', async () => {
    const user = userEvent.setup()
    renderDialog()

    const dialog = await openAndFill(user)
    fireEvent.change(within(dialog).getByLabelText(/To/), {
      target: { value: '13:00' },
    })
    await user.click(within(dialog).getByRole('button', { name: 'Book' }))

    expect((await screen.findByRole('alert')).textContent).toMatch(
      /end time must be after the start/i,
    )
    expect(rpc).not.toHaveBeenCalled()
  })

  it('restores the default times for the next booking', async () => {
    rpc.mockResolvedValueOnce(WIRE)
    const user = userEvent.setup()
    renderDialog()

    const dialog = await openAndFill(user)
    await user.click(within(dialog).getByRole('button', { name: 'Book' }))
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    await user.click(screen.getByRole('button', { name: 'Book instrument' }))
    const next = screen.getByRole('dialog')
    expect(within(next).getByLabelText<HTMLInputElement>(/From/).value).toBe(
      '09:00',
    )
    expect(within(next).getByLabelText<HTMLInputElement>(/To/).value).toBe(
      '10:00',
    )
  })

  it('takes the date from the view the person is looking at, not from first mount', async () => {
    const user = userEvent.setup()
    const { rerender } = renderDialog()

    await user.click(screen.getByRole('button', { name: 'Book instrument' }))
    const first = screen.getByRole('dialog')
    const firstDate = within(first).getByLabelText<HTMLInputElement>(/Date/)
    expect(firstDate.value).toBe('2026-10-12')

    // The person closes the dialog, moves to another week, and opens it again.
    await user.keyboard('{Escape}')
    rerender(
      <BookDialog
        instruments={INSTRUMENTS}
        workspaceId="ws-1"
        defaultDate="2026-10-19"
        onBooked={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Book instrument' }))
    const second = screen.getByRole('dialog')
    const nextDate = within(second).getByLabelText<HTMLInputElement>(/Date/)
    expect(nextDate.value).toBe('2026-10-19')
  })

  it('says why the picker is empty when the workspace has no instruments', async () => {
    const user = userEvent.setup()
    render(
      <BookDialog
        instruments={[]}
        workspaceId="ws-1"
        defaultDate="2026-10-12"
        onBooked={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Book instrument' }))
    expect(screen.getByText(/No instruments are registered/i)).toBeTruthy()
  })

  it("lists the workspace's instruments by INS display id and name", async () => {
    const user = userEvent.setup()
    renderDialog()

    await user.click(screen.getByRole('button', { name: 'Book instrument' }))
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: /Instrument/,
      }),
    )

    // ADR-0054 — the picker is the registry: every option is an instrument with
    // its display id and name.
    const dialogs = screen.getAllByRole('dialog')
    const options = within(dialogs[dialogs.length - 1])
      .getAllByRole('option')
      .map((option) => option.textContent)
    expect(options).toEqual([
      'INS-0007Plate reader PR-01',
      'INS-0009Thermocycler PCR-02',
    ])
  })

  it('explains an unqualified refusal and links to the instrument', async () => {
    rpc.mockRejectedValueOnce(
      new DataClientError(
        'SB115',
        'a current qualification is required to book this instrument',
        400,
      ),
    )
    const user = userEvent.setup()
    const { onBooked } = renderDialog()

    const dialog = await openAndFill(user)
    await user.click(within(dialog).getByRole('button', { name: 'Book' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(
      'You’re not qualified to run Plate reader PR-01',
    )
    expect(alert.textContent).toContain('An admin can grant')
    expect(
      within(alert)
        .getByRole('link', { name: 'Open the instrument' })
        .getAttribute('href'),
    ).toBe('/instruments/res-pr01')
    expect(onBooked).not.toHaveBeenCalled()
    // The refusal leaves the dialog open so the reason stays visible.
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('offers to ask the owners for the qualification', async () => {
    rpc.mockRejectedValueOnce(
      new DataClientError(
        'SB115',
        'a current qualification is required to book this instrument',
        400,
      ),
    )
    rpc.mockResolvedValueOnce({
      id: '00000000-0000-4000-8000-000000000a01',
      instrument_id: '00000000-0000-4000-8000-000000000a02',
      user_id: 'u-1',
      note: null,
      status: 'pending',
      created_at: '2026-10-20T08:00:00Z',
      updated_at: '2026-10-20T08:00:00Z',
    })
    const user = userEvent.setup()
    renderDialog()

    const dialog = await openAndFill(user)
    await user.click(within(dialog).getByRole('button', { name: 'Book' }))
    const alert = await screen.findByRole('alert')
    await user.click(
      within(alert).getByRole('button', { name: 'Request qualification' }),
    )

    expect(rpc).toHaveBeenLastCalledWith('request_instrument_qualification', {
      p_instrument_id: 'res-pr01',
      p_note: null,
    })
    expect(
      await within(alert).findByRole('button', {
        name: 'Qualification requested',
      }),
    ).toBeTruthy()
  })

  it('explains an overdue-calibration refusal and links to recording it', async () => {
    rpc.mockRejectedValueOnce(
      new DataClientError(
        'SB116',
        'the instrument calibration is overdue',
        400,
      ),
    )
    const user = userEvent.setup()
    renderDialog()

    const dialog = await openAndFill(user)
    await user.click(within(dialog).getByRole('button', { name: 'Book' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('calibration is overdue')
    expect(
      within(alert)
        .getByRole('link', { name: 'Record the calibration' })
        .getAttribute('href'),
    ).toBe('/instruments/res-pr01?record=1')
  })

  it('surfaces the overlap when the server refuses a clash', async () => {
    rpc.mockRejectedValueOnce(
      new DataClientError(
        'SB020',
        'booking overlaps with Priya S. (EXP-0138 ddPCR prep)',
        409,
      ),
    )
    const user = userEvent.setup()
    renderDialog()

    const dialog = await openAndFill(user)
    await user.click(within(dialog).getByRole('button', { name: 'Book' }))

    expect((await screen.findByRole('alert')).textContent).toMatch(
      /overlaps with an existing booking/i,
    )
  })

  it('requires an instrument and a label before calling the RPC', async () => {
    rpc.mockResolvedValueOnce(WIRE)
    const user = userEvent.setup()
    renderDialog()

    await user.click(screen.getByRole('button', { name: 'Book instrument' }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Book' }))

    expect((await screen.findByRole('alert')).textContent).toMatch(
      /choose an instrument/i,
    )
    expect(rpc).not.toHaveBeenCalled()
  })
  it('carries the experiment and the ticked samples onto the booking', async () => {
    rpc.mockResolvedValueOnce({
      ...WIRE,
      linked_experiment_record_id: 'exp-1',
      linked_experiment_identifier: 'EXP-0145',
      linked_experiment_title: 'Titration',
    })
    const user = userEvent.setup()
    const onBooked = vi.fn()
    render(
      <BookDialog
        instruments={INSTRUMENTS}
        workspaceId="ws-1"
        defaultDate="2026-10-12"
        onBooked={onBooked}
        experiment={{ id: 'exp-1', identifier: 'EXP-0145', title: 'Titration' }}
        sampleOptions={[
          { id: 's-1', identifier: 'SMP-1', title: 'Lysate A' },
          { id: 's-2', identifier: 'SMP-2', title: 'Lysate B' },
        ]}
      />,
    )

    const dialog = await openAndFill(user)
    // The experiment is named and links to its page.
    expect(
      within(dialog)
        .getByRole('link', { name: 'EXP-0145' })
        .getAttribute('href'),
    ).toBe('/experiments/exp-1')
    // Both samples start ticked; the run does not need the second one.
    const [first, second] = within(dialog).getAllByRole('checkbox')
    expect(first.getAttribute('aria-checked')).toBe('true')
    await user.click(second)
    await user.click(within(dialog).getByRole('button', { name: 'Book' }))

    await vi.waitFor(() =>
      expect(rpc).toHaveBeenCalledWith(
        'create_booking',
        expect.objectContaining({
          p_linked_experiment_record_id: 'exp-1',
          p_samples: [
            expect.objectContaining({
              sampleRecordId: 's-1',
              sampleIdentifier: 'SMP-1',
            }),
          ],
        }),
      ),
    )
    await vi.waitFor(() =>
      expect(onBooked).toHaveBeenCalledWith(
        expect.objectContaining({
          experiment: {
            id: 'exp-1',
            identifier: 'EXP-0145',
            title: 'Titration',
          },
        }),
      ),
    )
  })
})
