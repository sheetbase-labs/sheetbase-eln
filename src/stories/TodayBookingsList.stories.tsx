import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { TodayBookingsList } from '#/components/home/today-bookings-list'

/**
 * Today's bookings (`src/components/home/today-bookings-list.tsx`).
 *
 * The one way Home, the quiet Home inspector and the phone's bookings section
 * state a booking: its start time, what it is and where.
 */
const meta = {
  title: 'Home/Today bookings',
  component: TodayBookingsList,
  args: {
    timeZone: 'Europe/London',
    bookings: [
      {
        id: 'b-1',
        title: 'Ambr 250, bay 2',
        location: 'Lab 2',
        startsAt: '2026-11-28T09:00:00Z',
      },
      {
        id: 'b-2',
        title: 'Plate reader',
        location: null,
        startsAt: '2026-11-28T13:30:00Z',
      },
    ],
  },
} satisfies Meta<typeof TodayBookingsList>

export default meta

type Story = StoryObj<typeof meta>

export const Today: Story = {}
