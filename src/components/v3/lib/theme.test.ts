import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** A minimal matchMedia stub that records its change listener. */
function stubMatchMedia(matches: boolean) {
  const listeners = new Set<(e: { matches: boolean }) => void>()
  const mql = {
    matches,
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_: string, cb: (e: { matches: boolean }) => void) => {
      listeners.add(cb)
    },
    removeEventListener: (_: string, cb: (e: { matches: boolean }) => void) => {
      listeners.delete(cb)
    },
  }
  vi.stubGlobal('matchMedia', () => mql)
  return {
    emit(next: boolean) {
      mql.matches = next
      listeners.forEach((cb) => cb({ matches: next }))
    },
  }
}

/** A fresh store module per test, so its one-time listeners are re-installed. */
async function loadStore(matches = false) {
  vi.resetModules()
  const mm = stubMatchMedia(matches)
  const mod = await import('./theme')
  return { mod, mm }
}

describe('appearance store (SHELL-02)', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.className = ''
    delete document.documentElement.dataset.theme
    delete document.documentElement.dataset.themePref
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('applies a preference to the DOM, the cache and subscribers', async () => {
    const { mod } = await loadStore(false)
    const seen: string[] = []
    const unsubscribe = mod.subscribeTheme(() => seen.push(mod.readThemePref()))
    mod.applyThemePref('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.dataset.themePref).toBe('dark')
    expect(localStorage.getItem(mod.THEME_STORAGE_KEY)).toBe('dark')
    expect(seen).toContain('dark')
    unsubscribe()
  })

  it('follows a System change while the preference is system', async () => {
    const { mod, mm } = await loadStore(false)
    mod.initTheme()
    mod.applyThemePref('system')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    mm.emit(true)
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('ignores a System change once an explicit theme is chosen', async () => {
    const { mod, mm } = await loadStore(false)
    mod.initTheme()
    mod.applyThemePref('light')
    mm.emit(true)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('adopts a preference written by another tab', async () => {
    const { mod } = await loadStore(false)
    mod.initTheme()
    mod.applyThemePref('light')
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: mod.THEME_STORAGE_KEY,
        newValue: 'dark',
      }),
    )
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(mod.readThemePref()).toBe('dark')
  })
})
