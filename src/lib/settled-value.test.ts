import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useSettledValue } from './settled-value'

afterEach(() => {
  vi.useRealTimers()
})

describe('useSettledValue', () => {
  it('reports a burst of typing once, after the delay', () => {
    vi.useFakeTimers()
    const onSettle = vi.fn()
    const { result } = renderHook(() => useSettledValue('', 200, onSettle))

    act(() => result.current.setValue('q'))
    act(() => vi.advanceTimersByTime(100))
    act(() => result.current.setValue('qu'))
    act(() => vi.advanceTimersByTime(199))
    // The second keystroke restarted the delay, so nothing has been reported.
    expect(onSettle).not.toHaveBeenCalled()
    expect(result.current.value).toBe('qu')

    act(() => vi.advanceTimersByTime(1))
    expect(onSettle).toHaveBeenCalledTimes(1)
    expect(onSettle).toHaveBeenCalledWith('qu')
    expect(result.current.settled).toBe('qu')
  })

  it('does not report the value it started with', () => {
    vi.useFakeTimers()
    const onSettle = vi.fn()
    renderHook(() => useSettledValue('virus', 200, onSettle))

    act(() => vi.advanceTimersByTime(1000))
    expect(onSettle).not.toHaveBeenCalled()
  })

  it('adopts a change made elsewhere and drops what was still queued', () => {
    vi.useFakeTimers()
    const onSettle = vi.fn()
    const { result, rerender } = renderHook(
      ({ value }) => useSettledValue(value, 200, onSettle),
      { initialProps: { value: 'old' } },
    )

    act(() => result.current.setValue('typed'))
    // "Clear search" elsewhere sets the route's parameter while the box still
    // has an unsettled keystroke in flight.
    rerender({ value: '' })
    expect(result.current.value).toBe('')

    act(() => vi.advanceTimersByTime(1000))
    // The queued keystroke was dropped, so it never navigates the screen back
    // to the term the user cleared.
    expect(onSettle).not.toHaveBeenCalled()
    expect(result.current.settled).toBe('')
  })

  it('ignores the echo of its own report', () => {
    vi.useFakeTimers()
    const onSettle = vi.fn()
    const { result, rerender } = renderHook(
      ({ value }) => useSettledValue(value, 200, onSettle),
      { initialProps: { value: '' } },
    )

    act(() => result.current.setValue('abc'))
    act(() => vi.advanceTimersByTime(200))
    // The route now carries the reported term back in as the value.
    rerender({ value: 'abc' })
    expect(result.current.value).toBe('abc')

    act(() => result.current.setValue('abcd'))
    expect(result.current.value).toBe('abcd')
  })

  it('holds the settled value with no callback, for a server read', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useSettledValue('', 250))

    act(() => result.current.setValue('quarantine'))
    expect(result.current.settled).toBe('')
    act(() => vi.advanceTimersByTime(250))
    expect(result.current.settled).toBe('quarantine')
  })
})
