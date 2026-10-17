import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { Choice, ChoiceCheckbox } from '#/components/v3/ui/choice'
import { RadioGroup } from '#/components/v3/ui/radio-group'

/**
 * A choice with a title and one line on its consequence. The body of a `Choice`
 * is a radio, so it belongs inside a `RadioGroup`; the safe or reversible option
 * goes first. `ChoiceCheckbox` is the same chrome around a checkbox, for a
 * question with more than one answer.
 */
const meta = {
  title: 'v3 kit/Choice',
  component: Choice,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    value: 'withdraw',
    title: 'Withdraw, keep the history',
    children:
      'The block leaves the document and stays readable in the record history.',
  },
} satisfies Meta<typeof Choice>
export default meta
type Story = StoryObj<typeof meta>

const Column = ({ children }: { children: React.ReactNode }) => (
  <div className="w-[420px]">{children}</div>
)

/** Two consequences of deleting a block, the reversible one first. */
export const SingleChoice: Story = {
  render: () => (
    <Column>
      <RadioGroup
        defaultValue="withdraw"
        className="gap-2"
        aria-label="Delete block"
      >
        <Choice value="withdraw" title="Withdraw, keep the history">
          The block leaves the document and stays readable in the record
          history.
        </Choice>
        <Choice value="delete" title="Delete it and its inputs">
          Removes the block and everything it wrote. This cannot be undone.
        </Choice>
      </RadioGroup>
    </Column>
  ),
}

/** Nothing chosen yet. The consequence line is what makes the choice answerable. */
export const Default: Story = {
  render: () => (
    <Column>
      <RadioGroup aria-label="Rounding mode" className="gap-2">
        <Choice value="sig" title="Significant figures">
          Correct for a value whose magnitude varies between runs.
        </Choice>
        <Choice value="dec" title="Decimal places">
          Correct for a value reported on a fixed scale.
        </Choice>
      </RadioGroup>
    </Column>
  ),
}

/** One option is not available in this deployment, and says why. */
export const WithDisabledOption: Story = {
  render: () => (
    <Column>
      <RadioGroup defaultValue="line" className="gap-2" aria-label="Curve fit">
        <Choice value="line" title="Straight line">
          Two parameters. The default for a calibration series.
        </Choice>
        <Choice value="four-pl" title="Four-parameter logistic" disabled>
          Needs the curve-fitting service, which this deployment does not run.
        </Choice>
      </RadioGroup>
    </Column>
  ),
}

/** A question with more than one answer uses the checkbox form. */
export const Multiple: Story = {
  render: () => (
    <Column>
      <div className="flex flex-col gap-2">
        <ChoiceCheckbox
          defaultChecked
          title="Send a notification"
          children="Tells the project members the run finished."
        />
        <ChoiceCheckbox
          title="Attach the raw output"
          children="Adds the instrument file to the record as well as the parsed table."
        />
      </div>
    </Column>
  ),
}
