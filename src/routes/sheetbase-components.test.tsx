import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Route, SheetbaseComponentsDemo } from './sheetbase-components'

/**
 * COMP-05 Check-it: the development-only surface renders the
 * `@sheetbase-labs/sheetbase-table` grid, and the grid's own scope element is
 * the one the ELN token mapping in `src/styles.css` targets (asserted by
 * src/lib/sheetbase-components.test.ts). Production builds redirect away and
 * the route is not part of the product navigation.
 */
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('/sheetbase-components route gate (COMP-05)', () => {
  it('does not redirect in dev/test', () => {
    expect(() => Route.options.beforeLoad?.({} as never)).not.toThrow()
  })

  it('redirects to / in production builds', () => {
    vi.stubEnv('PROD', true)
    try {
      Route.options.beforeLoad?.({} as never)
      throw new Error('expected beforeLoad to throw a redirect')
    } catch (err) {
      expect(err).toBeInstanceOf(Response)
      const res = err as Response & { options?: { to?: string } }
      expect(res.status).toBe(307)
      expect(res.options?.to).toBe('/')
    }
  })
})

describe('sheetbase components demo surface (COMP-05)', () => {
  it('renders the package grid inside the host-mapped scope', () => {
    render(<SheetbaseComponentsDemo />)

    const demo = screen.getByTestId('sheetbase-components-demo')
    const scope = demo.querySelector('.sheetbase-scope.spreadsheet')

    expect(scope).not.toBeNull()
    expect(scope?.getAttribute('data-theme')).toBe('light')
  })
})
