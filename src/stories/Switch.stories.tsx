import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { Label } from '#/components/ui/label'
import { Switch } from '#/components/ui/switch'

const meta = {
  title: 'UI/Switch',
  component: Switch,
  tags: ['autodocs'],
} satisfies Meta<typeof Switch>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <Switch id="notifications" />
      <Label htmlFor="notifications">Email notifications</Label>
    </div>
  ),
}
export const States: Story = {
  render: () => (
    <div className="flex gap-5">
      <Switch defaultChecked aria-label="On" />
      <Switch aria-label="Off" />
      <Switch disabled aria-label="Disabled" />
      <Switch disabled defaultChecked aria-label="Disabled on" />
    </div>
  ),
}
