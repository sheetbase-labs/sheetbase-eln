import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { ICON_NAMES, Icon } from '#/components/icons'

const meta = {
  title: 'UI/Icon',
  component: Icon,
  tags: ['autodocs'],
} satisfies Meta<typeof Icon>

export default meta
type Story = StoryObj<typeof meta>

export const Set: Story = {
  args: { name: 'home' },
  render: () => (
    <div className="grid grid-cols-4 gap-4 sm:grid-cols-6">
      {ICON_NAMES.map((name) => (
        <div
          key={name}
          className="flex flex-col items-center gap-1 rounded-md border p-3 text-muted-foreground"
        >
          <Icon name={name} size={20} />
          <span className="text-caption">{name}</span>
        </div>
      ))}
    </div>
  ),
}
