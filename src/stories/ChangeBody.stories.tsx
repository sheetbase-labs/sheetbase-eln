import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { ChangeBody } from '#/components/review/revision-diff-review'
import type { RevisionChange } from '#/lib/revision-diff'

/** The body of a change card: the compared values, or a moved block's
 * positions. */
function change(overrides: Partial<RevisionChange> = {}): RevisionChange {
  return {
    id: 'chg-1',
    area: 'text',
    kind: 'modified',
    identity: 'block-1',
    label: 'Method paragraph',
    path: ['blocks', 'block-1'],
    before: 'Cells were seeded at 2.0 × 10⁶ cells/mL.',
    after: 'Cells were seeded at 2.0 × 10⁶ cells/mL and transfected.',
    ...overrides,
  }
}

const meta = {
  title: 'Review/Change body',
  component: ChangeBody,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-[640px] max-w-full">
        <Story />
      </div>
    ),
  ],
  args: { change: change() },
} satisfies Meta<typeof ChangeBody>
export default meta
type Story = StoryObj<typeof meta>

export const Modified: Story = {}

/** `null` prints as `null`, and an absent key as “Not present” — the exact
 * value, never a blank cell. */
export const NullAndAbsent: Story = {
  args: { change: change({ before: null, after: undefined }) },
}

/** Objects print as their JSON, so a nested change stays inspectable. */
export const StructuredValue: Story = {
  args: {
    change: change({
      before: { rows: 8, columns: ['Time', 'OD₆₀₀'] },
      after: { rows: 12, columns: ['Time', 'OD₆₀₀', 'Condition'] },
    }),
  },
}

export const Moved: Story = {
  args: {
    change: change({
      kind: 'moved',
      area: 'blocks',
      beforeOrder: 1,
      afterOrder: 4,
    }),
  },
}

/** Long unbroken values wrap inside their own panel. */
export const LongText: Story = {
  args: {
    change: change({
      before:
        'The lentiviral vector batch was harvested, clarified through a 0.45 µm filter, concentrated and stored at −80 °C pending release testing.',
      after:
        'The lentiviral vector batch was harvested at 72 h post-transfection, clarified through a 0.45 µm filter, concentrated tenfold and stored at −80 °C pending release testing.',
    }),
  },
}
