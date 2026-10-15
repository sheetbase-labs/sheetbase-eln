import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SignatureDialog } from './sign-dialogs'
import type { RevisionWire } from '#/lib/notebook-data'

afterEach(cleanup)

const revision = {
  id: 'rev-1234567890',
  reason: 'Reviewed the clarification runs',
} as unknown as RevisionWire

function setup(
  overrides: Partial<React.ComponentProps<typeof SignatureDialog>> = {},
) {
  const onConfirm = vi.fn()
  const onOpenChange = vi.fn()
  render(
    <SignatureDialog
      open
      onOpenChange={onOpenChange}
      revision={revision}
      integrityDigest={'a'.repeat(64)}
      meanings={['reviewed-and-approved']}
      currentUserName="Ada Lovelace"
      signing={false}
      error={null}
      onConfirm={onConfirm}
      {...overrides}
    />,
  )
  return { onConfirm, onOpenChange }
}

function isDisabled(element: HTMLElement): boolean {
  return (element as HTMLButtonElement).disabled
}

/**
 * R5-NOTE-02 regression for the review signing flow: it now renders the shared
 * ESignDialog, and the step-up requirement (password re-entry + typed name)
 * must survive the migration.
 */
describe('review SignatureDialog on the shared e-sign dialog', () => {
  it('renders the trigger and opens on click', async () => {
    const user = userEvent.setup()
    const { onOpenChange } = setup({ open: false })
    await user.click(screen.getByRole('button', { name: /sign revision/i }))
    expect(onOpenChange).toHaveBeenCalledWith(true)
  })

  it('keeps the password re-entry requirement', async () => {
    const user = userEvent.setup()
    const { onConfirm } = setup()
    const password = screen.getByLabelText('Signing password')
    await waitFor(() => expect(document.activeElement).toBe(password))
    expect(isDisabled(screen.getByRole('button', { name: 'Sign' }))).toBe(true)

    await user.type(password, 'local-signing-password')
    expect(isDisabled(screen.getByRole('button', { name: 'Sign' }))).toBe(true)

    await user.type(
      screen.getByLabelText('Type your name to confirm'),
      'Ada Lovelace',
    )
    await user.click(screen.getByRole('button', { name: 'Sign' }))
    expect(onConfirm).toHaveBeenCalledWith(
      'reviewed-and-approved',
      'Ada Lovelace',
      'local-signing-password',
    )
  })

  it('preselects a requested meaning and shows the revision reason', () => {
    setup({
      meanings: ['reviewed', 'reviewed-and-approved'],
      requestedMeaning: 'reviewed',
    })
    expect(screen.getByLabelText('Signature meaning')).toHaveProperty(
      'value',
      'reviewed',
    )
    expect(screen.queryByText(/Reviewed the clarification runs/)).not.toBeNull()
  })

  it('disables signing without a content digest', () => {
    setup({ integrityDigest: null })
    expect(isDisabled(screen.getByRole('button', { name: 'Sign' }))).toBe(true)
  })

  it('shows a busy label while the step-up + write are in flight', () => {
    setup({ signing: true })
    expect(isDisabled(screen.getByRole('button', { name: 'Signing…' }))).toBe(
      true,
    )
  })
})
