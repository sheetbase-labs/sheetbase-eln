import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { Button } from '#/components/ui/button'
import { LinkDialog } from '#/components/notebook/link-dialog'

/** Asks for a link's address in the notebook's text toolbar. */
const meta = {
  title: 'Notebook/Link dialog',
  component: LinkDialog,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
} satisfies Meta<typeof LinkDialog>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { onSubmit: () => {}, onClose: () => {} },
  render: (args) => {
    const [open, setOpen] = useState(false)

    return (
      <>
        <Button onClick={() => setOpen(true)}>Add link</Button>
        {open ? <LinkDialog {...args} onClose={() => setOpen(false)} /> : null}
      </>
    )
  },
}
