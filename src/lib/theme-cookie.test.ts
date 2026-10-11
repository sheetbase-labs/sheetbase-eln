import { describe, expect, it } from 'vitest'

import {
  THEME_COOKIE,
  isThemePref,
  parseThemeCookie,
  themeCookieString,
} from './theme-cookie'

describe('theme cookie (R5-SHELL-02)', () => {
  it('uses the design cookie name', () => {
    expect(THEME_COOKIE).toBe('sb-theme')
  })

  it('parses each accepted value from a Cookie header', () => {
    expect(parseThemeCookie(`${THEME_COOKIE}=dark`)).toBe('dark')
    expect(parseThemeCookie(`${THEME_COOKIE}=light`)).toBe('light')
    expect(parseThemeCookie(`${THEME_COOKIE}=system`)).toBe('system')
  })

  it('finds the theme among other cookies and after whitespace', () => {
    const header = `session=abc; ${THEME_COOKIE}=dark; locale=en`
    expect(parseThemeCookie(header)).toBe('dark')
  })

  it('returns null for an absent, empty or unknown cookie', () => {
    expect(parseThemeCookie(null)).toBeNull()
    expect(parseThemeCookie('')).toBeNull()
    expect(parseThemeCookie('session=abc')).toBeNull()
    expect(parseThemeCookie(`${THEME_COOKIE}=sepia`)).toBeNull()
    // A cookie whose name merely ends with the theme name must not match.
    expect(parseThemeCookie(`x${THEME_COOKIE}=dark`)).toBeNull()
  })

  it('serialises a preference with a persistent, same-site policy', () => {
    expect(themeCookieString('dark')).toBe(
      `${THEME_COOKIE}=dark; path=/; max-age=31536000; samesite=lax`,
    )
  })

  it('narrows only the three appearance values', () => {
    expect(isThemePref('system')).toBe(true)
    expect(isThemePref('sepia')).toBe(false)
    expect(isThemePref(undefined)).toBe(false)
  })
})
