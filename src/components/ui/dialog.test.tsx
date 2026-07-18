import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './dialog'

afterEach(() => {
  cleanup()
})

interface ExampleProps {
  onOpenChange?: (o: boolean) => void
}

function ExampleDialog({ onOpenChange }: ExampleProps) {
  return (
    <Dialog onOpenChange={onOpenChange}>
      <DialogTrigger>Open</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete experiment?</DialogTitle>
          <DialogDescription>This cannot be undone.</DialogDescription>
        </DialogHeader>
        <DialogClose>Cancel</DialogClose>
      </DialogContent>
    </Dialog>
  )
}

async function setup(jsx: React.ReactElement) {
  const user = userEvent.setup()
  const utils = render(jsx)
  return { user, ...utils }
}

describe('Dialog', () => {
  it('renders the trigger but not the content until opened', () => {
    render(<ExampleDialog />)
    expect(screen.getByRole('button', { name: 'Open' })).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens on trigger click and labels the dialog', async () => {
    const { user } = await setup(<ExampleDialog />)
    await user.click(screen.getByRole('button', { name: 'Open' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeTruthy()
    // Radix connects aria-labelledby/aria-describedby to the title/description.
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy()
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy()
    expect(screen.getByText('Delete experiment?')).toBeTruthy()
    expect(screen.getByText('This cannot be undone.')).toBeTruthy()
  })

  it('closes on Escape', async () => {
    const onOpenChange = vi.fn()
    const { user } = await setup(<ExampleDialog onOpenChange={onOpenChange} />)
    await user.click(screen.getByRole('button', { name: 'Open' }))
    await user.keyboard('{Escape}')
    // The last call should report closed (false).
    const last = onOpenChange.mock.calls.at(-1)?.[0]
    expect(last).toBe(false)
  })

  it('exposes an sr-only Close label on the icon close button', async () => {
    const { user } = await setup(<ExampleDialog />)
    await user.click(screen.getByRole('button', { name: 'Open' }))
    // The icon close button is labelled by its sr-only span.
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()
  })
})
