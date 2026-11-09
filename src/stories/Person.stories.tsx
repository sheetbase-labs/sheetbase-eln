import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { Person } from '#/components/ui/person'

/** A person's avatar beside their name — the way every list, table and picker names a user. */
const meta = {
  title: 'UI/Person',
  component: Person,
  tags: ['autodocs'],
} satisfies Meta<typeof Person>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { name: 'Gareth Price', userId: 'u1' },
}

export const WithTag: Story = {
  args: {
    name: 'Mia Chen',
    userId: 'u2',
    children: <span className="text-fg-muted">(you)</span>,
  },
}
