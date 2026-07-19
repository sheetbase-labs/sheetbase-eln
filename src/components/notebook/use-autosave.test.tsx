/**
 * ELN-007 — autosave state machine tests. Covers the ticket's required
 * cases: rapid edits (coalescing), slow responses (no false "saved"),
 * transient failure (bounded retry), stale version (conflict preserves
 * both sides), validation failure (permanent, attached), offline hold +
 * flush, and tab closure / navigation-guard signal.
 *
 * A custom `mountHook` (using `useLayoutEffect` to capture the hook's
 * return value synchronously) is used instead of `@testing-library/react`'s
 * `renderHook`, whose passive `useEffect`-based `result.current` does not
 * flush reliably in this React 19 + vitest setup when called from a helper.
 * Real timers with short debounce windows are used because vitest's fake
 * timers intercept React 19's effect scheduler.
 */
import * as React from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useAutosave } from './use-autosave'
import type { SaveResult } from './use-autosave'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface Mount<T> {
  current: T
  rerender: (props: Record<string, unknown>) => void
  unmount: () => void
}

function mountHook<TProps, T>(
  useHook: (props: TProps) => T,
  initialProps: TProps,
): Mount<T> {
  const captured: { current: T | undefined } = { current: undefined }
  const propsRef: { current: TProps } = { current: initialProps }
  function TestComponent() {
    const value = useHook(propsRef.current)
    React.useLayoutEffect(() => {
      captured.current = value
    })
    return null
  }
  const view = render(<TestComponent />)
  return {
    get current() {
      return captured.current as T
    },
    rerender: (next: Record<string, unknown>) => {
      propsRef.current = { ...propsRef.current, ...next }
      view.rerender(<TestComponent />)
    },
    unmount: view.unmount,
  }
}

type Status = ReturnType<typeof useAutosave<{ text: string }>>['status']

function makeSave(
  impl?: (value: {
    text: string
  }) => SaveResult<{ text: string }> | Promise<SaveResult<{ text: string }>>,
) {
  return vi.fn(async (value: { text: string }) => {
    if (!impl) return { ok: true }
    const r = impl(value)
    return r instanceof Promise ? r : Promise.resolve(r)
  })
}

function mountAutosave({
  saveImpl,
  initialValue = { text: '' },
  validate = () => [],
  debounceMs = 20,
  maxRetries = 3,
  initialBackoffMs = 10,
  offline = false,
}: {
  saveImpl?: (value: {
    text: string
  }) => SaveResult<{ text: string }> | Promise<SaveResult<{ text: string }>>
  initialValue?: { text: string }
  validate?: (value: { text: string }) => string[]
  debounceMs?: number
  maxRetries?: number
  initialBackoffMs?: number
  offline?: boolean
} = {}) {
  const save = makeSave(saveImpl)
  const validateFn = vi.fn(validate)
  const mount = mountHook(
    (props: { initialValue: { text: string }; offline: boolean }) =>
      useAutosave<{ text: string }>({
        initialValue: props.initialValue,
        validate: validateFn,
        save,
        debounceMs,
        maxRetries,
        initialBackoffMs,
        offline: props.offline,
        touched: true,
      }),
    { initialValue, offline },
  )
  return { mount, save, validate: validateFn }
}

describe('useAutosave — rapid edits coalesce', () => {
  it('debounces and saves once after typing stops', async () => {
    const { mount, save } = mountAutosave({ debounceMs: 30 })
    act(() => mount.current.setDraft({ text: 'a' }))
    act(() => mount.current.setDraft({ text: 'ab' }))
    act(() => mount.current.setDraft({ text: 'abc' }))
    expect(save).not.toHaveBeenCalled()
    await sleep(60)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith({ text: 'abc' })
    expect(mount.current.status).toBe('clean')
  })

  it('does not save every keystroke separately', async () => {
    const { mount, save } = mountAutosave({ debounceMs: 40 })
    for (let i = 1; i <= 5; i++) {
      act(() => mount.current.setDraft({ text: 'x'.repeat(i) }))
      await sleep(10)
    }
    expect(save).not.toHaveBeenCalled()
    await sleep(60)
    expect(save).toHaveBeenCalledTimes(1)
  })
})

