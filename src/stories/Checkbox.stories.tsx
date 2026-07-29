import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { Checkbox } from '#/components/ui/checkbox'
import { Label } from '#/components/ui/label'

const meta = {
  title: 'UI/Checkbox',
  component: Checkbox,
  tags: ['autodocs'],
} satisfies Meta<typeof Checkbox>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <Checkbox id="terms" />
      <Label htmlFor="terms">Accept terms</Label>
    </div>
  ),
}
export const States: Story = {
  render: () => (
    <div className="flex gap-5">
      <Checkbox defaultChecked aria-label="Checked" />
      <Checkbox aria-label="Unchecked" />
      <Checkbox disabled aria-label="Disabled" />
      <Checkbox disabled defaultChecked aria-label="Disabled checked" />
    </div>
  ),
}
