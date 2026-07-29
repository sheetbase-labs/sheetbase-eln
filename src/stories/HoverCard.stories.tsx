import type { Meta, StoryObj } from '@storybook/tanstack-react'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '#/components/ui/hover-card'

const meta = {
  title: 'UI/HoverCard',
  component: HoverCard,
  tags: ['autodocs'],
} satisfies Meta<typeof HoverCard>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {
  render: () => (
    <HoverCard openDelay={100}>
      <HoverCardTrigger asChild>
        <a href="#" className="font-medium underline">
          EXP-2026-014
        </a>
      </HoverCardTrigger>
      <HoverCardContent>
        <div className="font-semibold">Protein stability study</div>
        <p className="mt-1 text-sm text-muted-foreground">
          In progress · updated today
        </p>
      </HoverCardContent>
    </HoverCard>
  ),
}
export const Open: Story = {
  render: () => (
    <HoverCard open>
      <HoverCardTrigger>Researcher profile</HoverCardTrigger>
      <HoverCardContent align="start">
        <strong>Alex Morgan</strong>
        <p className="text-sm text-muted-foreground">Senior Scientist</p>
      </HoverCardContent>
    </HoverCard>
  ),
}
