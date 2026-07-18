import { cleanup, render, screen } from '@testing-library/react'
import { within } from '@testing-library/dom'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from './alert-dialog'

afterEach(() => {
  cleanup()
})

interface ConfirmProps {
  onOpenChange?: (o: boolean) => void
  onAction?: () => void
}

function ConfirmDialog({ onOpenChange, onAction }: ConfirmProps) {
  return (
    <AlertDialog onOpenChange={onOpenChange}>
      <AlertDialogTrigger>Delete</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Permanently delete notebook?</AlertDialogTitle>
          <AlertDialogDescription>
            All blocks, links and audit history will be removed.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onAction}>Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

async function setup(jsx: React.ReactElement) {
  const user = userEvent.setup()
  const utils = render(jsx)
  return { user, ...utils }
}

describe('AlertDialog (destructive confirmation)', () => {
  it('does not render content until triggered', () => {
    render(<ConfirmDialog />)
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy()
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('opens on trigger and exposes title/description via aria', async () => {
    const { user } = await setup(<ConfirmDialog />)
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = screen.getByRole('alertdialog')
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy()
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy()
  })

  it('uses role=alertdialog so AT signals a required response', async () => {
    const onOpenChange = vi.fn()
    const { user } = await setup(<ConfirmDialog onOpenChange={onOpenChange} />)
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    // The semantic contract for destructive confirmation: the dialog has
    // role=alertdialog (not dialog), so assistive technology announces it
    // as requiring a response. Only Cancel/Action dismiss it.
    expect(screen.getByRole('alertdialog')).toBeTruthy()
  })

  it('closes when the Cancel button is clicked', async () => {
    const onOpenChange = vi.fn()
    const { user } = await setup(<ConfirmDialog onOpenChange={onOpenChange} />)
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('fires onAction when the action button is clicked', async () => {
    const onAction = vi.fn()
    const { user } = await setup(<ConfirmDialog onAction={onAction} />)
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = screen.getByRole('alertdialog')
    // Scope to the dialog so we pick the action button, not the trigger.
    const action = within(dialog).getByRole('button', { name: 'Delete' })
    await user.click(action)
    expect(onAction).toHaveBeenCalledTimes(1)
  })
})
