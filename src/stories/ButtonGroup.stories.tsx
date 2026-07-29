import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { Bold, Italic, Underline } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { ButtonGroup } from '#/components/ui/button-group'

const meta = {
  title: 'UI/ButtonGroup',
  component: ButtonGroup,
  tags: ['autodocs'],
} satisfies Meta<typeof ButtonGroup>
export default meta
type Story = StoryObj<typeof meta>
export const TextActions: Story = {
  render: () => (
    <ButtonGroup>
      <Button variant="outline">Previous</Button>
      <Button variant="outline">Next</Button>
    </ButtonGroup>
  ),
}
export const IconActions: Story = {
  render: () => (
    <ButtonGroup>
      {[Bold, Italic, Underline].map((Icon, index) => (
        <Button
          key={index}
          variant="outline"
          size="icon"
          aria-label="Formatting action"
        >
          <Icon />
        </Button>
      ))}
    </ButtonGroup>
  ),
}
