import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { THEME_COOKIE } from '#/lib/theme-cookie'

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

function clearThemeCookie() {
  document.cookie = `${THEME_COOKIE}=; path=/; max-age=0`
}

describe('appearance store (SHELL-02)', () => {
  beforeEach(() => {
    localStorage.clear()
    clearThemeCookie()
    document.documentElement.className = ''
    delete document.documentElement.dataset.theme
    delete document.documentElement.dataset.themePref
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('applies a preference to the DOM, the cookie and subscribers', async () => {
    const { mod } = await loadStore(false)
    const seen: string[] = []
    const unsubscribe = mod.subscribeTheme(() => seen.push(mod.readThemePref()))
    mod.applyThemePref('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.dataset.themePref).toBe('dark')
    expect(document.cookie).toContain(`${THEME_COOKIE}=dark`)
    expect(mod.readStoredThemePref()).toBe('dark')
    expect(seen).toContain('dark')
    unsubscribe()
  })

  it('reads a preference the server put in the cookie', async () => {
    document.cookie = `${THEME_COOKIE}=dark; path=/`
    const { mod } = await loadStore(false)
    expect(mod.readStoredThemePref()).toBe('dark')
    expect(mod.readThemePref()).toBe('dark')
  })

  it('reports no stored preference when the cookie is absent', async () => {
    const { mod } = await loadStore(false)
    expect(mod.readStoredThemePref()).toBeNull()
    expect(mod.readThemePref()).toBe('system')
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
    // Another tab writes the shared cookie, then the cross-tab token.
    document.cookie = `${THEME_COOKIE}=dark; path=/`
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: mod.THEME_STORAGE_KEY,
        newValue: 'dark',
      }),
    )
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(mod.readThemePref()).toBe('dark')
  })

  it('migrates a legacy localStorage choice into the cookie', async () => {
    localStorage.setItem('sheetbase-theme', 'dark')
    const { mod } = await loadStore(false)
    expect(mod.readStoredThemePref()).toBe('dark')
    mod.initTheme()
    expect(document.cookie).toContain(`${THEME_COOKIE}=dark`)
  })
})
