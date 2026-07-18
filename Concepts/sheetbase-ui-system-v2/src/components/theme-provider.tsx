import * as React from 'react'

type Theme = 'light' | 'dark' | 'system'
type Density = 'comfortable' | 'compact'
type ThemeContextValue = { theme: Theme; setTheme: (theme: Theme) => void; density: Density; setDensity: (density: Density) => void }
const ThemeContext = React.createContext<ThemeContextValue | null>(null)

function applyTheme(theme: Theme) {
  const root = document.documentElement
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  root.classList.toggle('dark', dark)
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<Theme>('light')
  const [density, setDensityState] = React.useState<Density>('comfortable')
  React.useEffect(() => {
    const savedTheme = (localStorage.getItem('sheetbase-theme') as Theme | null) ?? 'light'
    const savedDensity = (localStorage.getItem('sheetbase-density') as Density | null) ?? 'comfortable'
    setThemeState(savedTheme)
    setDensityState(savedDensity)
    applyTheme(savedTheme)
    document.documentElement.dataset.density = savedDensity
  }, [])
  const setTheme = (next: Theme) => { setThemeState(next); localStorage.setItem('sheetbase-theme', next); applyTheme(next) }
  const setDensity = (next: Density) => { setDensityState(next); localStorage.setItem('sheetbase-density', next); document.documentElement.dataset.density = next }
  return <ThemeContext.Provider value={{ theme, setTheme, density, setDensity }}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const value = React.useContext(ThemeContext)
  if (!value) throw new Error('useTheme must be used within ThemeProvider')
  return value
}
