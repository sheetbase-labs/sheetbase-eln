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
 *
 * `@tanstack/react-virtual` is replaced with a synchronous window that renders
 * every row. jsdom has no layout, so the real virtualizer measures a zero-height
 * scroll viewport and returns no items at all; without this stub every grid
 * screen (the shared registry grid on the registry and detail screens) renders
 * an empty body in unit tests, and assertions on row content cannot run. The
 * stub preserves the window contract the grid reads (`getVirtualItems`,
 * `getTotalSize`, `measureElement`, `scrollToIndex`, `measure`, `scrollToOffset`)
 * while deliberately ignoring layout. Browser specs still exercise the real
 * virtualizer.
 */
import { vi } from 'vitest'

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (options: {
    count: number
    estimateSize?: (index: number) => number
    getItemKey?: (index: number) => string | number
  }) => {
    const estimate = (index: number) => options.estimateSize?.(index) ?? 33
    let offset = 0
    const items = Array.from({ length: options.count }, (_, index) => {
      const size = estimate(index)
      const start = offset
      offset += size
      return {
        index,
        key: options.getItemKey?.(index) ?? index,
        start,
        end: offset,
        size,
        lane: 0,
      }
    })
    return {
      getVirtualItems: () => items,
      getTotalSize: () => offset,
      getOffsetForIndex: () => [0, 'start'] as const,
      measure: () => {},
      measureElement: () => {},
      scrollToIndex: () => {},
      scrollToOffset: () => {},
    }
  },
}))

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
