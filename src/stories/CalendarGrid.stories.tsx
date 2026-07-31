import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { CalendarGrid } from '#/components/calendar/calendar-views'

const cursor = new Date('2026-07-29T12:00:00Z')
const bookings: any[] = [
  {
    id: 'b1',
    title: 'LC-MS cal',
    startsAt: '2026-07-27T09:00:00Z',
    endsAt: '2026-07-27T11:00:00Z',
    status: 'confirmed',
    color: 'blue',
  },
  {
    id: 'b2',
    title: 'qPCR stability',
    startsAt: '2026-07-29T10:00:00Z',
    endsAt: '2026-07-29T13:00:00Z',
    status: 'confirmed',
    color: 'green',
  },
  {
    id: 'b3',
    title: 'Confocal',
    startsAt: '2026-07-30T14:00:00Z',
    endsAt: '2026-07-30T18:00:00Z',
    status: 'confirmed',
    color: 'purple',
  },
]
const meta = {
  title: 'Calendar/Calendar grid',
  component: CalendarGrid,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  args: {
    view: 'week',
    cursor,
    timeZone: 'UTC',
    bookings,
    resources: [],
    selectedBookingId: 'b2',
    onSelectBooking: () => {},
  },
} satisfies Meta<typeof CalendarGrid>
export default meta
type Story = StoryObj<typeof meta>
export const Week: Story = {}
export const Day: Story = { args: { view: 'day' } }
export const Month: Story = {
  args: {
    view: 'month',
    bookings: bookings.map((b) =>
      b.id === 'b3' ? { ...b, status: 'cancelled' } : b,
    ),
  },
}
export const Empty: Story = { args: { bookings: [] } }
