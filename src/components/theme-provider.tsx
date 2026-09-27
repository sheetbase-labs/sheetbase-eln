'use client'

import * as React from 'react'

import { createDataClient } from '#/lib/data-client'
import { fetchUserPreferences, setUserAppearance } from '#/lib/user-preferences'
import type { Appearance } from '#/lib/user-preferences'

type Theme = Appearance

interface ThemeContextValue {
  theme: Theme
  setTheme: (theme: Theme) => void
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null)

const THEME_STORAGE_KEY = 'sheetbase-theme'

function readCachedTheme(): Theme {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY)
    if (value === 'light' || value === 'dark' || value === 'system')
      return value
  } catch {
    /* private mode / disabled storage */
  }
  return 'system'
}

function applyTheme(theme: Theme) {
  const root = document.documentElement
  const dark =
    theme === 'dark' ||
    (theme === 'system' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches)
  root.classList.toggle('dark', dark)
}

function cacheTheme(theme: Theme) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    /* ignore */
  }
}

/**
 * Theme provider for the application shell (SHELL-02).
 *
 * The appearance setting is per user (System/Light/Dark). `localStorage` is an
 * instant cache for the no-flash script; the server value is the source of
 * truth and is read once signed in, then written back through
 * `set_user_appearance` on change.
 */
export function ThemeProvider({
  children,
  authenticated = false,
}: {
  children: React.ReactNode
  authenticated?: boolean
}) {
  const [theme, setThemeState] = React.useState<Theme>('system')
  const client = React.useMemo(
    () => (typeof window === 'undefined' ? null : createDataClient()),
    [],
  )

  React.useEffect(() => {
    const cached = readCachedTheme()
    setThemeState(cached)
    applyTheme(cached)
  }, [])

  // Adopt the server value when it differs from the local cache.
  React.useEffect(() => {
    if (!authenticated || !client) return
    let cancelled = false
    void fetchUserPreferences(client)
      .then((preferences) => {
        if (cancelled || !preferences) return
        const appearance = preferences.appearance
        setThemeState((current) => {
          if (current === appearance) return current
          applyTheme(appearance)
          cacheTheme(appearance)
          return appearance
        })
      })
      .catch(() => {
        /* offline or signed out: keep the cached theme */
      })
    return () => {
      cancelled = true
    }
  }, [authenticated, client])

  const setTheme = React.useCallback(
    (next: Theme) => {
      setThemeState(next)
      cacheTheme(next)
      applyTheme(next)
      if (authenticated && client) {
        void setUserAppearance(client, next).catch(() => {
          /* keep the local choice even if the write fails */
        })
      }
    },
    [authenticated, client],
  )

  const value = React.useMemo<ThemeContextValue>(
    () => ({ theme, setTheme }),
    [theme, setTheme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const value = React.useContext(ThemeContext)
  if (!value) {
    throw new Error('useTheme must be used within ThemeProvider')
  }
  return value
}
