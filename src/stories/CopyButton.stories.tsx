import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { CopyButton } from '#/components/v3/ui/copy-button'
import { Muted } from '#/components/v3/ui/layout'

/**
 * Copy one value, and report what actually happened — a refused or unavailable
 * clipboard means no copy happened, and the toast says so rather than
 * confirming one.
 */
const meta = {
  title: 'UI/CopyButton',
  component: CopyButton,
  tags: ['autodocs'],
  args: { value: 'sb_live_7f3c9a12', children: 'Copy' },
} satisfies Meta<typeof CopyButton>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

/** Icon-only: then the accessible name is the caller's job. */
export const IconOnly: Story = {
  args: {
    children: undefined,
    size: 'icon',
    'aria-label': 'Copy request ID 01JC9F4W2K',
  },
}

/** Beside the value it copies, which is the shape five screens use. */
export const BesideAValue: Story = {
  render: () => (
    <div className="flex w-96 items-center gap-2 rounded-md border border-border bg-surface-muted py-1.5 pl-2.5 pr-1.5">
      <code className="min-w-0 flex-1 font-mono text-[12px] [overflow-wrap:anywhere]">
        01JC9F4W2K8N7P3Q6R1S5T9V
      </code>
      <CopyButton value="01JC9F4W2K8N7P3Q6R1S5T9V">Copy</CopyButton>
    </div>
  ),
}

/** The messages are the surface's; the honesty rule is the component's. */
export const CustomMessages: Story = {
  args: {
    value: 'https://app.sheetbase.co.uk/projects/prj-1',
    copiedMessage: 'Link to this view copied',
    failedMessage: 'Could not copy the link. Copy it from the address bar.',
  },
  render: (args) => (
    <div className="flex flex-col gap-2">
      <CopyButton {...args}>Copy link</CopyButton>
      <Muted>Try it with the clipboard blocked to see the failure path.</Muted>
    </div>
  ),
}
