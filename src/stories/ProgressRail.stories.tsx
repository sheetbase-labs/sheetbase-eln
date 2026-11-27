import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { ProgressRail } from '#/components/ui/progress-rail'

const meta = {
  title: 'UI/Progress rail',
  component: ProgressRail,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-[480px] bg-surface p-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ProgressRail>

export default meta

type Story = StoryObj<typeof meta>

/** Three of six steps done, the fourth under way. */
export const MidRun: Story = {
  args: {
    segments: [
      { key: '1', state: 'done', title: 'Hold harvest at 2–8 °C' },
      { key: '2', state: 'done', title: 'Filter runs' },
      { key: '3', state: 'done', title: 'Filtrate turbidity' },
      { key: '4', state: 'now', title: 'Capsid titre by ELISA' },
      { key: '5', state: 'todo', title: 'Step yield by load' },
      { key: '6', state: 'todo', title: 'Decision and review' },
    ],
  },
}
