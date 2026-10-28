import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ESignDialog } from './e-sign-dialog'

afterEach(cleanup)

function setup(
  overrides: Partial<React.ComponentProps<typeof ESignDialog>> = {},
) {
  const onSubmit = vi.fn()
  const onOpenChange = vi.fn()
  render(
    <ESignDialog
      open
      onOpenChange={onOpenChange}
      title="Sign this revision"
      description="An internal attestation."
      signingAs="Ada Lovelace"
      subject={{ revisionId: 'rev-1', digest: 'a'.repeat(64) }}
      meanings={['reviewed-and-approved', 'reviewed']}
      onSubmit={onSubmit}
      {...overrides}
    />,
  )
  return { onSubmit, onOpenChange }
}

function isDisabled(element: HTMLElement): boolean {
  return (element as HTMLButtonElement | HTMLInputElement).disabled
}

describe('ESignDialog (R5-NOTE-02)', () => {
  it('shows the signer, the meaning, the content hash and the server time fact', () => {
    setup()
    expect(screen.getAllByText('Ada Lovelace').length).toBeGreaterThan(0)
    // The meaning appears in the summary and in the select.
    expect(screen.getAllByText('Reviewed and approved').length).toBeGreaterThan(
      0,
    )
    expect(screen.queryByText('a'.repeat(64))).not.toBeNull()
    // The time is a fact about the server, never a client clock value.
    expect(
      screen.queryByText('Recorded as the time you sign'),
    ).not.toBeNull()
  })

  it('consumes the REV-03 meaning vocabulary and assurance statement', () => {
    setup({ meanings: ['reviewed'] })
    const select = screen.getByLabelText('Signature meaning')
    expect(select).toHaveProperty('value', 'reviewed')
    expect(screen.queryByRole('option', { name: 'Witnessed' })).toBeNull()
    expect(
      screen.queryByText(/internal attestation, not a regulatory compliance/),
    ).not.toBeNull()
  })

  it('focuses the password field on open and requires it to sign', async () => {
    const user = userEvent.setup()
    const { onSubmit } = setup()
    const password = screen.getByLabelText('Signing password')
    await waitFor(() => expect(document.activeElement).toBe(password))
    expect(isDisabled(screen.getByRole('button', { name: 'Sign' }))).toBe(true)

    await user.type(password, 'correct horse battery staple')
    // Still needs the typed name.
    expect(isDisabled(screen.getByRole('button', { name: 'Sign' }))).toBe(true)

    await user.type(
      screen.getByLabelText('Type your name to confirm'),
      'Ada Lovelace',
    )
    await user.click(screen.getByRole('button', { name: 'Sign' }))
    expect(onSubmit).toHaveBeenCalledWith({
      meaning: 'reviewed-and-approved',
      confirmation: 'Ada Lovelace',
      password: 'correct horse battery staple',
    })
    // The secret is not retained after it has been handed to the step-up.
    expect(screen.getByLabelText('Signing password')).toHaveProperty(
      'value',
      '',
    )
  })

  it('blocks submission when the content digest is unavailable', async () => {
    const user = userEvent.setup()
    setup({ subject: { revisionId: 'rev-1', digest: null } })
    await user.type(screen.getByLabelText('Signing password'), 'pw')
    await user.type(
      screen.getByLabelText('Type your name to confirm'),
      'Ada Lovelace',
    )
    expect(isDisabled(screen.getByRole('button', { name: 'Sign' }))).toBe(true)
    expect(screen.queryByText('Unavailable')).not.toBeNull()
  })

  it('shows the blocked explanation instead of the form', () => {
    setup({
      meanings: [],
      blocked: <p>Certification is required before you can sign.</p>,
    })
    expect(
      screen.queryByText('Certification is required before you can sign.'),
    ).not.toBeNull()
    expect(screen.queryByLabelText('Signing password')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Sign' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeNull()
  })

  it('can require only the password when name confirmation is off', async () => {
    const user = userEvent.setup()
    const { onSubmit } = setup({ requireConfirmation: false })
    expect(screen.queryByLabelText('Type your name to confirm')).toBeNull()
    await user.type(screen.getByLabelText('Signing password'), 'pw')
    await user.click(screen.getByRole('button', { name: 'Sign' }))
    expect(onSubmit).toHaveBeenCalledWith({
      meaning: 'reviewed-and-approved',
      confirmation: '',
      password: 'pw',
    })
  })

  it('surfaces the flow error', () => {
    setup({ errorMessage: 'Three failed attempts lock signing.' })
    expect(
      screen.queryByText('Three failed attempts lock signing.'),
    ).not.toBeNull()
  })
})
