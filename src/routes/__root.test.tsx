import { render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Route as RootRoute } from './__root'

vi.mock('#/components/workspace/workspace-host', () => ({
  WorkspaceHost: ({ children }: { children: React.ReactNode }) => children,
}))

/**
 * Regression guard for the blank-page bug: the root route's `component`
 * must render nested matches through `<Outlet />`. TanStack Router calls
 * route components with no props, so an earlier implementation that read
 * a `children` prop rendered nothing — the document shell and devtools
 * appeared, but `/sign-in` (and every other matched route) did not.
 *
 * We mock the live-event coordinator so no `EventSource` is opened in
 * jsdom, then drive a real router with a fake child route that renders a
 * known marker. If the root route ever stops forwarding to `<Outlet />`,
 * the marker disappears and this test fails.
 */
vi.mock('#/lib/live-events', () => ({
  createLiveEventCoordinator: () => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    subscribe: () => () => {},
    getStatus: () => ({
      status: 'offline',
      lastAppliedSeq: 0,
      workspaceId: null,
      lastResetReason: null,
    }),
  }),
}))

vi.mock('#/lib/client-identity', () => ({
  getOrCreateClientId: () => 'test-client-id',
}))

// Mock @tanstack/react-start so createServerFn doesn't require the
// server runtime (AsyncLocalStorage) during unit tests.
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    handler: (fn: () => unknown) => fn,
  }),
}))

// Mock the server-only auth context so beforeLoad doesn't hit env vars
// or database connections during the unit test.
vi.mock('#/lib/current-user', () => ({
  getCurrentContext: () => null,
}))

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers(),
}))

afterEach(() => {
  vi.restoreAllMocks()
})

function buildRouter() {
  const child = createRoute({
    getParentRoute: () => RootRoute as any,
    path: '/',
    component: () => <p data-testid="child-marker">child-content</p>,
  })

  const router = createRouter({
    routeTree: (RootRoute as any).addChildren([child]),
    context: { queryClient: new QueryClient(), auth: null, shellCounts: {} },
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  return router
}

describe('RootRouteComponent — nested routes render through the outlet', () => {
  it('surfaces the matched child route inside the live-event provider', async () => {
    const router = buildRouter()
    const queryClient = new QueryClient()

    const { getByTestId } = render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )

    await waitFor(() => expect(getByTestId('child-marker')).toBeTruthy())
    expect(getByTestId('child-marker').textContent).toBe('child-content')
  })
})
