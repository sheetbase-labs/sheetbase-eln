'use client'

import * as React from 'react'

type Theme = 'light' | 'dark' | 'system'
type Density = 'comfortable' | 'compact'

interface ThemeContextValue {
  theme: Theme
  setTheme: (theme: Theme) => void
  density: Density
  setDensity: (density: Density) => void
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null)

const THEME_STORAGE_KEY = 'sheetbase-theme'
const DENSITY_STORAGE_KEY = 'sheetbase-density'

function applyTheme(theme: Theme) {
  const root = document.documentElement
  const dark =
    theme === 'dark' ||
    (theme === 'system' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches)
  root.classList.toggle('dark', dark)
}

/**
 * Theme and density provider for the application shell.
 *
 * - Theme: light/dark/system, persisted to localStorage, applied via the
 *   `.dark` class on <html>. Dark mode preserves the same hierarchy as
 *   light mode (DESIGN.md §1), it is not a simple inversion.
 * - Density: comfortable/compact, persisted to localStorage, applied via
 *   `data-density` on <html>. Compact shrinks the root font size from 16px
 *   to 15px so 8px-grid spacing tightens without text dropping below the
 *   design baseline.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<Theme>('light')
  const [density, setDensityState] = React.useState<Density>('comfortable')

  React.useEffect(() => {
    const savedTheme =
      (localStorage.getItem(THEME_STORAGE_KEY) as Theme | null) ?? 'light'
    const savedDensity =
      (localStorage.getItem(DENSITY_STORAGE_KEY) as Density | null) ??
      'comfortable'
    setThemeState(savedTheme)
    setDensityState(savedDensity)
    applyTheme(savedTheme)
    document.documentElement.dataset.density = savedDensity
  }, [])

  const setTheme = React.useCallback((next: Theme) => {
    setThemeState(next)
    localStorage.setItem(THEME_STORAGE_KEY, next)
    applyTheme(next)
  }, [])

  const setDensity = React.useCallback((next: Density) => {
    setDensityState(next)
    localStorage.setItem(DENSITY_STORAGE_KEY, next)
    document.documentElement.dataset.density = next
  }, [])

  const value = React.useMemo<ThemeContextValue>(
    () => ({ theme, setTheme, density, setDensity }),
    [theme, setTheme, density, setDensity],
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
