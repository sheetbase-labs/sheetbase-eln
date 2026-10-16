import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { Choice } from '#/components/ui/choice'
import { Secret } from '#/components/ui/secret'
// The Stepper was consolidated onto the forward kit: this story keeps a step
// row in the legacy Choice/Secret set, and the row itself is now the one that
// ships (`src/components/v3/ui/stepper.tsx`).
import { Stepper } from '#/components/v3/ui/stepper'

const meta = {
  title: 'UI/ChoiceStepperSecret',
  component: Stepper,
  tags: ['autodocs'],
} satisfies Meta<typeof Stepper>

export default meta
type Story = StoryObj<typeof meta>

export const Set: Story = {
  args: { steps: ['Upload', 'Map', 'Review'], current: 1 },
  render: () => (
    <div className="flex max-w-xl flex-col gap-6">
      <Stepper steps={['Upload', 'Map', 'Review']} current={1} />
      <div className="flex flex-col gap-2">
        <Choice
          type="radio"
          name="target"
          title="Existing dataset"
          description="Adds a version to DS-0311"
          defaultChecked
        />
        <Choice
          type="radio"
          name="target"
          title="New dataset"
          description="Creates a dataset and model"
        />
        <Choice title="Skip unmapped rows" disabled />
      </div>
      <Secret value="sb_live_51H8…4f2a" />
    </div>
  ),
}
