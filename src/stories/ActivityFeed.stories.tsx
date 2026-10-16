import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { ActivityFeed } from '#/components/record/inspector-sections'
import type { ActivityItem } from '#/components/record/inspector-sections'

const items: ActivityItem[] = [
  {
    id: 'a1',
    actor: { name: 'Ava Chen' },
    action: 'submitted',
    target: 'EXP-2026-0042',
    at: '29 Jul 2026, 14:03',
  },
  {
    id: 'a2',
    actor: { name: 'Marco Silva', initials: 'MS' },
    action: 'uploaded',
    target: 'qPCR-plate-1.csv',
    at: '29 Jul 2026, 11:48',
  },
  {
    id: 'a3',
    actor: { name: 'Priya Raman', initials: 'PR' },
    action: 'countersigned the revision',
    at: '29 Jul 2026, 15:22',
  },
]

const meta = {
  title: 'Record/Inspector sections/Activity feed',
  component: ActivityFeed,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
  args: { items },
} satisfies Meta<typeof ActivityFeed>
export default meta
type Story = StoryObj<typeof meta>

/** Rows without a target read as a bare sentence; initials fall back to the
 * first two characters of the name. */
export const Default: Story = {}

export const Empty: Story = { args: { items: [] } }

export const LongNames: Story = {
  args: {
    items: [
      {
        id: 'a4',
        actor: { name: 'Alexandria Montgomery-Wright' },
        action: 'requested scientific review from',
        target: 'the stability programme reviewers',
        at: '30 Jul 2026, 08:10',
      },
    ],
  },
}
