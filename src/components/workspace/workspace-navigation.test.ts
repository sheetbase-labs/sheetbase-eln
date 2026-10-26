import { describe, expect, it, vi } from 'vitest'

import { openObjectBeside } from './workspace-navigation'

function click(init: Partial<MouseEvent> = {}) {
  return {
    button: 0,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    preventDefault: vi.fn(),
    ...init,
  }
}

describe('openObjectBeside', () => {
  it('opens a plain click beside and keeps the browser from following the link', () => {
    const open = vi.fn()
    const event = click()
    expect(openObjectBeside({ open }, '/samples/S1', event, 'S1')).toBe(true)
    expect(open).toHaveBeenCalledWith('/samples/S1', {
      beside: true,
      title: 'S1',
    })
    expect(event.preventDefault).toHaveBeenCalled()
  })

  it('opens a keyboard activation, which has no click event', () => {
    const open = vi.fn()
    expect(openObjectBeside({ open }, '/samples/S1', undefined, 'S1')).toBe(
      true,
    )
    expect(open).toHaveBeenCalledOnce()
  })

  it.each([
    { ctrlKey: true },
    { metaKey: true },
    { shiftKey: true },
    { button: 1 },
  ])('leaves %o to the browser', (init) => {
    const open = vi.fn()
    expect(openObjectBeside({ open }, '/x', click(init))).toBe(false)
    expect(open).not.toHaveBeenCalled()
  })

  it('does nothing outside a workspace', () => {
    expect(openObjectBeside(null, '/x', click())).toBe(false)
  })
})
