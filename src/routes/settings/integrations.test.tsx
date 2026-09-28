/**
 * INT-01 integrations route tests: the connector registry lists registered
 * connectors and shows the steward-only registration affordance.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Route } from './integrations'

const IntegrationsRoute = Route.options.component as React.ComponentType

function renderRoute() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <IntegrationsRoute />
    </QueryClientProvider>,
  )
}

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    useRouteContext: () => ({
      context: {
        workspace: { id: 'workspace-1', name: 'Test workspace', role: 'owner' },
        user: { name: 'Test User', email: 'test@example.com' },
      },
    }),
    useParams: () => ({}),
    options: config,
  }),
  redirect: (options: unknown) => options,
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: '/settings/integrations' } }),
  Outlet: () => null,
  Link: ({
    to,
    children,
    ...props
  }: {
    to: string
    children: React.ReactNode
  } & Record<string, unknown>) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual('@tanstack/react-query')
  return {
    ...actual,
    useQuery: () => ({
      data: [
        {
          id: 'c1',
          workspace_id: 'workspace-1',
          key: 'plate-reader-bench',
          name: 'Plate reader bench',
          connector_type: 'instrument',
          direction: 'inbound',
          status: 'active',
          parser_id: 'sheetbase.plate-reader-csv',
          config: {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    }),
  }
})

afterEach(cleanup)

describe('INT-01 integrations route', () => {
  it('lists registered connectors with identity and status', () => {
    renderRoute()
    expect(screen.getByText('Plate reader bench')).toBeTruthy()
    expect(screen.getByText('plate-reader-bench')).toBeTruthy()
    expect(screen.getByText('instrument')).toBeTruthy()
    expect(screen.getByText('inbound')).toBeTruthy()
  })

  it('offers connector registration to governed roles', () => {
    renderRoute()
    const buttons = screen.getAllByRole('button', {
      name: /Register connector/i,
    })
    expect(buttons.length).toBeGreaterThan(0)
  })
})
