import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { Button } from '#/components/ui/button'
import { ConfirmPrompt } from '#/components/ui/confirm-prompt'

/**
 * The app's own "are you sure?", used where the browser's `window.confirm` used
 * to block the tab. Render it while the question is open.
 */
const meta = {
  title: 'UI/Confirm prompt',
  component: ConfirmPrompt,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
} satisfies Meta<typeof ConfirmPrompt>

export default meta

type Story = StoryObj<typeof meta>

export const Destructive: Story = {
  args: {
    message: 'Remove this endpoint? Events not yet sent are dropped.',
    confirmLabel: 'Remove',
    variant: 'danger-fill',
    onConfirm: () => {},
    onClose: () => {},
  },
  render: (args) => {
    const [open, setOpen] = useState(false)

    return (
      <>
        <Button onClick={() => setOpen(true)}>Remove endpoint</Button>
        {open ? (
          <ConfirmPrompt {...args} onClose={() => setOpen(false)} />
        ) : null}
      </>
    )
  },
}
