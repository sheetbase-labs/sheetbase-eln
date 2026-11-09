import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { BookingRulesSection } from '#/components/instruments/booking-rules'
import type { InstrumentRow } from '#/components/instruments/instruments-data'
import { SubscribeDialog } from '#/components/schedule/subscribe-dialog'
import { bookingRuleKeys } from '#/lib/booking-rules'
import type { BookingRules } from '#/lib/booking-rules'
import { calendarFeedKeys } from '#/lib/calendar-feeds'
import { screenQueryClient, withApiReads } from './screen-stories'

/**
 * Who may book an instrument, and how people follow the bookings in their own
 * calendar. Reads are seeded; nothing here is written.
 */
const instrument: InstrumentRow = {
  id: 'inst-1',
  displayId: 'PR-01',
  name: 'Plate reader',
  instrumentType: 'plate_reader',
  model: null,
  serialNumber: null,
  vendor: null,
  location: null,
  ownerId: null,
  retiredAt: null,
  intakeMethod: 'manual',
  position: 0,
  updatedAt: '2026-11-01T09:00:00Z',
}

const rules: BookingRules = {
  maxBookingMinutes: 120,
  maxAdvanceDays: 30,
  training: [
    { protocolId: 'p1', identifier: 'SOP-12', title: 'Plate reader use' },
  ],
}

const meta = {
  title: 'Instruments/Booking rules',
  component: BookingRulesSection,
  decorators: [
    withApiReads('pending'),
    (Story) => (
      <QueryClientProvider
        client={screenQueryClient({
          data: [
            { key: bookingRuleKeys.forInstrument('inst-1'), value: rules },
            { key: calendarFeedKeys.all, value: [] },
          ],
        })}
      >
        <div className="p-6">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
  args: { instrument, canManage: true },
} satisfies Meta<typeof BookingRulesSection>

export default meta

type Story = StoryObj<typeof meta>

/** Rules set: training, a length limit and how far ahead. */
export const WithRules: Story = {}

/** A reader who cannot change the rules. */
export const ReadOnly: Story = { args: { canManage: false } }

/** The calendar subscription button beside the schedule. */
export const Subscribe: Story = {
  render: () => (
    <SubscribeDialog
      instruments={[{ id: 'inst-1', displayId: 'PR-01', name: 'Plate reader' }]}
    />
  ),
}
