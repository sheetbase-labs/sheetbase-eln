import { describe, expect, it, vi } from 'vitest'

import { openBesideOnAlt } from './workspace-navigation'

function click(init: Partial<MouseEvent> = {}) {
  return {
    button: 0,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    preventDefault: vi.fn(),
    ...init,
  }
}

describe('openBesideOnAlt', () => {
  it('leaves a plain click to the link, so it opens in the same pane', () => {
    const open = vi.fn()
    const event = click()
    expect(openBesideOnAlt({ open }, '/samples/S1', event, 'S1')).toBe(false)
    expect(open).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('opens an Alt-click beside and keeps the browser from following the link', () => {
    const open = vi.fn()
    const event = click({ altKey: true })
    expect(openBesideOnAlt({ open }, '/samples/S1', event, 'S1')).toBe(true)
    expect(open).toHaveBeenCalledWith('/samples/S1', {
      beside: true,
      title: 'S1',
    })
    expect(event.preventDefault).toHaveBeenCalled()
  })

  it('leaves a keyboard activation, which has no click event, to the caller', () => {
    const open = vi.fn()
    expect(openBesideOnAlt({ open }, '/samples/S1', undefined, 'S1')).toBe(
      false,
    )
    expect(open).not.toHaveBeenCalled()
  })

  it.each([
    { ctrlKey: true },
    { metaKey: true },
    { shiftKey: true },
    { button: 1 },
  ])('leaves %o to the browser, even with Alt', (init) => {
    const open = vi.fn()
    expect(
      openBesideOnAlt({ open }, '/x', click({ ...init, altKey: true })),
    ).toBe(false)
    expect(open).not.toHaveBeenCalled()
  })

  it('does nothing outside a workspace', () => {
    expect(openBesideOnAlt(null, '/x', click({ altKey: true }))).toBe(false)
  })
})
