import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { AddBlockControl } from '#/components/notebook/add-block-menu'

/**
 * The labelled add-block control: an icon or button trigger that opens the
 * block menu. It owns its open state, so a click in the canvas opens the
 * option list.
 */
const meta = {
  title: 'Notebook/Add block control',
  component: AddBlockControl,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="p-6">
        <Story />
      </div>
    ),
  ],
  args: { onInsert: () => {}, label: 'Add block' },
} satisfies Meta<typeof AddBlockControl>
export default meta
type Story = StoryObj<typeof meta>

/** The button form used at the end of a document. */
export const Button: Story = {}

/** The icon form used between blocks on hover. */
export const Icon: Story = {
  args: { variant: 'icon', label: 'Add block here' },
}

/** Disabled: nothing opens, and the control says so. */
export const Disabled: Story = { args: { disabled: true } }

/** Inserting after a specific block keeps the insertion point explicit. */
export const AfterBlock: Story = {
  args: { after: '0198d970-e266-4000-8000-0000000000b1' },
}

/** A writer's own label, e.g. inside a section of the outline. */
export const CustomLabel: Story = {
  render: () => {
    const [inserted, setInserted] = useState<string | null>(null)
    return (
      <div className="space-y-2">
        <AddBlockControl
          label="Add a material block"
          onInsert={(type) => setInserted(type)}
        />
        {inserted ? (
          <p className="text-xs text-fg-muted" role="status">
            Inserted {inserted}
          </p>
        ) : null}
      </div>
    )
  },
}
