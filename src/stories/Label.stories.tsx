import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'

const meta = {
  title: 'UI/Label',
  component: Label,
  tags: ['autodocs'],
  args: { children: 'Experiment title' },
} satisfies Meta<typeof Label>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {}
export const WithControl: Story = {
  render: () => (
    <div className="grid max-w-sm gap-2">
      <Label htmlFor="title">Experiment title</Label>
      <Input id="title" defaultValue="Protein stability study" />
    </div>
  ),
}
