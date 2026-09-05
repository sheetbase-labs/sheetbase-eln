/**
 * KNOW-02 — `/lineage?seed=` explorer seeding tests.
 *
 * The search validator only admits stable ids, and the explorer initialises
 * from the seed: the graph query key carries it and the seeded banner offers
 * the way back to the full graph.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

import { Route } from './lineage'

const LineageRoute = Route.options.component as React.ComponentType

const searchState: { seed?: string } = {}

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    useRouteContext: () => ({
      context: {
        workspace: { id: 'workspace-1', name: 'Test workspace', role: 'owner' },
        user: { name: 'Test User', email: 'test@example.com' },
      },
    }),
    useSearch: () => searchState,
    options: config,
  }),
  redirect: (options: unknown) => options,
  Link: ({
    to,
    children,
    ...props
  }: {
    to: string
    children: ReactNode
  } & Record<string, unknown>) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}))

const seenQueryKeys: unknown[] = []

vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: { queryKey: unknown }) => {
    seenQueryKeys.push(options.queryKey)
    return { data: null, isLoading: true, error: null }
  },
}))

vi.mock('#/components/app-shell', () => ({
  ShellProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useShell: () => {},
}))

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

afterEach(() => {
  cleanup()
  seenQueryKeys.length = 0
  delete searchState.seed
})

describe('lineage validateSearch', () => {
  const validateSearch = Route.options.validateSearch as (
    search: Record<string, unknown>,
  ) => { seed?: string }

  it('passes a stable seed id through', () => {
    expect(validateSearch({ seed: 'rec-1' })).toEqual({ seed: 'rec-1' })
  })

  it('drops absent, empty and crafted seeds', () => {
    expect(validateSearch({})).toEqual({ seed: undefined })
    expect(validateSearch({ seed: '' })).toEqual({ seed: undefined })
    expect(validateSearch({ seed: '/records/evil' })).toEqual({
      seed: undefined,
    })
  })
})

describe('LineageExplorerRoute seeding', () => {
  it('initialises the graph query from the seed param', () => {
    searchState.seed = 'rec-1'
    render(<LineageRoute />)

    expect(
      seenQueryKeys.some((key) => JSON.stringify(key).includes('rec-1')),
    ).toBe(true)
  })

  it('shows the seeded banner with a way back to the full graph', () => {
    searchState.seed = 'rec-1'
    render(<LineageRoute />)

    expect(screen.getByText(/Seeded lineage for/)).toBeTruthy()
    expect(screen.getByText('rec-1')).toBeTruthy()
    expect(screen.getByText('Clear seed — view full graph')).toBeTruthy()
  })

  it('shows no banner for the unseeded full graph', () => {
    render(<LineageRoute />)

    expect(screen.queryByText(/Seeded lineage for/)).toBeNull()
    expect(
      seenQueryKeys.some((key) => JSON.stringify(key).includes('all')),
    ).toBe(true)
  })
})
