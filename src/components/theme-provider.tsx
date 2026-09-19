'use client'

import * as React from 'react'

type Theme = 'light' | 'dark' | 'system'

interface ThemeContextValue {
  theme: Theme
  setTheme: (theme: Theme) => void
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null)

const THEME_STORAGE_KEY = 'sheetbase-theme'

function applyTheme(theme: Theme) {
  const root = document.documentElement
  const dark =
    theme === 'dark' ||
    (theme === 'system' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches)
  root.classList.toggle('dark', dark)
}

/**
 * Theme provider for the application shell.
 *
 * Theme: light/dark/system, persisted to localStorage, applied via the
 * `.dark` class on <html>. Dark mode preserves the same hierarchy as
 * light mode (DESIGN.md §1), it is not a simple inversion.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<Theme>('light')

  React.useEffect(() => {
    const savedTheme =
      (localStorage.getItem(THEME_STORAGE_KEY) as Theme | null) ?? 'light'
    setThemeState(savedTheme)
    applyTheme(savedTheme)
  }, [])

  const setTheme = React.useCallback((next: Theme) => {
    setThemeState(next)
    localStorage.setItem(THEME_STORAGE_KEY, next)
    applyTheme(next)
  }, [])

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