describe('useAutosave — slow response cannot mark a newer draft saved', () => {
  it('re-saves when the draft changed during a slow save', async () => {
    let resolveFirst!: (r: SaveResult<{ text: string }>) => void
    const save = makeSave(
      () =>
        new Promise<SaveResult<{ text: string }>>((resolve) => {
          resolveFirst = resolve
        }),
    )
    const mount = mountHook(
      () =>
        useAutosave<{ text: string }>({
          initialValue: { text: '' },
          validate: () => [],
          save,
          debounceMs: 20,
          touched: true,
        }),
      {},
    )
    act(() => mount.current.setDraft({ text: 'first' }))
    await sleep(40)
    expect(save).toHaveBeenCalledTimes(1)
    expect(mount.current.status).toBe('saving')
    // While the first save is still pending, keep typing.
    act(() => mount.current.setDraft({ text: 'second' }))
    // Resolve the slow first save with the OLD payload's success.
    await act(async () => resolveFirst({ ok: true }))
    // The hook must NOT mark clean: a newer draft exists.
    expect(mount.current.status).not.toBe('clean')
    // A follow-up save for the latest draft should fire after the debounce.
    await sleep(40)
    expect(save).toHaveBeenNthCalledWith(2, { text: 'second' })
  })
})

describe('useAutosave — transient failure retries with bounds', () => {
  it('retries up to maxRetries then surfaces failed', async () => {
    const { mount, save } = mountAutosave({
      debounceMs: 10,
      maxRetries: 2,
      initialBackoffMs: 10,
      saveImpl: () => ({ ok: false, kind: 'transient', message: 'network' }),
    })
    act(() => mount.current.setDraft({ text: 'hi' }))
    await sleep(20)
    expect(mount.current.status).toBe('retrying')
    await sleep(20)
    expect(save).toHaveBeenCalledTimes(2)
    await sleep(30)
    expect(save).toHaveBeenCalledTimes(3)
    expect(mount.current.status).toBe('failed')
    await sleep(50)
    expect(save).toHaveBeenCalledTimes(3)
  })
})

