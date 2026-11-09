import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { PendingEditsDialog } from '#/components/workspace/pending-edits-dialog'

/**
 * Asked when a pane holding unsaved edits is closed: Save keeps them, Discard
 * throws them away, Cancel stays on the page.
 */
const meta = {
  title: 'Workspace/Pending edits dialog',
  component: PendingEditsDialog,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
} satisfies Meta<typeof PendingEditsDialog>

export default meta

type Story = StoryObj<typeof meta>

export const UnsavedAnalysis: Story = {
  args: {
    edits: [
      {
        label: 'Analysis Studio',
        paneId: 'pane-1',
        save: async () => true,
        discard: () => {},
      },
    ],
    onResolve: () => {},
  },
}
