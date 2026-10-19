import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { ObjectLink } from '#/components/v3/ui/object-link'

/**
 * An identifier that opens the thing it names. Every screen that mentions an
 * experiment, dataset, sample or analysis by identifier uses this, so a named
 * object is always one click from its page. A kind with no page of its own
 * renders as plain text rather than a dead link.
 */
const meta = {
  title: 'UI/ObjectLink',
  component: ObjectLink,
  tags: ['autodocs'],
  args: { kind: 'experiment', identifier: 'EXP-0142' },
} satisfies Meta<typeof ObjectLink>
export default meta
type Story = StoryObj<typeof meta>

export const Experiment: Story = {}

export const Dataset: Story = {
  args: { kind: 'dataset', identifier: 'DS-0311' },
}

/** A title rather than an identifier: not monospaced. */
export const WithTitle: Story = {
  args: { kind: 'project', identifier: 'PRJ-0007', mono: false },
  render: (args) => (
    <ObjectLink {...args}>Lentivector stability study</ObjectLink>
  ),
}

/** Nothing to link to: plain text. */
export const NoTarget: Story = {
  args: { kind: 'experiment', identifier: '', id: null },
  render: (args) => <ObjectLink {...args}>Not recorded</ObjectLink>,
}
