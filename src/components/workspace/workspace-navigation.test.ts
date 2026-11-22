import { describe, expect, it, vi } from 'vitest'

import {
  openAnchorBesideOnAlt,
  openBesideOnAlt,
  registerOpenBeside,
} from './workspace-navigation'

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

  it('opens an Alt+Shift-click in a pane below', () => {
    const open = vi.fn()
    const event = click({ altKey: true, shiftKey: true })
    expect(openBesideOnAlt({ open }, '/samples/S1', event, 'S1')).toBe(true)
    expect(open).toHaveBeenCalledWith('/samples/S1', {
      beside: true,
      below: true,
      title: 'S1',
    })
    expect(event.preventDefault).toHaveBeenCalled()
  })

  it('leaves a Shift-click without Alt to the browser', () => {
    const open = vi.fn()
    expect(openBesideOnAlt({ open }, '/x', click({ shiftKey: true }))).toBe(
      false,
    )
    expect(open).not.toHaveBeenCalled()
  })

  it('leaves a keyboard activation, which has no click event, to the caller', () => {
    const open = vi.fn()
    expect(openBesideOnAlt({ open }, '/samples/S1', undefined, 'S1')).toBe(
      false,
    )
    expect(open).not.toHaveBeenCalled()
  })

  it.each([{ ctrlKey: true }, { metaKey: true }, { button: 1 }])(
    'leaves %o to the browser, even with Alt',
    (init) => {
      const open = vi.fn()
      expect(
        openBesideOnAlt({ open }, '/x', click({ ...init, altKey: true })),
      ).toBe(false)
      expect(open).not.toHaveBeenCalled()
    },
  )

  it('does nothing outside a workspace', () => {
    expect(openBesideOnAlt(null, '/x', click({ altKey: true }))).toBe(false)
  })
})

describe('openAnchorBesideOnAlt', () => {
  const anchorClick = (init: Partial<MouseEvent>) => {
    const anchor = document.createElement('a')
    anchor.href = '/samples?new=true'
    const event = click(init)

    return {
      event: { ...event, currentTarget: anchor },
      prevented: event.preventDefault,
    }
  }

  it('asks the workspace for a pane beside on Alt-click, below with Shift', () => {
    const open = vi.fn()
    const stop = registerOpenBeside(open)
    const beside = anchorClick({ altKey: true })
    openAnchorBesideOnAlt(beside.event)
    const below = anchorClick({ altKey: true, shiftKey: true })
    openAnchorBesideOnAlt(below.event)
    stop()
    expect(open).toHaveBeenNthCalledWith(
      1,
      '/samples?new=true',
      undefined,
      false,
    )
    expect(open).toHaveBeenNthCalledWith(
      2,
      '/samples?new=true',
      undefined,
      true,
    )
  })

  it('leaves a plain click to the link', () => {
    const open = vi.fn()
    const stop = registerOpenBeside(open)
    const plain = anchorClick({})
    openAnchorBesideOnAlt(plain.event)
    stop()
    expect(open).not.toHaveBeenCalled()
    expect(plain.event.preventDefault).not.toHaveBeenCalled()
  })
})
