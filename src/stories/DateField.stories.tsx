import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { DateField } from '#/components/v3/ui/date-field'

/**
 * A day picked from a calendar and shown in the workspace's date format. The
 * value stays a bare `YYYY-MM-DD` day, so it round-trips through a URL or a
 * form like a native date input, without the browser's mm/dd/yyyy control.
 */
const meta = {
  title: 'UI/DateField',
  component: DateField,
  tags: ['autodocs'],
  args: { label: 'From', value: '', onChange: () => {} },
  render: (args) => {
    const [value, setValue] = useState(args.value)
    return (
      <div className="w-56">
        <DateField {...args} value={value} onChange={setValue} />
      </div>
    )
  },
} satisfies Meta<typeof DateField>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {}

export const WithDay: Story = { args: { value: '2026-09-25' } }
