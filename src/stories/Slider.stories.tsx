import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { Slider } from '#/components/ui/slider'

const meta = {
  title: 'UI/Slider',
  component: Slider,
  tags: ['autodocs'],
  args: { defaultValue: [40], max: 100, step: 1, className: 'w-96' },
} satisfies Meta<typeof Slider>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {}
export const Range: Story = { args: { defaultValue: [20, 75] } }
export const Disabled: Story = { args: { disabled: true, defaultValue: [60] } }
