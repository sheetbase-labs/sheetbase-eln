import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { AlignCenter, AlignLeft, AlignRight } from 'lucide-react'
import { ToggleGroup, ToggleGroupItem } from '#/components/ui/toggle-group'

const meta = {
  title: 'UI/ToggleGroup',
  component: ToggleGroup,
  tags: ['autodocs'],
} satisfies Meta<typeof ToggleGroup>
export default meta
type Story = StoryObj<typeof meta>
const Items = () => (
  <>
    <ToggleGroupItem value="left" aria-label="Align left">
      <AlignLeft />
    </ToggleGroupItem>
    <ToggleGroupItem value="center" aria-label="Align center">
      <AlignCenter />
    </ToggleGroupItem>
    <ToggleGroupItem value="right" aria-label="Align right">
      <AlignRight />
    </ToggleGroupItem>
  </>
)
export const Single: Story = {
  args: { type: 'single' },
  render: () => (
    <ToggleGroup type="single" defaultValue="left" variant="outline">
      <Items />
    </ToggleGroup>
  ),
}
export const Multiple: Story = {
  args: { type: 'multiple' },
  render: () => (
    <ToggleGroup type="multiple" defaultValue={['left', 'right']}>
      <Items />
    </ToggleGroup>
  ),
}
