import { vi, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { ThemeProvider, useTheme } from './theme-provider'

function Probe() {
  const { theme } = useTheme()
  return (
    <div>
      <span data-testid="theme">{theme}</span>
    </div>
  )
}

describe('ThemeProvider', () => {
  it('provides a default light theme', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    )
    expect(screen.getByTestId('theme').textContent).toBe('light')
  })

  it('throws when useTheme is used without a provider', () => {
    // Suppress the error boundary noise from React in this expected-throw test.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Probe />)).toThrow(
      'useTheme must be used within ThemeProvider',
    )
    spy.mockRestore()
  })
})
