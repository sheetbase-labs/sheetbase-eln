import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConfirmPrompt } from './confirm-prompt'

afterEach(cleanup)

describe('ConfirmPrompt', () => {
  it('runs onConfirm and closes when the confirm button is pressed', async () => {
    const onConfirm = vi.fn()
    const onClose = vi.fn()

    render(
      <ConfirmPrompt
        message="Archive every record listed here?"
        confirmLabel="Archive"
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    )

    await userEvent.click(
      await screen.findByRole('button', { name: 'Archive' }),
    )

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalled()
  })

  it('closes without confirming when cancelled', async () => {
    const onConfirm = vi.fn()
    const onClose = vi.fn()

    render(
      <ConfirmPrompt
        message="Archive every record listed here?"
        confirmLabel="Archive"
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    )

    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))

    expect(onConfirm).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })
})
