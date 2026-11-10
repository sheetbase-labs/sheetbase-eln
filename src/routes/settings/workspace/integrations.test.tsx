/**
 * INT-01 integrations route tests: the connector registry lists registered
 * connectors and shows the steward-only registration affordance.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createRootRoute,
  createRoute,
  createRouter,
  createMemoryHistory,
  RouterProvider,
} from '@tanstack/react-router'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
  const url = new URL(
    input instanceof Request ? input.url : String(input),
    'http://localhost',
  )

  if (url.pathname.endsWith('/connectors'))
    return Response.json([
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
        created_at: '2026-10-01T09:00:00Z',
        updated_at: '2026-10-01T09:00:00Z',
      },
    ])

  if (url.pathname === '/api/office-editor/status')
    return Response.json({ enabled: false })

  return Response.json([])
})

const { Route } = await import('./integrations')
const { dropSharedReads } = await import('#/lib/data-client')

function renderRoute() {
  const Component = Route.options.component

  if (!Component) throw new Error('Integrations component required')

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  const root = createRootRoute({
    beforeLoad: () => ({
      context: {
        workspace: { id: 'workspace-1', name: 'Test workspace', role: 'owner' },
        user: { name: 'Test User', email: 'test@example.com' },
      },
    }),
  })

  const route = createRoute({
    getParentRoute: () => root,
    path: '/settings/workspace/integrations',
    component: Component,
  })

  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({
      initialEntries: ['/settings/workspace/integrations'],
    }),
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  dropSharedReads()
})

afterAll(() => vi.unstubAllGlobals())

describe('INT-01 integrations route', () => {
  it('lists registered connectors with identity and status', async () => {
    renderRoute()
    expect(await screen.findByText('Plate reader bench')).toBeTruthy()
    expect(screen.getByText(/^instrument$/i)).toBeTruthy()
    expect(screen.getByText(/^inbound$/i)).toBeTruthy()
  })

  it('offers connector registration to governed roles', async () => {
    renderRoute()

    const buttons = await screen.findAllByRole('button', {
      name: /Register connector/i,
    })

    expect(buttons.length).toBeGreaterThan(0)
  })
})
