import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { IconButton } from '#/components/ui/icon-button'

const meta = {
  title: 'UI/IconButton',
  component: IconButton,
  tags: ['autodocs'],
  args: { label: 'Edit', icon: 'edit' },
} satisfies Meta<typeof IconButton>

export default meta

type Story = StoryObj<typeof meta>

/** Hover or focus the button to see its label. */
export const Default: Story = {}

export const Secondary: Story = { args: { variant: 'secondary' } }

export const Row: Story = {
  render: () => (
    <div className="flex gap-1">
      <IconButton label="Edit" icon="edit" />
      <IconButton label="Download" icon="download" />
      <IconButton label="Duplicate" icon="copy" />
      <IconButton label="Delete" icon="trash" variant="danger" />
    </div>
  ),
}
