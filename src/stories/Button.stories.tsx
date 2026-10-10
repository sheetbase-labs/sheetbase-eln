import type { Meta, StoryObj } from '@storybook/tanstack-react'
// Loader2 is a spinner; the v3 set has no spinner icon.
import { Loader2 } from 'lucide-react'

import { Icon } from '#/components/icons'
import { Button } from '#/components/ui/button'

const meta = {
  title: 'UI/Button',
  component: Button,
  tags: ['autodocs'],
  args: { children: 'Button' },
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

export const Primary: Story = {}
export const Outline: Story = { args: { variant: 'outline' } }
export const Destructive: Story = { args: { variant: 'destructive' } }
export const WithIcon: Story = {
  render: () => (
    <Button>
      <Icon name="plus" /> Create experiment
    </Button>
  ),
}

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      {(
        [
          'default',
          'destructive',
          'outline',
          'secondary',
          'ghost',
          'link',
          'subtle',
        ] as const
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
      <Button>Default</Button>
      <Button size="lg">Large</Button>
      <Button size="icon" aria-label="Add">
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
