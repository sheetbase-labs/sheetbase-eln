import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

import type { RevisionWire } from '#/lib/notebook-data'
import { DemoSigningContext } from '#/lib/demo-signing'

const transport = vi.fn<typeof fetch>(async () => {
  throw new Error('Signing dialog must only call the supplied callback')
})

vi.stubGlobal('fetch', transport)

const { SignatureDialog } = await import('./sign-dialogs')

afterEach(() => {
  cleanup()
  expect(transport).not.toHaveBeenCalled()
  transport.mockClear()
})

afterAll(() => vi.unstubAllGlobals())

const revision: RevisionWire = {
  id: 'rev-1234567890',
  record_id: 'rec-1',
  structure_version: 1,
  metadata_version: 1,
  metadata_snapshot: {},
  block_snapshot: [],
  reason: 'Reviewed the clarification runs',
  superseded_by_revision_id: null,
  created_at: '2026-09-01T00:00:00Z',
  created_by_user_id: 'author-1',
}

function setup(
  overrides: Partial<React.ComponentProps<typeof SignatureDialog>> = {},
) {
  const onConfirm = vi.fn()
  const onOpenChange = vi.fn()
  render(
    <DemoSigningContext.Provider value={false}>
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
      />
    </DemoSigningContext.Provider>,
  )

  return { onConfirm, onOpenChange }
}

function isDisabled(element: HTMLElement): boolean {
  if (!(element instanceof HTMLButtonElement))
    throw new Error('Expected button')

  return element.disabled
}

/**
 * R5-NOTE-02 regression for the review signing flow: it now renders the shared
 * ESignDialog, and the step-up requirement (password re-entry + typed name)
 * must survive the migration.
 */
describe('review SignatureDialog on the shared e-sign dialog', () => {
  it('offers the signature that locks the record first', () => {
    setup({ meanings: ['reviewed', 'reviewed-and-approved'] })
    expect(screen.getByLabelText('Signature meaning')).toHaveProperty(
      'value',
      'reviewed-and-approved',
    )
  })

  it('renders the trigger and opens on click', async () => {
    const user = userEvent.setup()
    const { onOpenChange } = setup({ open: false })
    await user.click(screen.getByRole('button', { name: /^sign$/i }))
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

  it('offers Sign later when the review is already approved, and Cancel otherwise', () => {
    setup({ cancelLabel: 'Sign later' })
    expect(screen.getByRole('button', { name: 'Sign later' })).toBeTruthy()
    cleanup()
    setup()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
  })

  it('refuses a mismatched confirmation even with a password', async () => {
    const { onConfirm } = setup()
    await userEvent.type(
      screen.getByLabelText('Signing password'),
      'local-signing-password',
    )
    await userEvent.type(
      screen.getByLabelText('Type your name to confirm'),
      'Someone Else',
    )
    const submit = screen.getByRole('button', { name: 'Sign' })
    expect(isDisabled(submit)).toBe(true)
    await userEvent.click(submit)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('refuses signing a missing digest even with both credentials', async () => {
    const { onConfirm } = setup({ integrityDigest: null })
    await userEvent.type(
      screen.getByLabelText('Signing password'),
      'local-signing-password',
    )
    await userEvent.type(
      screen.getByLabelText('Type your name to confirm'),
      'Ada Lovelace',
    )
    const submit = screen.getByRole('button', { name: 'Sign' })
    expect(isDisabled(submit)).toBe(true)
    await userEvent.click(submit)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('shows a signing refusal without reporting success or submitting again', () => {
    const { onConfirm } = setup({
      error: 'Signing was refused. Re-enter your password.',
    })

    expect(
      screen.getByText('Signing was refused. Re-enter your password.'),
    ).toBeTruthy()
    expect(isDisabled(screen.getByRole('button', { name: 'Sign' }))).toBe(true)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('lets the reader cancel without signing', async () => {
    const { onConfirm, onOpenChange } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
