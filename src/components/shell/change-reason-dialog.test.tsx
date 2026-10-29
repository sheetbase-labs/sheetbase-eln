import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { askForChangeReason, forgetChangeReason } from '#/lib/change-reason'

import { ChangeReasonDialog } from './change-reason-dialog'

afterEach(() => {
  cleanup()
  forgetChangeReason()
})

describe('ChangeReasonDialog', () => {
  it('asks why a saved value is changing and hands the answer back', async () => {
    const user = userEvent.setup()
    render(<ChangeReasonDialog />)
    const answer = askForChangeReason()

    const save = await screen.findByRole('button', { name: 'Save change' })
    expect((save as HTMLButtonElement).disabled).toBe(true)
    await user.type(
      screen.getByLabelText('Reason for the change'),
      'Corrected against the bench sheet',
    )
    await user.click(save)

    expect(await answer).toBe('Corrected against the bench sheet')
    await waitFor(() =>
      expect(screen.queryByLabelText('Reason for the change')).toBeNull(),
    )
  })

  it('gives no reason when the person cancels', async () => {
    const user = userEvent.setup()
    render(<ChangeReasonDialog />)
    const answer = askForChangeReason()

    await user.click(await screen.findByRole('button', { name: 'Cancel' }))

    expect(await answer).toBeNull()
  })
})
