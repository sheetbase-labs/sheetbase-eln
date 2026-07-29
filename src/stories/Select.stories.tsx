import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { Select } from '#/components/ui/select'

const meta = {
  title: 'UI/Select',
  component: Select,
  tags: ['autodocs'],
  args: { className: 'max-w-sm' },
} satisfies Meta<typeof Select>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {
  render: () => (
    <Select defaultValue="draft" className="max-w-sm">
      <option value="draft">Draft</option>
      <option value="review">Under review</option>
      <option value="approved">Approved</option>
    </Select>
  ),
}
export const States: Story = {
  render: () => (
    <div className="grid max-w-sm gap-3">
      <Select disabled>
        <option>Disabled</option>
      </Select>
      <Select required defaultValue="">
        <option value="" disabled>
          Select a status…
        </option>
        <option>Active</option>
      </Select>
    </div>
  ),
}
