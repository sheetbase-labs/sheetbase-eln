import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { FilterMenu } from '#/components/v3/ui/filter-menu'

/**
 * The shared list filter: a "Field: value" control in a list toolbar. Picking a
 * value calls `onChange`; the "any" item clears it. It is the existing
 * DropdownMenu underneath, so it carries the same keyboard model.
 *
 * Lists that already show removable chips keep them: this menu sets the filter,
 * the chips stay the visible record of what is active.
 */
const KINDS = ['Experiment', 'Dataset', 'Sample', 'Instrument']
const STATUSES = [
  { value: 'ok', label: 'Valid' },
  { value: 'review', label: 'Needs review' },
  { value: 'bad', label: 'Failed' },
]

const meta = {
  title: 'v3 kit/Filter menu',
  component: FilterMenu,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: { label: 'Kind', options: KINDS, onChange: () => {} },
} satisfies Meta<typeof FilterMenu>
export default meta
type Story = StoryObj<typeof meta>

/** Nothing picked: the trigger reads "Kind: any". */
export const Default: Story = {
  args: { label: 'Kind', options: KINDS, onChange: () => {} },
}

/** A value picked, which tints the trigger so an active filter is visible. */
export const Active: Story = {
  render: () => (
    <div className="flex gap-3">
      <FilterMenu
        label="Kind"
        value="Sample"
        options={KINDS}
        onChange={() => {}}
      />
      <FilterMenu
        label="Status"
        value="ok"
        options={STATUSES}
        onChange={() => {}}
      />
    </div>
  ),
}

/**
 * Options may be `{ value, label }` when the stored value is not the word shown,
 * which is how a status filter reads "Valid" rather than "ok".
 */
export const LabelledOptions: Story = {
  render: () => {
    const [status, setStatus] = useState<string | undefined>('review')
    return (
      <FilterMenu
        label="Status"
        value={status}
        options={STATUSES}
        onChange={setStatus}
      />
    )
  },
}

/** A long option list scrolls inside the menu rather than past the viewport. */
export const LongList: Story = {
  args: {
    label: 'Instrument',
    options: Array.from({ length: 40 }, (_, i) => `AMB-25-${100 + i}`),
    onChange: () => {},
  },
}
