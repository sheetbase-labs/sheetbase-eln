import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { Progress } from '#/components/v3/ui/progress'

/**
 * A horizontal quantity bar. `value` gives a real `progressbar` role with the
 * value attributes; `segments` gives a stacked ledger, which has no single value
 * to report and keeps the caller's sentence as its label.
 */
const meta = {
  title: 'UI/Progress',
  component: Progress,
  tags: ['autodocs'],
  args: { label: 'Hold time used', value: 45, className: 'w-96' },
} satisfies Meta<typeof Progress>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Values: Story = {
  render: () => (
    <div className="grid w-96 gap-4">
      <Progress label="Nothing used" value={0} />
      <Progress label="A quarter used" value={25} />
      <Progress label="Three quarters used" value={75} />
      <Progress label="Fully used" value={100} />
    </div>
  ),
}

/** Tones name the fills; which one means what is the domain's decision. */
export const Tones: Story = {
  render: () => (
    <div className="grid w-96 gap-4">
      <Progress label="Neutral" value={40} tone="neutral" />
      <Progress label="Accent" value={40} tone="accent" />
      <Progress label="Success" value={40} tone="success" />
      <Progress label="Warning" value={40} tone="warning" />
      <Progress label="Danger" value={40} tone="danger" />
    </div>
  ),
}

/** Against a maximum of its own, with the reading said in words. */
export const AgainstAMaximum: Story = {
  render: () => (
    <Progress
      label="Approval for Virus Stability"
      value={3}
      max={9}
      tone="success"
      valueText="3 of 9 experiments approved"
      className="w-96"
    />
  ),
  args: { label: 'Approval for Virus Stability' },
}

/** No value to show yet: indeterminate, and honestly so. */
export const Indeterminate: Story = { args: { value: null } }

/**
 * The stacked shape: a quantity ledger whose parts fill one bar. There is no
 * single value, so it keeps its sentence as the label.
 */
export const Stacked: Story = {
  render: () => (
    <Progress
      label="120 mL registered: 50 mL used, 30 mL reserved, 40 mL free"
      size="md"
      segments={[
        { value: 41.7, className: 'bg-fg-muted' },
        { value: 25, className: 'bg-selection-border' },
      ]}
      className="w-96"
    />
  ),
  args: { label: 'Stacked ledger' },
}
