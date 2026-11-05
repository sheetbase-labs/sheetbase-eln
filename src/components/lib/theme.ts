import { useSyncExternalStore } from 'react'

import {
  THEME_COOKIE,
  THEME_STORAGE_KEY,
  isThemePref,
  parseThemeCookie,
  themeCookieString,
} from '#/lib/theme-cookie'
import type { ThemePref } from '#/lib/theme-cookie'

export { THEME_COOKIE, THEME_STORAGE_KEY }
export type { ThemePref }

/**
 * SHELL-02: the single appearance store.
 *
 * The ELN's `ThemeProvider` and the v3 shell both read and write this store, so
 * the account menu, the profile page, the legacy shell and the ported shell
 * agree. R5-SHELL-02 moves the preference into the `sb-theme` cookie so the
 * server can read it at first paint; the store owns that cookie, the `.dark`
 * class, `data-theme`, `data-theme-pref`, and it reacts to cross-tab changes
 * and to live System changes (`prefers-color-scheme`).
 */
const listeners = new Set<() => void>()

/** The stored preference, or `null` when this device has not chosen one. */
export function readStoredThemePref(): ThemePref | null {
  if (typeof document === 'undefined') return null
  try {
    const fromCookie = parseThemeCookie(document.cookie)
    if (fromCookie) return fromCookie
    // A device that chose before the cookie existed: keep that choice rather
    // than silently reverting it to System. `applyThemePref` rewrites it as a
    // cookie on the next change, and `initTheme` migrates it on first mount.
    const legacy = localStorage.getItem(THEME_STORAGE_KEY)
    return isThemePref(legacy) ? legacy : null
  } catch {
    /* private mode / disabled storage */
    return null
  }
}

/** The preference: this device's stored choice, else the resolved System setting. */
export function readThemePref(): ThemePref {
  return readStoredThemePref() ?? 'system'
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
    try {
      document.cookie = themeCookieString(pref)
    } catch {
      /* cookie writes can be blocked; the DOM still reflects the choice */
    }
  }
  // Write the cross-tab token *after* the cookie so another tab that reacts to
  // the token finds the new value already in the shared cookie jar.
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
  // Migrate a preference this device chose before the cookie existed, so the
  // server paints it correctly from the next request on.
  if (
    readStoredThemePref() !== null &&
    parseThemeCookie(document.cookie) === null
  ) {
    applyThemePref(readThemePref())
  }
  window.addEventListener('storage', (event) => {
    if (event.key !== THEME_STORAGE_KEY) return
    const stored = parseThemeCookie(document.cookie)
    if (stored) applyThemePref(stored)
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
