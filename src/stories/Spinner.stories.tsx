import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { Spinner } from '#/components/v3/ui/spinner'

/**
 * The single working indicator. The neighbours own the meaning: a spinner beside
 * "Saving…" is `aria-hidden` and the text is what a screen reader reads; a
 * spinner standing alone takes a `label` and becomes a polite live region.
 */
const meta = {
  title: 'UI/Spinner',
  component: Spinner,
  tags: ['autodocs'],
} satisfies Meta<typeof Spinner>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-5">
      <Spinner size={12} />
      <Spinner size={16} />
      <Spinner size={24} className="text-fg-muted" />
    </div>
  ),
}

export const WithVisibleLabel: Story = {
  render: () => (
    <div className="flex items-center gap-2 text-body">
      <Spinner size={14} />
      Calculating curve fit…
    </div>
  ),
}

/** No text beside it, so the spinner itself names the work. */
export const WithAccessibleLabel: Story = {
  args: { label: 'Loading results', size: 16 },
}

/**
 * A region that is loading says so on the region. `aria-busy` is what a screen
 * reader needs; the spinner is the visual restatement of it.
 */
export const BusyRegion: Story = {
  render: () => (
    <div
      aria-busy="true"
      aria-live="polite"
      className="w-72 rounded-md border border-border p-3"
    >
      <div className="flex items-center gap-2 text-body">
        <Spinner size={14} />
        Loading the run history…
      </div>
      <div className="mt-2 h-3 w-40 rounded-sm bg-skeleton" />
      <div className="mt-1.5 h-3 w-56 rounded-sm bg-skeleton" />
    </div>
  ),
}

/** The tones the migrated sites use: muted in body text, warning while retrying. */
export const Tones: Story = {
  render: () => (
    <div className="flex flex-col gap-2 text-body">
      <div className="flex items-center gap-2 text-fg-muted">
        <Spinner size={12} />
        Connecting…
      </div>
      <div className="flex items-center gap-2 text-warning-text">
        <Spinner size={12} />
        Reconnecting…
      </div>
    </div>
  ),
}
