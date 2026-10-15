import type { Meta, StoryObj } from '@storybook/tanstack-react'
// Loader2 is a spinner; the v3 set has no spinner icon.
import { Loader2 } from 'lucide-react'

import { Icon } from '#/components/v3/icons'
import { Button } from '#/components/v3/ui/button'

/**
 * The v3 button set: 28px (`md`, the default), border before shadow, and one
 * decisive blue for the primary action. `sm` is 24px inside dense rows.
 */
const meta = {
  title: 'UI/Button',
  component: Button,
  tags: ['autodocs'],
  args: { children: 'Button' },
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

export const Secondary: Story = {}
export const Primary: Story = { args: { variant: 'primary' } }
export const Quiet: Story = { args: { variant: 'quiet' } }
export const Danger: Story = { args: { variant: 'danger' } }
export const DangerFill: Story = { args: { variant: 'danger-fill' } }

export const WithIcon: Story = {
  render: () => <Button icon="plus">Create experiment</Button>,
}

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      {(
        ['secondary', 'primary', 'quiet', 'danger', 'danger-fill'] as const
      ).map((variant) => (
        <Button key={variant} variant={variant}>
          {variant}
        </Button>
      ))}
    </div>
  ),
}

export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <Button size="sm">Small</Button>
      <Button size="md">Medium</Button>
      <Button size="lg">Large</Button>
      <Button size="icon" aria-label="Add">
        <Icon name="plus" />
      </Button>
      <Button size="icon-lg" aria-label="Add">
        <Icon name="plus" />
      </Button>
    </div>
  ),
}

export const States: Story = {
  render: () => (
    <div className="flex gap-2">
      <Button disabled>Disabled</Button>
      <Button disabled>
        <Loader2 className="animate-spin" /> Saving…
      </Button>
    </div>
  ),
}
