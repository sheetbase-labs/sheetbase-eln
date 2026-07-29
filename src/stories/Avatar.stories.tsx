import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { Avatar, AvatarFallback, AvatarImage } from '#/components/ui/avatar'

const meta = {
  title: 'UI/Avatar',
  component: Avatar,
  tags: ['autodocs'],
} satisfies Meta<typeof Avatar>
export default meta
type Story = StoryObj<typeof meta>
export const WithImage: Story = {
  render: () => (
    <Avatar>
      <AvatarImage src="https://github.com/shadcn.png" alt="Researcher" />
      <AvatarFallback>RP</AvatarFallback>
    </Avatar>
  ),
}
export const Fallbacks: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <Avatar>
        <AvatarFallback>GP</AvatarFallback>
      </Avatar>
      <Avatar className="size-12">
        <AvatarFallback>AL</AvatarFallback>
      </Avatar>
      <Avatar className="size-16">
        <AvatarFallback>MS</AvatarFallback>
      </Avatar>
    </div>
  ),
}
