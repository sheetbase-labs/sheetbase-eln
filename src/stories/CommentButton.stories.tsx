import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { CommentButton } from '#/components/collaboration/comment-button'

/** COLLAB-02 comment affordance: a quiet icon button with an unresolved count. */
const meta = {
  title: 'Collaboration/Comment button',
  component: CommentButton,
  tags: ['autodocs'],
  args: { count: 3, label: 'Comments on block', onClick: () => {} },
} satisfies Meta<typeof CommentButton>
export default meta
type Story = StoryObj<typeof meta>

/** With unresolved comments the badge appears. */
export const Default: Story = {}

/** A count above nine collapses to `9+`. */
export const ManyComments: Story = { args: { count: 14 } }

/** No unresolved comments: no badge, the affordance stays. */
export const NoComments: Story = { args: { count: 0 } }

/** Badges count to `9+` inclusive of the boundary. */
export const Boundary: Story = { args: { count: 9 } }

/** In a header row, which is where callers place it. */
export const InHeaderRow: Story = {
  render: (args) => (
    <div className="flex w-80 items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
      <span className="text-xs font-medium text-fg">Results</span>
      <CommentButton {...args} />
    </div>
  ),
}
