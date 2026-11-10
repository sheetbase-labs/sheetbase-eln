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

  it('does not ask persisted when persist is not callable', async () => {
    const persisted = vi.fn().mockResolvedValue(true)
    vi.stubGlobal('navigator', { storage: { persisted, persist: 'blocked' } })
    expect(await requestPersistentStorage()).toBe(false)
    expect(persisted).not.toHaveBeenCalled()
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
    const container = Object.assign(new EventTarget(), {
      register: vi.fn().mockResolvedValue({}),
      ready: Promise.resolve({ active: { postMessage: vi.fn() } }),
    })

    vi.stubGlobal('navigator', {
      serviceWorker: container,
    })
    const seen = vi.fn()
    window.addEventListener(OFFLINE_SYNC_EVENT, seen)
    const stop = await startOfflineSupport()

    try {
      for (const data of [null, undefined, 0, 'replay', { type: 'other' }]) {
        container.dispatchEvent(new MessageEvent('message', { data }))
      }

      container.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'sheetbase:replay' },
        }),
      )
      expect(seen).toHaveBeenCalledOnce()

      const array = Object.assign([], { type: 'sheetbase:replay' })
      container.dispatchEvent(new MessageEvent('message', { data: array }))
      let reads = 0
      container.dispatchEvent(
        new MessageEvent('message', {
          data: {
            get type() {
              reads++

              return 'sheetbase:replay'
            },
          },
        }),
      )
      expect(reads).toBe(1)
      expect(seen).toHaveBeenCalledTimes(3)
      stop()
      container.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'sheetbase:replay' },
        }),
      )
      expect(seen).toHaveBeenCalledTimes(3)
    } finally {
      stop()
      window.removeEventListener(OFFLINE_SYNC_EVENT, seen)
    }
  })
})
