import { useSyncExternalStore } from 'react'

/**
 * SHELL-02: the single appearance store.
 *
 * The ELN's `ThemeProvider` and the v3 shell both read and write this store, so
 * the account menu, the profile page, the legacy shell and the ported shell
 * agree. It owns the `sheetbase-theme` cache, the `.dark` class, `data-theme`
 * and `data-theme-pref`, and it reacts to cross-tab changes (`storage`) and to
 * live System changes (`prefers-color-scheme`).
 */
export type ThemePref = 'system' | 'light' | 'dark'
export const THEME_STORAGE_KEY = 'sheetbase-theme'

const listeners = new Set<() => void>()

function isPref(value: unknown): value is ThemePref {
  return value === 'system' || value === 'light' || value === 'dark'
}

/** The preference: the local cache, else what the no-flash script set, else system. */
export function readThemePref(): ThemePref {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY)
    if (isPref(value)) return value
    const attr = document.documentElement.dataset.themePref
    if (isPref(attr)) return attr
  } catch {
    /* private mode / disabled storage */
  }
  return 'system'
}

function prefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  )
}

/** Apply a preference everywhere and notify every subscriber. */
export function applyThemePref(pref: ThemePref) {
  const dark = pref === 'dark' || (pref === 'system' && prefersDark())
  if (typeof document !== 'undefined') {
    const el = document.documentElement
    el.classList.toggle('dark', dark)
    el.dataset.theme = dark ? 'dark' : 'light'
    el.dataset.themePref = pref
  }
  try {
    localStorage.setItem(THEME_STORAGE_KEY, pref)
  } catch {
    /* private mode / disabled storage */
  }
  listeners.forEach((l) => l())
}

let installed = false

/** Install the cross-tab and System listeners once, on the client. */
export function initTheme() {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('storage', (event) => {
    if (event.key !== THEME_STORAGE_KEY) return
    if (isPref(event.newValue)) applyThemePref(event.newValue)
  })
  if (typeof window.matchMedia === 'function') {
    window
      .matchMedia('(prefers-color-scheme: dark)')
      .addEventListener('change', () => {
        if (readThemePref() === 'system') applyThemePref('system')
      })
  }
}

/** Subscribe to preference changes; returns an unsubscribe. */
export function subscribeTheme(cb: () => void) {
  initTheme()
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function useTheme() {
  const pref = useSyncExternalStore<ThemePref>(
    subscribeTheme,
    readThemePref,
    () => 'system',
  )
  return {
    pref,
    setPref: applyThemePref,
    toggle: () => applyThemePref(pref === 'dark' ? 'light' : 'dark'),
  }
}
