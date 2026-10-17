import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { screen, userEvent, within } from 'storybook/test'

import { BookDialog } from '#/components/v3/schedule/book-dialog'
import type { ScheduleInstrument } from '#/components/v3/schedule/schedule-data'
import { DataClientError } from '#/lib/data-client'
import { StubDataClient } from './screen-stories'
import type { DataClientStub } from './screen-stories'

/**
 * WORK-04.2 — the book-instrument dialog (`src/components/v3/schedule/`).
 *
 * It collects the instrument, a label and a wall-clock range, and submits
 * through `create_booking`; availability, qualification and calibration stay
 * the server's authority, so the stories below show the states the dialog
 * actually has: open with the workspace's instruments, an empty registry, the
 * client-side input refusal, and the server's own refusal of a clashing slot.
 *
 * The dialog reads the workspace time zone imperatively through the shared
 * data client, so every story stubs that read (and the booking RPC) — no
 * request leaves the page.
 */
const INSTRUMENTS: ScheduleInstrument[] = [
  {
    id: '0198d970-e266-4000-8000-0000000a0001',
    displayId: 'INS-0007',
    name: 'Plate reader PR-01',
  },
  {
    id: '0198d970-e266-4000-8000-0000000a0002',
    displayId: 'INS-0009',
    name: 'Thermocycler PCR-02',
  },
]

const ZONE: DataClientStub = {
  list: async () => [{ timezone: 'Europe/London' }],
}

const ZONE_UNAVAILABLE: DataClientStub = {
  list: async () => {
    throw new Error('settings unavailable')
  },
}

const CLASHING: DataClientStub = {
  list: ZONE.list,
  rpc: async () => {
    throw new DataClientError(
      'SB020',
      'This time overlaps with an existing booking for that resource.',
      409,
    )
  },
}

const meta = {
  title: 'Schedule/Book dialog',
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

function Dialog({
  instruments,
  stub,
}: {
  instruments: ScheduleInstrument[]
  stub: DataClientStub
}) {
  return (
    <StubDataClient stub={stub}>
      <BookDialog
        instruments={instruments}
        defaultDate="2026-10-12"
        workspaceId="0198d970-e266-4000-8000-000000000009"
        onBooked={() => {}}
        defaultOpen
      />
    </StubDataClient>
  )
}

/** Open with the workspace's instruments; the zone names the clock From/To mean. */
export const Open: Story = {
  render: () => <Dialog instruments={INSTRUMENTS} stub={ZONE} />,
  play: async () => {
    await screen.findByText(/workspace time zone, Europe\/London/)
    await screen.findByRole('option', { name: 'INS-0007 · Plate reader PR-01' })
  },
}

/** A registry with nothing in it says what is missing instead of a dead picker. */
export const NoInstruments: Story = {
  render: () => <Dialog instruments={[]} stub={ZONE} />,
  play: async () => {
    await screen.findByText(/No instruments are registered in this workspace/)
  },
}

/** Submitting an empty form is refused in the dialog; nothing is written. */
export const IncompleteRefusal: Story = {
  render: () => <Dialog instruments={INSTRUMENTS} stub={ZONE} />,
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Book' }))
    await screen.findByText(
      'Choose an instrument and give the booking a title.',
    )
  },
}

/** The server's clash refusal is surfaced, not guessed at in the dialog. */
export const RefusedByServer: Story = {
  render: () => <Dialog instruments={INSTRUMENTS} stub={CLASHING} />,
  play: async () => {
    const dialog = await screen.findByRole('dialog')
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: /Instrument/ }),
      INSTRUMENTS[0].id,
    )
    await userEvent.type(within(dialog).getByLabelText(/What/), 'ELISA plate 5')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Book' }))
    await screen.findByText(
      'This time overlaps with an existing booking for that resource.',
    )
  },
}

/** An unreadable workspace zone refuses the booking rather than writing an instant. */
export const TimeZoneUnavailable: Story = {
  render: () => <Dialog instruments={INSTRUMENTS} stub={ZONE_UNAVAILABLE} />,
  play: async () => {
    const dialog = await screen.findByRole('dialog')
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: /Instrument/ }),
      INSTRUMENTS[0].id,
    )
    await userEvent.type(within(dialog).getByLabelText(/What/), 'ELISA plate 5')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Book' }))
    await screen.findByText(
      /time zone could not be read, so the booking was not created/,
    )
  },
}
