import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  OFFLINE_SYNC_EVENT,
  requestBackgroundSync,
  requestPersistentStorage,
  startOfflineSupport,
} from './service-worker'

afterEach(() => vi.unstubAllGlobals())

describe('requestPersistentStorage', () => {
  it('asks once and reports the answer', async () => {
    const persist = vi.fn().mockResolvedValue(true)
    vi.stubGlobal('navigator', {
      storage: { persisted: vi.fn().mockResolvedValue(false), persist },
    })
    expect(await requestPersistentStorage()).toBe(true)
    expect(persist).toHaveBeenCalledOnce()
  })

  it('does not ask again once granted', async () => {
    const persist = vi.fn()
    vi.stubGlobal('navigator', {
      storage: { persisted: vi.fn().mockResolvedValue(true), persist },
    })
    expect(await requestPersistentStorage()).toBe(true)
    expect(persist).not.toHaveBeenCalled()
  })

  it('is false when the browser has no storage API', async () => {
    vi.stubGlobal('navigator', {})
    expect(await requestPersistentStorage()).toBe(false)
  })
})

describe('requestBackgroundSync', () => {
  it('registers the replay tag', async () => {
    const register = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', {
      serviceWorker: { ready: Promise.resolve({ sync: { register } }) },
    })
    expect(await requestBackgroundSync()).toBe(true)
    expect(register).toHaveBeenCalledWith('sheetbase-replay')
  })

  it('is false where background sync is missing', async () => {
    vi.stubGlobal('navigator', {
      serviceWorker: { ready: Promise.resolve({}) },
    })
    expect(await requestBackgroundSync()).toBe(false)
  })
})

describe('startOfflineSupport', () => {
  it('turns the worker wake-up into a window event', async () => {
    const listeners: Array<(e: MessageEvent) => void> = []
    vi.stubGlobal('navigator', {
      serviceWorker: {
        addEventListener: (_: string, l: (e: MessageEvent) => void) =>
          listeners.push(l),
        removeEventListener: vi.fn(),
        register: vi.fn().mockResolvedValue({}),
        ready: Promise.resolve({ active: { postMessage: vi.fn() } }),
      },
    })
    const seen = vi.fn()
    window.addEventListener(OFFLINE_SYNC_EVENT, seen)
    await startOfflineSupport()
    listeners[0]({ data: { type: 'sheetbase:replay' } } as MessageEvent)
    expect(seen).toHaveBeenCalledOnce()
    window.removeEventListener(OFFLINE_SYNC_EVENT, seen)
  })
})
