import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { AddBlockMenu } from '#/components/notebook/add-block-menu'
import { Button } from '#/components/v3/ui/button'

/**
 * The block picker's menu form (the control that owns its own trigger is
 * `AddBlockControl`, covered separately). Kept open by the wrapper so the
 * option list is visible in the canvas.
 */
const meta = {
  title: 'Notebook/Add block menu',
  component: AddBlockMenu,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="p-6">
        <Story />
      </div>
    ),
  ],
  args: { onAdd: () => {}, open: true, onOpenChange: () => {} },
} satisfies Meta<typeof AddBlockMenu>
export default meta
type Story = StoryObj<typeof meta>

/** Open: the block types a writer can insert. */
export const Open: Story = {}

/** Inserting after a block keeps the menu anchored to that row. */
export const AfterBlock: Story = {
  args: { after: '0198d970-e266-4000-8000-0000000000b1' },
}

/** Closed: the menu renders nothing until its trigger opens it. */
export const Closed: Story = {
  args: { open: false },
  render: () => (
    <Button size="sm" variant="secondary">
      Add block
    </Button>
  ),
}

/** The uncontrolled-in-appliance case: the trigger is the control itself. */
export const WithTrigger: Story = {
  render: () => {
    const [open, setOpen] = useState(false)
    return (
      <AddBlockMenu
        open={open}
        onOpenChange={setOpen}
        onAdd={() => setOpen(false)}
      />
    )
  },
}
