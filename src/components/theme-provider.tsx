'use client'

import * as React from 'react'

import { createDataClient } from '#/lib/data-client'
import { fetchUserPreferences, setUserAppearance } from '#/lib/user-preferences'
import type { Appearance } from '#/lib/user-preferences'
import {
  applyThemePref,
  initTheme,
  readStoredThemePref,
  useTheme as useThemeStore,
} from '#/components/v3/lib/theme'

type Theme = Appearance

interface ThemeContextValue {
  theme: Theme
  setTheme: (theme: Theme) => void
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null)

/**
 * Theme provider for the application shell (SHELL-02).
 *
 * Appearance is per user (System/Light/Dark). The shared store
 * (`#/components/v3/lib/theme`) owns the cache, the DOM and the cross-tab and
 * System listeners; this provider adds the server read/write so the server
 * preference is the source of truth once signed in.
 */
export function ThemeProvider({
  children,
  authenticated = false,
}: {
  children: React.ReactNode
  authenticated?: boolean
}) {
  const { pref, setPref } = useThemeStore()
  const client = React.useMemo(
    () => (typeof window === 'undefined' ? null : createDataClient()),
    [],
  )
  const adopted = React.useRef(false)

  React.useEffect(() => {
    initTheme()
  }, [])

  // Adopt the server value once, and only on a device that has not chosen for
  // itself. The interface's appearance is a per-device choice (`sb-theme`), so
  // a server default must never silently overwrite what this device stored.
  React.useEffect(() => {
    if (!authenticated || !client || adopted.current) return
    if (readStoredThemePref() !== null) {
      adopted.current = true
      return
    }
    let cancelled = false
    void fetchUserPreferences(client)
      .then((preferences) => {
        if (cancelled || !preferences) return
        adopted.current = true
        if (preferences.appearance !== pref) setPref(preferences.appearance)
      })
      .catch(() => {
        /* offline or signed out: keep the cached theme */
      })
    return () => {
      cancelled = true
    }
  }, [authenticated, client, pref, setPref])

  const setTheme = React.useCallback(
    (next: Theme) => {
      setPref(next)
      if (authenticated && client) {
        void setUserAppearance(client, next).catch(() => {
          /* keep the local choice even if the write fails */
        })
      }
    },
    [authenticated, client, setPref],
  )

  const value = React.useMemo<ThemeContextValue>(
    () => ({ theme: pref, setTheme }),
    [pref, setTheme],
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

export { applyThemePref }
