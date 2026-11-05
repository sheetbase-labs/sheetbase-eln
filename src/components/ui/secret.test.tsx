import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Secret } from './secret'

const sonner = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}))

vi.mock('sonner', () => ({
  Toaster: () => null,
  toast: sonner.toast,
}))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  sonner.toast.mockClear()
  sonner.toast.error.mockClear()
})

describe('Secret', () => {
  it('confirms the copy when the clipboard takes the value', async () => {
    const user = userEvent.setup()
    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue(undefined)
    render(<Secret value="sb_live_123" />)

    await user.click(screen.getByRole('button', { name: 'Copy' }))

    expect(writeText).toHaveBeenCalledWith('sb_live_123')
    expect(sonner.toast).toHaveBeenCalledWith('Copied')
    expect(sonner.toast.error).not.toHaveBeenCalled()
  })

  it('reports a refused copy instead of confirming one', async () => {
    const user = userEvent.setup()
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(
      new DOMException('denied', 'NotAllowedError'),
    )
    render(<Secret value="sb_live_123" />)

    await user.click(screen.getByRole('button', { name: 'Copy' }))

    expect(sonner.toast.error).toHaveBeenCalled()
    expect(sonner.toast).not.toHaveBeenCalled()
  })

  it('reports a missing clipboard instead of confirming a copy', async () => {
    // An insecure context serves no clipboard at all: the promise the old code
    // ignored never ran, and the toast claimed a copy that had not happened.
    const user = userEvent.setup()
    vi.stubGlobal('navigator', { clipboard: undefined })
    render(<Secret value="sb_live_123" />)

    await user.click(screen.getByRole('button', { name: 'Copy' }))

    expect(sonner.toast.error).toHaveBeenCalled()
    expect(sonner.toast).not.toHaveBeenCalled()
  })
})
