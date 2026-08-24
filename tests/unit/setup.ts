/**
 * Unit test environment setup (vitest.config.ts `setupFiles`).
 *
 * Node ≥ 26 ships an experimental global `localStorage` that is inert unless
 * Node runs with `--localstorage-file`. Its presence on the global object
 * makes vitest's jsdom environment skip installing jsdom's own storage
 * bindings, so every test sees a broken `localStorage`
 * (`Cannot read properties of undefined (reading 'getItem')`). The repo
 * pins Node 22 where this collision does not occur; this setup restores a
 * functional web-storage implementation on any Node so the suites are
 * runtime-independent.
 *
 * It also provides the standard `matchMedia` stub jsdom lacks, used by the
 * theme provider's system-theme resolution.
 */

function isFunctionalStorage(candidate: unknown): candidate is Storage {
  if (typeof candidate !== 'object' || candidate === null) return false
  // Method presence is verified dynamically below; the try/catch treats any
  // missing member as "not functional".
  const storage = candidate as Storage
  try {
    const probe = '__sheetbase_storage_probe__'
    storage.setItem(probe, '1')
    const ok = storage.getItem(probe) === '1'
    storage.removeItem(probe)
    return ok && typeof storage.clear === 'function'
  } catch {
    return false
  }
}

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (key) => (map.has(key) ? (map.get(key) as string) : null),
    key: (index) => Array.from(map.keys())[index] ?? null,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => void map.set(key, String(value)),
  }
}

for (const name of ['localStorage', 'sessionStorage'] as const) {
  if (!isFunctionalStorage(globalThis[name])) {
    Object.defineProperty(globalThis, name, {
      value: memoryStorage(),
      configurable: true,
      writable: true,
    })
  }
}

if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}
