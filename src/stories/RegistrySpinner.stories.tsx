import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { Spinner } from '#/components/reui/spinner'

/**
 * The registry's working indicator, kept beside the adopted item as its declined
 * counterpart. It is stock shadcn (`spinner` is not a ReUI item; the pinned
 * registry 404s), a Lucide `Loader2` with `animate-spin`, a fixed `size-4` and
 * its accessible name hard-set to "Loading".
 *
 * The comparison that declined it is row 9 of
 * `docs/knowledge/design/component-comparison-record.md`: the in-house
 * `src/components/v3/ui/spinner.tsx` owns the job, and the one thing this item
 * has that ours did not — `motion-reduce:animate-none` — was the fix adopted.
 * The story stays so the declined candidate is reviewable in the repository.
 */
const meta = {
  title: 'UI/Registry spinner',
  component: Spinner,
  tags: ['autodocs'],
} satisfies Meta<typeof Spinner>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

/** The item animates unconditionally, so it spins at every size given it. */
export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-5">
      <Spinner className="size-3" />
      <Spinner />
      <Spinner className="size-6" />
    </div>
  ),
}

/** Beside a sentence, the label is what a screen reader reads, not the sequel. */
export const BesideSentence: Story = {
  render: () => (
    <div className="flex items-center gap-2 text-body">
      <Spinner className="size-3.5" />
      Calculating curve fit…
    </div>
  ),
}

/** On the inverse surface, as the app's toasts would carry it. */
export const OnInverseSurface: Story = {
  render: () => (
    <div className="inline-flex items-center gap-2 rounded-lg bg-inverse px-3.5 py-1.5 text-body text-inverse-foreground">
      <Spinner className="size-3.5" />
      Saving…
    </div>
  ),
}
