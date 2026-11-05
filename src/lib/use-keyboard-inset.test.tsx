// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

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

  it('leaves room for the iOS accessory bar only on iOS with the keyboard open', () => {
    const viewport = new FakeViewport()
    Object.defineProperty(window, 'visualViewport', {
      value: viewport,
      configurable: true,
    })
    Object.defineProperty(window, 'innerHeight', {
      value: 800,
      configurable: true,
    })
    const ua = vi.spyOn(navigator, 'userAgent', 'get')
    const root = document.documentElement
    ua.mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')
    const { unmount } = renderHook(() => useKeyboardInset(true))
    expect(root.style.getPropertyValue('--kb-accessory')).toBe('0px')
    act(() => {
      viewport.height = 464
      viewport.dispatchEvent(new Event('resize'))
    })
    expect(root.style.getPropertyValue('--kb-accessory')).toBe('56px')
    unmount()
    expect(root.style.getPropertyValue('--kb-accessory')).toBe('')

    ua.mockReturnValue('Mozilla/5.0 (Linux; Android 14)')
    const android = renderHook(() => useKeyboardInset(true))
    act(() => {
      viewport.height = 464
      viewport.dispatchEvent(new Event('resize'))
    })
    expect(root.style.getPropertyValue('--kb-accessory')).toBe('0px')
    android.unmount()
    ua.mockRestore()
  })

  it('re-measures after focus when iOS skips the first viewport resize', () => {
    vi.useFakeTimers()
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

    // The keyboard slides in after focus, with no resize event from the viewport.
    act(() => {
      document.body.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
      viewport.height = 464
      vi.advanceTimersByTime(1000)
    })
    expect(root.style.getPropertyValue('--kb-inset')).toBe('336px')
    expect(root.style.getPropertyValue('--vv-height')).toBe('464px')

    unmount()
    vi.useRealTimers()
  })

  it('pads by the safe area only while the keyboard is closed', () => {
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
    expect(root.style.getPropertyValue('--kb-safe-bottom')).toBe(
      'env(safe-area-inset-bottom)',
    )
    act(() => {
      viewport.height = 464
      viewport.dispatchEvent(new Event('resize'))
    })
    expect(root.style.getPropertyValue('--kb-safe-bottom')).toBe('0px')
    unmount()
    expect(root.style.getPropertyValue('--kb-safe-bottom')).toBe('')
  })
})
