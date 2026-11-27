import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { DueChip } from '#/components/ui/due-chip'

const now = new Date('2026-09-25T09:00:00Z')

/** Late, due today, tomorrow, in a few days, further off, and finished. */
function Ladder() {
  return (
    <div className="flex flex-col items-start gap-2 bg-surface p-6 text-body">
      <DueChip due="2026-09-21" now={now} />
      <DueChip due="2026-09-25" now={now} />
      <DueChip due="2026-09-26" now={now} />
      <DueChip due="2026-09-29" now={now} />
      <DueChip due="2026-10-20" now={now} />
      <DueChip due="2026-09-21" now={now} done />
    </div>
  )
}

const meta = {
  title: 'UI/Due chip',
  component: DueChip,
  tags: ['autodocs'],
} satisfies Meta<typeof DueChip>

export default meta

type Story = StoryObj<typeof meta>

export const Ladder_: Story = {
  name: 'Ladder',
  args: { due: '2026-09-21', now },
  render: () => <Ladder />,
}
