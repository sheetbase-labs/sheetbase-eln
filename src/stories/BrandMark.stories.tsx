import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { BrandMark } from '#/components/ui/brand-mark'

const meta = {
  title: 'UI/BrandMark',
  component: BrandMark,
  tags: ['autodocs'],
  args: { size: 48 },
} satisfies Meta<typeof BrandMark>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Sizes: Story = {
  render: () => (
    <span className="flex items-end gap-4 text-fg">
      <BrandMark size={16} />
      <BrandMark size={22} />
      <BrandMark size={32} />
      <BrandMark size={64} />
    </span>
  ),
}
