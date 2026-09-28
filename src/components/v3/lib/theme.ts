import { useSyncExternalStore } from 'react'

/**
 * UI port: the appearance setting is unified with the ELN's theme provider —
 * the same `sheetbase-theme` localStorage key and the same `.dark` class on
 * <html> (the no-flash script in the root already applies it). `data-theme` is
 * set too so any ported markup that keys off it agrees.
 */
export type ThemePref = 'system' | 'light' | 'dark'
export const THEME_STORAGE_KEY = 'sheetbase-theme'

const listeners = new Set<() => void>()

function read(): string {
  try {
    return (
      localStorage.getItem(THEME_STORAGE_KEY) ??
      document.documentElement.dataset.themePref ??
      'system'
    )
  } catch {
    return 'system'
  }
}

function apply(pref: ThemePref) {
  const dark =
    pref === 'dark' ||
    (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  const el = document.documentElement
  el.classList.toggle('dark', dark)
  el.dataset.theme = dark ? 'dark' : 'light'
  el.dataset.themePref = pref
  try {
    localStorage.setItem(THEME_STORAGE_KEY, pref)
  } catch {
    /* private mode / disabled storage */
  }
  listeners.forEach((l) => l())
}

export function useTheme() {
  const pref = useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
    read,
    () => 'system',
  ) as ThemePref
  return {
    pref,
    setPref: apply,
    toggle: () => apply(pref === 'dark' ? 'light' : 'dark'),
  }
}
