import type { Meta, StoryObj } from '@storybook/tanstack-react'

import {
  UnsyncedChangesList,
  UnsyncedMark,
} from '#/components/offline/unsynced-changes'
import { EDITS } from './offline-fixtures'

/**
 * The unsynced-changes surface: a marker for the cell or block an edit belongs
 * to, and the inspector's list of everything waiting to sync. Both read edits
 * the device store holds; an empty list says so rather than implying work.
 */
const meta = {
  title: 'Offline/Unsynced changes',
  component: UnsyncedChangesList,
  tags: ['autodocs'],
  args: { edits: EDITS },
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof UnsyncedChangesList>

export default meta

type Story = StoryObj<typeof meta>

/** One row for each kind of edit: block text, cell, added row and comment. */
export const Default: Story = {}

export const Empty: Story = { args: { edits: [] } }

/** A host can name the block or column instead of the generic description. */
export const CustomDescription: Story = {
  args: {
    edits: EDITS.slice(0, 2),
    describe: (edit) => ({
      at: edit.createdAt,
      title: edit.kind === 'cell' ? 'Edited Load (L/m²)' : 'Edited Method',
      detail: edit.kind === 'cell' ? 'Row 6 · 4.1' : 'Seeding density',
    }),
  },
}

/** The grey mark on an affected cell or block. */
export const Mark: Story = {
  render: () => <UnsyncedMark />,
}

export const MarkWithCustomLabel: Story = {
  render: () => <UnsyncedMark label="Waiting" detail="Kept on this device" />,
}
