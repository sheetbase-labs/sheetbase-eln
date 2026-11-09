import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { userEvent, within } from 'storybook/test'

import { Button } from '#/components/ui/button'
import { SheetPasteData } from '#/components/sheet/sheet-paste-data'

/**
 * Bring a table into a working sheet by pasting it from a spreadsheet. The
 * dialog is portalled, so the story owns the trigger and holds it open.
 */
function Harness({ busy = false }: { busy?: boolean }) {
  const [open, setOpen] = useState(true)

  return (
    <>
      <Button onClick={() => setOpen(true)}>Paste data</Button>
      <SheetPasteData
        open={open}
        onOpenChange={setOpen}
        busy={busy}
        onApply={() => setOpen(false)}
      />
    </>
  )
}

const meta = {
  title: 'Sheet/Paste data',
  component: SheetPasteData,
  tags: ['autodocs'],
  args: { open: true, onOpenChange: () => {}, onApply: () => {} },
} satisfies Meta<typeof SheetPasteData>

export default meta

type Story = StoryObj<typeof meta>

/** Open with nothing pasted yet. */
export const Empty: Story = { render: () => <Harness /> }

/** A table pasted from a spreadsheet, read as columns and rows. */
export const Pasted: Story = {
  render: () => <Harness />,
  play: async () => {
    const box = await within(document.body).findByRole('textbox')
    await userEvent.click(box)
    await userEvent.paste(
      'Well\tOD600\tStrain\nA1\t0.41\tWT\nA2\t0.40\tWT\nB1\t0.66\tKO',
    )
  },
}

/** While the pasted table is being added. */
export const Busy: Story = { render: () => <Harness busy /> }
