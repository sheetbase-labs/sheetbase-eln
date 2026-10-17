import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { Pager } from '#/components/v3/ui/pager'

/**
 * The pager at the foot of a paged list.
 *
 * Every state the four hand-rolled footers disagreed about is a story: the
 * first page (where "Previous" used to be absent), the last page (where "Next"
 * used to be absent), and the single-page list, which every screen hides the
 * pager for. The two ends are the states that used to move the row and read as
 * a missing control.
 */
const linkFor = (page: number) => ({
  to: '/projects/$projectId/experiments' as const,
  params: { projectId: 'LVV-stability' },
  search: { page },
})

const meta = {
  title: 'v3 kit/Pager',
  component: Pager,
  parameters: { layout: 'padded' },
  args: {
    page: 1,
    pageCount: 4,
    start: 1,
    end: 25,
    total: 88,
    noun: 'experiments',
    linkFor,
  },
} satisfies Meta<typeof Pager>
export default meta
type Story = StoryObj<typeof meta>

/** Page 1: "Previous" is rendered and inert rather than missing. */
export const FirstPage: Story = {}

/** A page with both ways out of it live. */
export const MiddlePage: Story = {
  args: { page: 2, start: 26, end: 50 },
}

/** The last page: "Next" is rendered and inert. */
export const LastPage: Story = {
  args: { page: 4, start: 76, end: 88 },
}

/** One page of results — the state the screens hide the pager for. */
export const SinglePage: Story = {
  args: { page: 1, pageCount: 1, start: 1, end: 12, total: 12 },
}
