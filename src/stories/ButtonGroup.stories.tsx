import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { Icon } from '#/components/icons'
import { Button } from '#/components/v3/ui/button'
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
      <Button variant="secondary">Previous</Button>
      <Button variant="secondary">Next</Button>
    </ButtonGroup>
  ),
}
export const IconActions: Story = {
  render: () => (
    <ButtonGroup>
      {(['bold', 'italic', 'underline'] as const).map((name, index) => (
        <Button
          key={index}
          variant="secondary"
          size="icon"
          aria-label="Formatting action"
        >
          <Icon name={name} />
        </Button>
      ))}
    </ButtonGroup>
  ),
}
