import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { CommentList } from '#/components/record/inspector-sections'
import type { CommentItem } from '#/components/record/inspector-sections'

const items: CommentItem[] = [
  {
    id: 'c1',
    author: { name: 'Marco Silva', initials: 'MS' },
    body: 'Ct values for the 25 °C arm sit below the detection threshold after 48 hours.',
    at: '29 Jul 2026, 11:52',
  },
  {
    id: 'c2',
    author: { name: 'Ava Chen' },
    body: 'Noted — I will re-run the plate with the extended standard curve.',
    at: '29 Jul 2026, 13:14',
  },
]

const meta = {
  title: 'Record/Inspector sections/Comment list',
  component: CommentList,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
  args: { items },
} satisfies Meta<typeof CommentList>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Empty: Story = { args: { items: [] } }

/** A long unbroken body wraps instead of overflowing the column. */
export const LongBody: Story = {
  args: {
    items: [
      {
        id: 'c3',
        author: { name: 'Priya Raman', initials: 'PR' },
        body: 'Repeat composition analysis of the clarified harvest material before the next stability withdrawal, and record the ratio in the notebook so the reviewer can compare batches without leaving the revision.',
        at: '30 Jul 2026, 09:41',
      },
    ],
  },
}
