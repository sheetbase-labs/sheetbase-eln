import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { ChangeCard } from '#/components/review/revision-diff-review'
import type { RevisionChange } from '#/lib/revision-diff'

/**
 * The card a single revision change renders in — kind badge, area, identity
 * and the before/after values, with the active card carrying a ring.
 */
function change(overrides: Partial<RevisionChange> = {}): RevisionChange {
  return {
    id: 'chg-1',
    area: 'text',
    kind: 'modified',
    identity: 'block-1',
    label: 'Method paragraph',
    path: ['blocks', 'block-1'],
    before: 'Cells were seeded at 2.0 × 10⁶ cells/mL.',
    after:
      'Cells were seeded at 2.0 × 10⁶ cells/mL and transfected at 1.0 µg DNA/mL.',
    ...overrides,
  }
}

const meta = {
  title: 'Review/Change card',
  component: ChangeCard,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-[680px] max-w-full">
        <Story />
      </div>
    ),
  ],
  args: { change: change(), active: false },
} satisfies Meta<typeof ChangeCard>
export default meta
type Story = StoryObj<typeof meta>

export const Modified: Story = {}

/** The active card is the one the reviewer is currently reading. */
export const Active: Story = { args: { active: true } }

export const Added: Story = {
  args: { change: change({ kind: 'added', after: 'Harvest at 72 h.' }) },
}

export const Removed: Story = {
  args: {
    change: change({
      kind: 'removed',
      label: 'Superseded note',
      before: 'Remove after review.',
    }),
  },
}

/** A moved block reports its positions instead of before/after values. */
export const Moved: Story = {
  args: {
    change: change({
      kind: 'moved',
      area: 'blocks',
      label: 'Results block',
      beforeOrder: 1,
      afterOrder: 4,
    }),
  },
}

/** Units travel with the values they qualify. */
export const Units: Story = {
  args: {
    change: change({
      area: 'tables',
      label: 'Viability',
      before: 88.1,
      after: 91.4,
      beforeUnit: '%',
      afterUnit: '%',
    }),
  },
}

/** Removing a value is shown as an exact absence, not a blank. */
export const ClearedValue: Story = {
  args: { change: change({ before: 42.7, after: null }) },
}
