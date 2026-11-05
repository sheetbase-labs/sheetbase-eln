import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DataClientError } from '#/lib/data-client'
import type { CalendarBookingWire } from '#/lib/calendar'
import type { DataClient } from '#/lib/data-client'

import { EditBookingDialog } from './edit-booking-dialog'
import type { ScheduleBooking } from './schedule-data'

afterEach(cleanup)

const BOOKING: ScheduleBooking = {
  id: 'b-1',
  resourceId: 'res-1',
  title: 'ELISA plate 5',
  date: '2026-10-12',
  start: '14:00',
  end: '16:00',
  timezone: 'Europe/London',
  createdByUserId: 'u-1',
  notes: null,
  metadataVersion: 3,
}

const WIRE: CalendarBookingWire = {
  id: 'b-1',
  workspace_id: 'ws-1',
  resource_id: 'res-1',
  project_id: null,
  title: 'ELISA plate 5 (moved)',
  status: 'tentative',
  all_day: false,
  starts_at: '2026-10-13T08:00:00.000Z',
  ends_at: '2026-10-13T10:00:00.000Z',
  timezone: 'Europe/London',
  location: null,
  color: null,
  notes: 'Bring the reader plate',
  linked_experiment_record_id: null,
  linked_experiment_identifier: null,
  linked_experiment_title: null,
  metadata_version: 4,
  cancelled_at: null,
  created_at: '',
  updated_at: '',
  created_by_user_id: 'u-1',
  updated_by_user_id: 'u-1',
}

function mount(rpc: (...args: unknown[]) => Promise<unknown>, extra = {}) {
  const onSaved = vi.fn()
  render(
    <EditBookingDialog
      booking={BOOKING}
      client={{ rpc } as unknown as DataClient}
      onSaved={onSaved}
      onClose={() => {}}
      {...extra}
    />,
  )
  return onSaved
}

describe('EditBookingDialog', () => {
  it('starts from the booking and saves a new time in the booking zone', async () => {
    const rpc = vi.fn(async (..._args: unknown[]) => WIRE)
    const onSaved = mount(rpc)
    expect(screen.getByLabelText<HTMLInputElement>(/^What/).value).toBe(
      'ELISA plate 5',
    )
    fireEvent.change(screen.getByLabelText(/^What/), {
      target: { value: 'ELISA plate 5 (moved)' },
    })
    fireEvent.change(screen.getByLabelText(/^Date/), {
      target: { value: '2026-10-13' },
    })
    fireEvent.change(screen.getByLabelText(/^From/), {
      target: { value: '09:00' },
    })
    fireEvent.change(screen.getByLabelText(/^To/), {
      target: { value: '11:00' },
    })
    fireEvent.change(screen.getByLabelText(/^Notes/), {
      target: { value: 'Bring the reader plate' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(rpc).toHaveBeenCalledWith(
      'edit_booking',
      expect.objectContaining({
        p_booking_id: 'b-1',
        p_title: 'ELISA plate 5 (moved)',
        // 09:00 on 13 October in London (BST) is 08:00 UTC.
        p_starts_at: '2026-10-13T08:00:00.000Z',
        p_ends_at: '2026-10-13T10:00:00.000Z',
        p_timezone: 'Europe/London',
        p_notes: 'Bring the reader plate',
        p_expected_metadata_version: 3,
        p_samples: null,
      }),
    )
    expect(onSaved.mock.calls[0][0]).toMatchObject({
      title: 'ELISA plate 5 (moved)',
      start: '09:00',
      metadataVersion: 4,
    })
  })

  it('shows the server reason when the time clashes', async () => {
    const rpc = vi.fn(async (..._args: unknown[]) => {
      throw new DataClientError('SB020', 'overlaps', 409)
    })
    const onSaved = mount(rpc)
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect((await screen.findByRole('alert')).textContent).toBe(
      'This time overlaps with an existing booking for that resource.',
    )
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('refuses an end before the start without calling the server', () => {
    const rpc = vi.fn(async (..._args: unknown[]) => WIRE)
    mount(rpc)
    fireEvent.change(screen.getByLabelText(/^To/), {
      target: { value: '13:00' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(screen.getByRole('alert').textContent).toMatch(
      /end time must be after the start/i,
    )
    expect(rpc).not.toHaveBeenCalled()
  })

  it('sends the ticked samples when there is a choice to make', async () => {
    const rpc = vi.fn(async (..._args: unknown[]) => WIRE)
    mount(rpc, {
      sampleOptions: [
        { id: 's-1', identifier: 'SMP-1', title: 'A' },
        { id: 's-2', identifier: 'SMP-2', title: 'B' },
      ],
      currentSampleIds: ['s-1'],
    })
    fireEvent.click(screen.getAllByRole('checkbox')[1])
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await vi.waitFor(() => expect(rpc).toHaveBeenCalled())
    const args = rpc.mock.calls[0][1] as {
      p_samples: { sampleRecordId: string }[]
    }
    expect(args.p_samples.map((s) => s.sampleRecordId)).toEqual(['s-1', 's-2'])
  })
})
