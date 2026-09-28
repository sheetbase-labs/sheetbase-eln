import { useSyncExternalStore } from 'react'

// One appearance setting (System, Light, Dark) stored in a cookie so the server-rendered page and the
// first paint agree. The inline script in <head> resolves "system" before anything is drawn.
export type ThemePref = 'system' | 'light' | 'dark'
export const THEME_COOKIE = 'sb-theme'

export const themeScript = `(function(){try{var m=document.cookie.match(/(?:^|; )${THEME_COOKIE}=(light|dark|system)/);var p=m?m[1]:'system';var d=p==='dark'||(p==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);var e=document.documentElement;e.dataset.theme=d?'dark':'light';e.dataset.themePref=p;}catch(e){}})();`

const listeners = new Set<() => void>()
// Snapshot is "pref|resolved". During hydration React uses the server snapshot, then re-renders with the
// real one, so the toggle icon never causes a hydration mismatch.
function read() {
  const el = document.documentElement
  return `${el.dataset.themePref || 'system'}|${el.dataset.theme || 'light'}`
}
function apply(pref: ThemePref) {
  const dark =
    pref === 'dark' ||
    (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  const el = document.documentElement
  el.dataset.theme = dark ? 'dark' : 'light'
  el.dataset.themePref = pref
  document.cookie = `${THEME_COOKIE}=${pref}; path=/; max-age=31536000; samesite=lax`
  listeners.forEach((l) => l())
}

export function useTheme() {
  const snap = useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
    read,
    () => 'system|light',
  )
  const [pref, resolved] = snap.split('|') as [ThemePref, 'light' | 'dark']
  return {
    pref,
    resolved,
    setPref: apply,
    toggle: () => apply(resolved === 'dark' ? 'light' : 'dark'),
  }
}
