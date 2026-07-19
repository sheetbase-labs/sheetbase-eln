import { describe, expect, it, beforeEach } from 'vitest'

import {
  getOrCreateClientId,
  getClientId,
  CLIENT_ID_HEADER,
} from './client-identity'

function makeStorage(): Storage {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v)
    },
    removeItem: (k: string) => {
      map.delete(k)
    },
    clear: () => map.clear(),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size
    },
  }
}

describe('client-identity', () => {
  let storage: Storage
  beforeEach(() => {
    storage = makeStorage()
  })

  it('mints a uuid-shaped id on first access and persists it', () => {
    const id = getOrCreateClientId(storage)
    expect(id).toBeTruthy()
    expect(id).toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/,
    )
    expect(storage.getItem('sheetbase-client-id')).toBe(id)
  })

  it('returns the same id on subsequent calls within the tab', () => {
    const a = getOrCreateClientId(storage)
    const b = getOrCreateClientId(storage)
    expect(a).toBe(b)
  })

  it('getClientId reads without minting', () => {
    expect(getClientId(storage)).toBeNull()
    const id = getOrCreateClientId(storage)
    expect(getClientId(storage)).toBe(id)
  })

  it('returns null when storage is unavailable (SSR / blocked)', () => {
    expect(getOrCreateClientId(null)).toBeNull()
    expect(getClientId(null)).toBeNull()
  })

  it('two separate storage instances get distinct ids (two-tab semantics)', () => {
    const tabA = makeStorage()
    const tabB = makeStorage()
    const a = getOrCreateClientId(tabA)
    const b = getOrCreateClientId(tabB)
    expect(a).not.toBe(b)
  })

  it('exposes a stable header name for the proxy', () => {
    expect(CLIENT_ID_HEADER).toBe('x-sheetbase-client-id')
  })
})
