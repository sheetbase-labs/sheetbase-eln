import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { Skeleton } from '#/components/v3/ui/skeleton'

/**
 * The placeholder a pending read renders. It is `aria-hidden` by design: the
 * region around it says what is loading, and a screen reader announcing a stack
 * of empty boxes adds nothing.
 */
const meta = {
  title: 'v3 kit/Skeleton',
  component: Skeleton,
  tags: ['autodocs'],
} satisfies Meta<typeof Skeleton>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => <Skeleton className="h-3.5 w-40" />,
}

/** Several lines at the widths prose takes, not one uniform bar. */
export const ProseLines: Story = {
  render: () => (
    <div className="flex w-[520px] flex-col gap-2">
      <Skeleton className="h-3.5 w-full" />
      <Skeleton className="h-3.5 w-[92%]" />
      <Skeleton className="h-3.5 w-[64%]" />
    </div>
  ),
}

/** A list that is loading keeps its row rhythm, so nothing jumps when it lands. */
export const List: Story = {
  render: () => (
    <div className="w-[520px] divide-y divide-border-subtle rounded-md border border-border">
      {[0, 1, 2, 3].map((row) => (
        <div key={row} className="flex h-11 items-center gap-3 px-4">
          <Skeleton className="size-6 rounded-full" />
          <Skeleton className="h-3.5 w-40" />
          <Skeleton className="ml-auto h-3.5 w-16" />
        </div>
      ))}
    </div>
  ),
}

/** A pending figure keeps its frame, which is what stops the page reflowing. */
export const Figure: Story = {
  render: () => (
    <div className="w-[520px] overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex h-9 items-center gap-2 border-b border-border-subtle px-3">
        <Skeleton className="h-3.5 w-48" />
      </div>
      <div className="p-4">
        <Skeleton className="h-[180px] w-full" />
      </div>
    </div>
  ),
}
