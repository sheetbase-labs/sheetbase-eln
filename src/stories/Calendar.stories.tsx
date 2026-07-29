import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { useState } from 'react'
import type { DateRange } from 'react-day-picker'
import { Calendar } from '#/components/ui/calendar'

const meta = { title: 'UI/Calendar', component: Calendar, tags: ['autodocs'] } satisfies Meta<typeof Calendar>
export default meta
type Story = StoryObj<typeof meta>
const Single = ({ initial }: { initial?: Date }) => { const [selected, setSelected] = useState<Date | undefined>(initial); return <Calendar mode="single" selected={selected} onSelect={setSelected} /> }
export const Default: Story = { render: () => <Single /> }
export const WithSelectedDate: Story = { render: () => <Single initial={new Date(2026, 6, 29)} /> }
export const DisabledDates: Story = { render: () => <Calendar mode="single" defaultMonth={new Date(2026, 6)} disabled={(date) => date.getDay() === 0 || date.getDay() === 6} /> }
export const Range: Story = { render: () => { const [selected, setSelected] = useState<DateRange | undefined>({ from: new Date(2026, 6, 10), to: new Date(2026, 6, 18) }); return <Calendar mode="range" selected={selected} onSelect={setSelected} /> } }
