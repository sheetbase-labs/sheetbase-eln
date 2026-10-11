import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UserEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DataClientError } from '#/lib/data-client'
import type { CalendarBookingWire } from '#/lib/calendar'
import type * as NotebookData from '#/lib/notebook-data'

import { BookDialog } from './book-dialog'
import type { ScheduleBooking, ScheduleInstrument } from './schedule-data'

// The dialog submits through the canonical create_booking RPC; mock only the
// data client so the test can observe the RPC call and its params.
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('#/lib/notebook-data', async (importOriginal) => ({
  ...(await importOriginal<typeof NotebookData>()),
  notebookDataClient: { rpc, list: vi.fn() },
}))

afterEach(() => {
  cleanup()
  rpc.mockReset()
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
}

function renderDialog(onBooked = vi.fn()) {
  render(
    <BookDialog
      instruments={INSTRUMENTS}
      workspaceId="ws-1"
      defaultDate="2026-10-12"
      onBooked={onBooked}
    />,
  )
  return { onBooked }
}

async function openAndFill(
  user: UserEvent,
  { instrument = 'res-pr01', title = 'ELISA plate 5' } = {},
) {
  await user.click(screen.getByRole('button', { name: 'Book instrument' }))
  const dialog = screen.getByRole('dialog')
  await user.selectOptions(
    within(dialog).getByRole('combobox', { name: /Instrument/ }),
    instrument,
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
        p_starts_at: '2026-10-12T14:00:00.000Z',
        p_ends_at: '2026-10-12T16:00:00.000Z',
      }),
    )
    await vi.waitFor(() => expect(onBooked).toHaveBeenCalledWith(BOOKED))
  })

  it("lists the workspace's instruments by INS display id and name", async () => {
    const user = userEvent.setup()
    renderDialog()

    await user.click(screen.getByRole('button', { name: 'Book instrument' }))
    const select = within(screen.getByRole('dialog')).getByRole('combobox', {
      name: /Instrument/,
    })

    // ADR-0054 — the picker is the registry: every option is an instrument with
    // its display id, and the value submitted is the instrument id.
    const options = within(select)
      .getAllByRole('option')
      .map((option) => [option.getAttribute('value'), option.textContent])
    expect(options).toEqual([
      ['', 'Choose…'],
      ['res-pr01', 'INS-0007 · Plate reader PR-01'],
      ['res-pcr', 'INS-0009 · Thermocycler PCR-02'],
    ])
  })

  it("shows the server's reason when the booking is refused as unqualified", async () => {
    const reason = 'a current qualification is required to book this instrument'
    rpc.mockRejectedValueOnce(new DataClientError('SB115', reason, 400))
    const user = userEvent.setup()
    const { onBooked } = renderDialog()

    const dialog = await openAndFill(user)
    await user.click(within(dialog).getByRole('button', { name: 'Book' }))

    expect((await screen.findByRole('alert')).textContent).toContain(reason)
    expect(onBooked).not.toHaveBeenCalled()
    // The refusal leaves the dialog open so the reason stays visible.
    expect(screen.getByRole('dialog')).toBeTruthy()
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
})
