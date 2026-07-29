import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { Badge } from '#/components/ui/badge'

const meta = {
  title: 'UI/Badge',
  component: Badge,
  tags: ['autodocs'],
} satisfies Meta<typeof Badge>

export default meta
type Story = StoryObj<typeof meta>

export const Variants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Badge>Default</Badge>
      <Badge variant="secondary">Secondary</Badge>
      <Badge variant="outline">Outline</Badge>
      <Badge variant="success">Success</Badge>
      <Badge variant="warning">Warning</Badge>
      <Badge variant="danger">Danger</Badge>
      <Badge variant="info">Info</Badge>
      <Badge variant="violet">Violet</Badge>
    </div>
  ),
}