describe('useAutosave — stale version becomes a conflict', () => {
  it('preserves the draft and exposes the server value', async () => {
    const { mount, save } = mountAutosave({
      debounceMs: 10,
      saveImpl: () => ({
        ok: false,
        kind: 'conflict',
        message: 'changed elsewhere',
        serverValue: { text: 'server' },
      }),
    })
    act(() => mount.current.setDraft({ text: 'mine' }))
    await sleep(30)
    expect(mount.current.status).toBe('conflict')
    expect(mount.current.serverValue).toEqual({ text: 'server' })
    expect(mount.current.draft).toEqual({ text: 'mine' })
    expect(mount.current.hasUnsavedWork).toBe(true)
    await sleep(50)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('discardDraft adopts the server value and clears the conflict', async () => {
    const { mount } = mountAutosave({
      debounceMs: 10,
      saveImpl: () => ({
        ok: false,
        kind: 'conflict',
        serverValue: { text: 'server' },
      }),
    })
    act(() => mount.current.setDraft({ text: 'mine' }))
    await sleep(30)
    act(() => mount.current.discardDraft())
    expect(mount.current.draft).toEqual({ text: 'server' })
    expect(mount.current.status).toBe('clean')
    expect(mount.current.serverValue).toBeNull()
  })

  it('retry re-attempts the save against the latest version', async () => {
    let attempt = 0
    const { mount, save } = mountAutosave({
      debounceMs: 10,
      saveImpl: () => {
        attempt += 1
        return attempt === 1
          ? { ok: false, kind: 'conflict', serverValue: { text: 'server' } }
          : { ok: true }
      },
    })
    act(() => mount.current.setDraft({ text: 'mine' }))
    await sleep(30)
    expect(mount.current.status).toBe('conflict')
    act(() => mount.current.retry())
    await sleep(30)
    expect(save).toHaveBeenCalledTimes(2)
    expect(mount.current.status).toBe('clean')
  })
})

describe('useAutosave — validation failures are permanent', () => {
  it('does not retry a server validation error and attaches it to the block', async () => {
    const { mount, save } = mountAutosave({
      debounceMs: 10,
      validate: () => [],
      saveImpl: () => ({ ok: false, kind: 'validation', message: 'bad' }),
    })
    act(() => mount.current.setDraft({ text: 'server-rejects-this' }))
    await sleep(30)
    expect(mount.current.status).toBe('failed')
    expect(mount.current.error).toBe('bad')
    expect(save).toHaveBeenCalledTimes(1)
    await sleep(50)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('does not save a locally-invalid draft and surfaces the local error', async () => {
    const { mount, save } = mountAutosave({
      debounceMs: 10,
      validate: (v) => (v.text.length > 3 ? ['too long'] : []),
    })
    act(() => mount.current.setDraft({ text: 'toolong' }))
    await sleep(30)
    expect(mount.current.status).toBe('failed')
    expect(mount.current.error).toBe('too long')
    expect(save).not.toHaveBeenCalled()
  })

  it('clears the failed state when the next edit validates', async () => {
    const { mount } = mountAutosave({
      debounceMs: 10,
      validate: (v) => (v.text.length > 3 ? ['too long'] : []),
      saveImpl: () => ({ ok: false, kind: 'validation', message: 'bad' }),
    })
    act(() => mount.current.setDraft({ text: 'toolong' }))
    await sleep(30)
    expect(mount.current.status).toBe('failed')
    act(() => mount.current.setDraft({ text: 'ok' }))
    expect(mount.current.status).toBe('dirty')
    expect(mount.current.error).toBeNull()
  })
})

describe('useAutosave — offline hold and flush', () => {
  it('does not save while offline and flushes on reconnect', async () => {
    const save = makeSave()
    const mount = mountHook(
      (props: { offline: boolean }) =>
        useAutosave<{ text: string }>({
          initialValue: { text: '' },
          validate: () => [],
          save,
          debounceMs: 20,
          offline: props.offline,
          touched: true,
        }),
      { offline: true },
    )
    act(() => mount.current.setDraft({ text: 'edit' }))
    await sleep(50)
    expect(save).not.toHaveBeenCalled()
    expect(mount.current.status).toBe('offline')
    mount.rerender({ offline: false })
    await sleep(50)
    expect(save).toHaveBeenCalledTimes(1)
    expect(mount.current.status).toBe('clean')
  })
})

describe('useAutosave — server-canonical reset', () => {
  it('resets the draft to the new canonical value while clean', async () => {
    const save = makeSave()
    const mount = mountHook(
      (props: { initialValue: { text: string } }) =>
        useAutosave<{ text: string }>({
          initialValue: props.initialValue,
          validate: () => [],
          save,
          debounceMs: 20,
          touched: true,
        }),
      { initialValue: { text: '' } },
    )
    mount.rerender({ initialValue: { text: 'from server' } })
    await sleep(5)
    expect(mount.current.draft).toEqual({ text: 'from server' })
    expect(mount.current.status).toBe('clean')
  })

  it('preserves a dirty draft when the server canonical changes', async () => {
    const save = makeSave()
    const mount = mountHook(
      (props: { initialValue: { text: string } }) =>
        useAutosave<{ text: string }>({
          initialValue: props.initialValue,
          validate: () => [],
          save,
          debounceMs: 20,
          touched: true,
        }),
      { initialValue: { text: '' } },
    )
    act(() => mount.current.setDraft({ text: 'my edit' }))
    mount.rerender({ initialValue: { text: 'from server' } })
    await sleep(5)
    expect(mount.current.draft).toEqual({ text: 'my edit' })
    expect(mount.current.hasUnsavedWork).toBe(true)
  })
})

describe('useAutosave — flush and navigation guard', () => {
  it('flush saves immediately without waiting for the debounce', async () => {
    const { mount, save } = mountAutosave({ debounceMs: 100 })
    act(() => mount.current.setDraft({ text: 'now' }))
    await act(async () => mount.current.flush())
    await sleep(5)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith({ text: 'now' })
  })

  it('hasUnsavedWork is the navigation-guard signal', async () => {
    const { mount } = mountAutosave({ debounceMs: 30 })
    expect(mount.current.hasUnsavedWork).toBe(false)
    act(() => mount.current.setDraft({ text: 'x' }))
    expect(mount.current.hasUnsavedWork).toBe(true)
    await sleep(60)
    expect(mount.current.hasUnsavedWork).toBe(false)
  })

  it('clears timers on unmount so no save fires after tab closure', async () => {
    const { mount, save, mount: m } = mountAutosave({ debounceMs: 50 })
    act(() => mount.current.setDraft({ text: 'pending' }))
    m.unmount()
    await sleep(100)
    expect(save).not.toHaveBeenCalled()
  })
})

// Silence the unused-typing warning for the Status alias re-export shape.
export type { Status }
