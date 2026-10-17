import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { AmendNotebookDialog } from '#/components/notebook/amend-notebook-dialog'

/**
 * Amending a locked notebook creates a new revision from the locked one, so
 * the note the dialog collects is what the amendment records. The write is
 * only sent on submit; the story records nothing.
 */
const meta = {
  title: 'Notebook/Amend notebook dialog',
  component: AmendNotebookDialog,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="p-6">
        <Story />
      </div>
    ),
  ],
  args: {
    open: true,
    onOpenChange: () => {},
    recordId: '0198d970-e266-4000-8000-0000000000a1',
    onAmended: () => {},
  },
} satisfies Meta<typeof AmendNotebookDialog>
export default meta
type Story = StoryObj<typeof meta>

/** Open: the note explaining why the locked record is being amended. */
export const Open: Story = {
  render: () => {
    const [open, setOpen] = useState(true)
    return (
      <AmendNotebookDialog
        open={open}
        onOpenChange={setOpen}
        recordId="0198d970-e266-4000-8000-0000000000a1"
        onAmended={() => setOpen(false)}
      />
    )
  },
}

/** Closed: no amendment is started until the writer asks. */
export const Closed: Story = {
  render: () => {
    const [open, setOpen] = useState(false)
    return (
      <AmendNotebookDialog
        open={open}
        onOpenChange={setOpen}
        recordId="0198d970-e266-4000-8000-0000000000a1"
        onAmended={() => {}}
      />
    )
  },
}
