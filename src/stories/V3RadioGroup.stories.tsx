import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { Radio, RadioGroup } from '#/components/v3/ui/radio-group'

/**
 * The forward kit's radio pair. `RadioGroup` owns the value and the arrow-key
 * roving focus; `Radio` is the single control. A radio on its own is a shape
 * with no question, so every story below puts it inside the group.
 *
 * The legacy `UI/RadioGroup` story is the same-named Radix twin being removed.
 */
const meta = {
  title: 'v3 kit/Radio group',
  component: RadioGroup,
  tags: ['autodocs'],
} satisfies Meta<typeof RadioGroup>
export default meta
type Story = StoryObj<typeof meta>

const option = (value: string, text: string, disabled?: boolean) => (
  <label className="flex cursor-pointer items-center gap-2 text-body">
    <Radio value={value} disabled={disabled} />
    {text}
  </label>
)

/** Nothing chosen yet — the state a form opens in. */
export const Default: Story = {
  render: () => (
    <RadioGroup aria-label="Rounding">
      {option('none', 'No rounding')}
      {option('sig-figs', 'Significant figures')}
      {option('decimal', 'Decimal places')}
    </RadioGroup>
  ),
}

/** One chosen, showing the selected ring and fill. */
export const Selected: Story = {
  render: () => (
    <RadioGroup defaultValue="raw" aria-label="Value to plot">
      {option('raw', 'Raw reading')}
      {option('mean', 'Mean of replicates')}
      {option('fitted', 'Fitted curve')}
    </RadioGroup>
  ),
}

/** One option is not available here, and says so rather than disappearing. */
export const WithDisabledOption: Story = {
  render: () => (
    <RadioGroup defaultValue="4" aria-label="Replicates">
      {option('2', 'Two replicates')}
      {option('3', 'Three replicates')}
      {option('4', 'Four replicates (not licensed)')}
    </RadioGroup>
  ),
}
