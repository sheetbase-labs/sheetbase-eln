import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { ThemeProvider } from '#/components/theme-provider'
import { Route, ComponentCompareRoute } from './component-compare'

/**
 * ADR-0055: the comparison harness is a development-only surface. Production
 * builds redirect to `/`, and it is not part of the product navigation or the
 * app shell — the same terms as `/foundations` and `/sheetbase-components`.
 */
afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

describe('/component-compare route gate', () => {
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

describe('component comparison surface', () => {
  it('renders one column per side of the registered pair, on the shared fixture', () => {
    render(
      <ThemeProvider>
        <ComponentCompareRoute />
      </ThemeProvider>,
    )

    const harness = screen.getByTestId('component-compare')
    expect(harness).toBeTruthy()
    const columns = harness.querySelectorAll('[data-comparison-column]')
    expect(columns).toHaveLength(2)
    expect(
      Array.from(columns).map((column) =>
        column.getAttribute('data-comparison-column'),
      ),
    ).toEqual(['ours', 'theirs'])
    // One pair, one fixture id, one state, on both columns.
    const ids = new Set(
      Array.from(columns).map(
        (column) => column.getAttribute('data-pair-id') ?? '',
      ),
    )
    expect(ids.size).toBe(1)
    expect(screen.getByTestId('comparison-checklist')).toBeTruthy()
  })

  it('offers ours, theirs and both', () => {
    render(
      <ThemeProvider>
        <ComponentCompareRoute />
      </ThemeProvider>,
    )
    for (const view of ['ours', 'theirs', 'both']) {
      expect(screen.getByTestId(`comparison-view-${view}`)).toBeTruthy()
    }
  })
})
