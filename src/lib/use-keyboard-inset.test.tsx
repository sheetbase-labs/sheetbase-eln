// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { useKeyboardInset } from './use-keyboard-inset'

class FakeViewport extends EventTarget {
  height = 800
  offsetTop = 0
}

describe('useKeyboardInset', () => {
  afterEach(() => {
    Object.defineProperty(window, 'visualViewport', {
      value: null,
      configurable: true,
    })
  })

  it('publishes the keyboard height while active and clears it after', () => {
    const viewport = new FakeViewport()
    Object.defineProperty(window, 'visualViewport', {
      value: viewport,
      configurable: true,
    })
    Object.defineProperty(window, 'innerHeight', {
      value: 800,
      configurable: true,
    })
    const root = document.documentElement
    const { unmount } = renderHook(() => useKeyboardInset(true))
    expect(root.style.getPropertyValue('--kb-inset')).toBe('0px')

    act(() => {
      viewport.height = 464
      viewport.dispatchEvent(new Event('resize'))
    })
    expect(root.style.getPropertyValue('--kb-inset')).toBe('336px')
    expect(root.style.getPropertyValue('--vv-height')).toBe('464px')

    unmount()
    expect(root.style.getPropertyValue('--kb-inset')).toBe('')
  })

  it('does nothing while inactive', () => {
    renderHook(() => useKeyboardInset(false))
    expect(document.documentElement.style.getPropertyValue('--kb-inset')).toBe(
      '',
    )
  })
})
