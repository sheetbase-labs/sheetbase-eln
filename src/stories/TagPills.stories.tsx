import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { TagPills } from '#/components/record/inspector-sections'

const meta = {
  title: 'Record/Inspector sections/Tag pills',
  component: TagPills,
  tags: ['autodocs'],
  args: { tags: ['stability', 'lentivector', '4 °C'] },
} satisfies Meta<typeof TagPills>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

/** The add control only appears when the caller can write tags. */
export const WithAdd: Story = { args: { onAdd: () => {} } }

/** Read-only with no tags: nothing renders, so mount needs no branch. */
export const Empty: Story = { args: { tags: [] } }

/** Empty but writable: the add button is the only affordance. */
export const EmptyWithAdd: Story = { args: { tags: [], onAdd: () => {} } }

/** Many tags wrap onto as many lines as the column needs. */
export const Wrapping: Story = {
  args: {
    tags: [
      'stability',
      'lentivector',
      '4 °C',
      'long-term',
      'panel-a',
      'panel-b',
      'reviewed',
      '2026-Q3',
    ],
  },
}
