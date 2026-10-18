import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { LinkToPills } from '#/components/record/inspector-sections'
import type { LinkToItem } from '#/components/record/inspector-sections'

const items: LinkToItem[] = [
  { label: 'Samples', count: 3, icon: 'tube', onClick: () => {} },
  { label: 'Protocol', count: 1, icon: 'protocol', onClick: () => {} },
  { label: 'Datasets', count: 0, icon: 'database' },
]

const meta = {
  title: 'Record/Inspector sections/Link to pills',
  component: LinkToPills,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
  args: { items },
} satisfies Meta<typeof LinkToPills>
export default meta
type Story = StoryObj<typeof meta>

/** A zero count drops the count suffix but keeps the control. */
export const Default: Story = {}

export const Empty: Story = { args: { items: [] } }

export const Wrapping: Story = {
  args: {
    items: [
      ...items,
      { label: 'Files', count: 12, icon: 'download' },
      { label: 'Comments', count: 4 },
      { label: 'Revisions', count: 7 },
    ],
  },
}
