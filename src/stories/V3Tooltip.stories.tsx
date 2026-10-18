import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { Button } from '#/components/v3/ui/button'
import { Kbd } from '#/components/v3/ui/kbd'
import { Tooltip, TooltipProvider } from '#/components/v3/ui/tooltip'

/**
 * A one-line explanation of an icon-only control. It appears on hover and on
 * focus, so a keyboard reader gets it too, and it never carries a second
 * interaction — anything clickable inside a tooltip is unreachable.
 *
 * The legacy `UI/Tooltip` story covers `src/components/ui/tooltip.tsx`.
 */
const meta = {
  title: 'v3 kit/Tooltip',
  component: Tooltip,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <TooltipProvider>
        <Story />
      </TooltipProvider>
    ),
  ],
  args: {
    content: 'Copy the table as TSV',
    children: <Button icon="copy" aria-label="Copy the table as TSV" />,
  },
} satisfies Meta<typeof Tooltip>
export default meta
type Story = StoryObj<typeof meta>

/** The common case: an icon-only control that needs its name in words. */
export const OnAnIconButton: Story = {
  render: () => (
    <Tooltip content="Copy the table as TSV">
      <Button icon="copy" aria-label="Copy the table as TSV" />
    </Tooltip>
  ),
}

/** A hint with a key in it, for the control that has a shortcut. */
export const WithAKeyHint: Story = {
  render: () => (
    <Tooltip
      content={
        <span className="flex items-center gap-1.5">
          Search <Kbd>⌘K</Kbd>
        </span>
      }
    >
      <Button icon="search" aria-label="Search" />
    </Tooltip>
  ),
}

/** Disabled controls still explain why: the wrapper carries the hint. */
export const OnADisabledControl: Story = {
  render: () => (
    <Tooltip content="Signing needs a saved version. Save first.">
      <span tabIndex={0} className="inline-flex">
        <Button disabled>Sign section</Button>
      </span>
    </Tooltip>
  ),
}
