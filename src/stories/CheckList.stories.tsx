import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { CheckList } from '#/components/record/inspector-sections'
import type { CheckItem } from '#/components/record/inspector-sections'

/** Every check state the badge map knows, with and without detail. */
const items: CheckItem[] = [
  { id: 'c1', label: 'Units are canonical', state: 'pass' },
  {
    id: 'c2',
    label: 'All sample links resolve',
    state: 'pass',
    detail: '8 of 8',
  },
  {
    id: 'c3',
    label: 'Protocol approval is current',
    state: 'fail',
    detail: '1 of 8',
  },
  { id: 'c4', label: 'Signature collected', state: 'pending' },
  {
    id: 'c5',
    label: 'Control within range',
    state: 'warning',
    detail: 'Ct −0.4',
  },
]

const meta = {
  title: 'Record/Inspector sections/Check list',
  component: CheckList,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
  args: { items },
} satisfies Meta<typeof CheckList>
export default meta
type Story = StoryObj<typeof meta>

export const AllStates: Story = {}

/** Every check passing — the state a submitted revision aims for. */
export const AllPassing: Story = {
  args: { items: items.filter((item) => item.state === 'pass') },
}

export const Empty: Story = { args: { items: [] } }

/** Long labels truncate rather than pushing the badge off the row. */
export const LongLabels: Story = {
  args: {
    items: [
      {
        id: 'long',
        label:
          'All measurements recorded in this revision use canonical units and resolved sample identifiers',
        state: 'fail',
        detail: '2 values',
      },
    ],
  },
}
