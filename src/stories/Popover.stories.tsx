import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '#/components/ui/popover'

const meta = {
  title: 'UI/Popover',
  component: Popover,
  tags: ['autodocs'],
} satisfies Meta<typeof Popover>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {
  render: () => (
    <Popover defaultOpen>
      <PopoverTrigger asChild>
        <Button variant="outline">Open popover</Button>
      </PopoverTrigger>
      <PopoverContent>
        <p className="mb-2 text-sm font-medium">Set dimensions</p>
        <Input defaultValue="250 µL" />
      </PopoverContent>
    </Popover>
  ),
}
export const Open: Story = {
  render: () => (
    <Popover open>
      <PopoverTrigger asChild>
        <Button variant="outline">Details</Button>
      </PopoverTrigger>
      <PopoverContent align="start">
        <strong>Experiment details</strong>
        <p className="text-sm text-muted-foreground">
          Last updated five minutes ago.
        </p>
      </PopoverContent>
    </Popover>
  ),
}
