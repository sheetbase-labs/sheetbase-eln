import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { LoadMore } from '#/components/v3/ui/load-more'

/**
 * The tail of a growing-window list.
 *
 * The states are the ones the six hand-rolled controls spelled differently:
 * a count line and a live control (the compare view), the same control while
 * the next page is in flight (four different labels before), a failed read
 * (which only one screen offered a retry for), and the exhausted end (which
 * only the audit log said anything about).
 */
const meta = {
  title: 'v3 kit/Load more',
  component: LoadMore,
  parameters: { layout: 'padded' },
  args: {
    label: 'Comparison changes',
    hasMore: true,
    loaded: 100,
    total: 250,
    noun: 'changes',
    onLoadMore: () => {},
  },
} satisfies Meta<typeof LoadMore>
export default meta
type Story = StoryObj<typeof meta>

/** The count and the control, which is the compare view's tail. */
export const Ready: Story = {}

/** The next page in flight. */
export const Loading: Story = { args: { loading: true } }

/** A failed read: what the search screen and the rows grid had no state for. */
export const Failed: Story = {
  args: { error: 'Could not read the rest of the comparison.' },
}

/** Nothing more to read, with the screen's own closing line. */
export const Exhausted: Story = {
  args: {
    hasMore: false,
    loaded: 250,
    endLabel: 'End of the log — every matching entry is loaded.',
  },
}

/** No count: the screens that print the count themselves pass none. */
export const WithoutCount: Story = {
  args: { loaded: undefined, total: undefined, noun: undefined },
}
