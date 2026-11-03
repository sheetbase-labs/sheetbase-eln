import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { Icon } from '#/components/icons'
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
      <Icon name="alignLeft" />
    </ToggleGroupItem>
    <ToggleGroupItem value="center" aria-label="Align center">
      <Icon name="alignCenter" />
    </ToggleGroupItem>
    <ToggleGroupItem value="right" aria-label="Align right">
      <Icon name="alignRight" />
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
