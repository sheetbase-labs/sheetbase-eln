import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Secret } from './secret'
import { Toaster, toast } from './sonner'

const FAILED_COPY = 'Couldn’t copy. Select the value and copy it by hand.'

/** The value beside the app's own toaster, which paints what the copy reports. */
function renderSecret() {
  return render(
    <>
      <Secret value="sb_live_123" />
      <Toaster />
    </>,
  )
}

afterEach(() => {
  cleanup()
  toast.dismiss()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Secret', () => {
  it('confirms the copy when the clipboard takes the value', async () => {
    const user = userEvent.setup()

    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue(undefined)

    renderSecret()

    await user.click(screen.getByRole('button', { name: 'Copy' }))

    expect(writeText).toHaveBeenCalledWith('sb_live_123')
    expect(await screen.findByText('Copied')).toBeTruthy()
    expect(screen.queryByText(FAILED_COPY)).toBeNull()
  })

  it('reports a refused copy instead of confirming one', async () => {
    const user = userEvent.setup()
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(
      new DOMException('denied', 'NotAllowedError'),
    )
    renderSecret()

    await user.click(screen.getByRole('button', { name: 'Copy' }))

    expect(await screen.findByText(FAILED_COPY)).toBeTruthy()
    expect(screen.queryByText('Copied')).toBeNull()
  })

  it('reports a missing clipboard instead of confirming a copy', async () => {
    // An insecure context serves no clipboard at all: the promise the old code
    // ignored never ran, and the toast claimed a copy that had not happened.
    const user = userEvent.setup()
    vi.stubGlobal('navigator', { clipboard: undefined })
    renderSecret()

    await user.click(screen.getByRole('button', { name: 'Copy' }))

    expect(await screen.findByText(FAILED_COPY)).toBeTruthy()
    expect(screen.queryByText('Copied')).toBeNull()
  })
})
