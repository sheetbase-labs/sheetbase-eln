import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { LoadMore } from '#/components/ui/load-more'

/**
 * The tail of a growing-window list. The next page loads as the tail scrolls
 * into view, so the control only shows a quiet loading line, or a retry when a
 * read failed.
 */
const meta = {
  title: 'UI/Load more',
  component: LoadMore,
  parameters: { layout: 'padded' },
  args: {
    label: 'Comparison changes',
    hasMore: true,
    onLoadMore: () => {},
  },
} satisfies Meta<typeof LoadMore>

export default meta

type Story = StoryObj<typeof meta>

/** Waiting for the tail to scroll into view. */
export const Ready: Story = {}

/** The next page in flight. */
export const Loading: Story = { args: { loading: true } }

/** A failed read, with a retry. */
export const Failed: Story = {
  args: { error: 'Could not read the rest of the comparison.' },
}
