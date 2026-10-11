/**
 * R5-SHELL-02: the appearance preference lives in the `sb-theme` cookie (the
 * name the design uses) so the server can read it and render the correct theme
 * on the first paint. The cookie is the single source of truth; the client
 * store writes it, the root document reads it server-side, and the inline
 * no-flash script resolves it before hydration.
 *
 * This module is deliberately framework- and runtime-neutral: it is imported
 * by the server-only root loader, the client store and the inline script so the
 * cookie name, the accepted values and the parse rule are defined once.
 */
export type ThemePref = 'system' | 'light' | 'dark'

/** The cookie the server can read; the design's `sb-theme`. */
export const THEME_COOKIE = 'sb-theme'

/**
 * The client-side cache key. It is *not* a second value store: the store writes
 * the preference under this key only so a `storage` event reaches other open
 * tabs, which then re-read the cookie. It also carries any preference written
 * by a browser before the cookie existed, so that choice is not lost.
 */
export const THEME_STORAGE_KEY = 'sheetbase-theme'

export function isThemePref(value: unknown): value is ThemePref {
  return value === 'system' || value === 'light' || value === 'dark'
}

/**
 * Parse the preference from a `Cookie` request header or from
 * `document.cookie` — both use the same `name=value; name=value` syntax.
 * Returns `null` when the cookie is absent or holds an unknown value, so the
 * caller can fall back to the device's system setting rather than guess.
 */
export function parseThemeCookie(
  raw: string | null | undefined,
): ThemePref | null {
  if (!raw) return null
  const match = raw.match(/(?:^|;\s*)sb-theme=(light|dark|system)(?:;|$)/)
  const value = match?.[1]
  return isThemePref(value) ? value : null
}

/** Serialise the cookie the way the design stores it (one device, one year). */
export function themeCookieString(pref: ThemePref): string {
  return `${THEME_COOKIE}=${pref}; path=/; max-age=31536000; samesite=lax`
}

/**
 * The inline no-flash script, run synchronously in `<head>` before anything is
 * drawn. It reads the same cookie the server read and, when the preference is
 * `system` (or the cookie is absent), resolves it against the device setting.
 * The server cannot know a device's system setting, so this is the one part of
 * the decision that must happen in the browser.
 */
export const themeScript = `(function(){try{var m=document.cookie.match(/(?:^|;\\s*)${THEME_COOKIE}=(light|dark|system)(?:;|$)/);var p=m?m[1]:'system';var d=p==='dark'||(p==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var e=document.documentElement;e.classList.toggle('dark',d);e.dataset.theme=d?'dark':'light';e.dataset.themePref=p;}catch(e){}})();`
