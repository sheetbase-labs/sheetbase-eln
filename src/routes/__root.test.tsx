import { render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import type { AnyRoute } from '@tanstack/react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Route as RootRoute } from './__root'

// oxlint-disable-next-line anti-slop/no-module-mocking -- The workspace host opens the workspace's own queries; this suite is about the root route forwarding its match, so the shell around it is replaced by its children.
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
// oxlint-disable-next-line anti-slop/no-module-mocking -- The coordinator opens an EventSource, which jsdom has no transport for; the root route only needs a provider that reports offline.
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

// Mock @tanstack/react-start so createServerFn doesn't require the
// server runtime (AsyncLocalStorage) during unit tests.
// oxlint-disable-next-line anti-slop/no-module-mocking -- `createServerFn` needs the server runtime (AsyncLocalStorage), which a unit test has no process for; the route only needs the handler it defines back unchanged.
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    handler: <T,>(fn: () => T) => fn,
  }),
}))

// Mock the server-only auth context so beforeLoad doesn't hit env vars
// or database connections during the unit test.
// oxlint-disable-next-line anti-slop/no-module-mocking -- The signed-in context is read from the request on the server; this suite drives the root route's outlet with no session.
vi.mock('#/lib/current-user', () => ({
  getCurrentContext: () => null,
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- Request headers come from the framework's server context, which a jsdom render has none of.
vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers(),
}))

afterEach(() => {
  vi.restoreAllMocks()
})

// SAFETY: `./__root` is the root file route of the generated tree; this suite
// builds its own one-route tree by hand, so it stands in where TanStack's
// generated root type is expected.
const rootRoute = RootRoute as AnyRoute

function buildRouter() {
  const child = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <p data-testid="child-marker">child-content</p>,
  })

  const router = createRouter({
    routeTree: rootRoute.addChildren([child]),
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
