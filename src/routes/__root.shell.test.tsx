/**
 * R5-SHELL-01 — which shell a route gets.
 *
 * The adopted (v3) shell is the default for every route; only the recorded
 * internal reference routes keep the legacy ELN shell, and the two routes with
 * their own chrome render bare. The choice used to be an allow-list of ported
 * route ids matched against any ancestor, so a product route whose ancestor was
 * not listed — or any new top-level route — silently fell back to the legacy
 * shell, which has no icon rail at 1024–1279 and no bottom tabs below 768.
 *
 * Each case drives a real router through the real root route component with a
 * stub route chain whose ids match the generated tree, so the test fails if the
 * selection changes.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import type { AnyRoute } from '@tanstack/react-router'
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { noCapabilities } from '#/lib/capabilities'
import { Route as RootRoute } from './__root'

// oxlint-disable-next-line anti-slop/no-module-mocking -- The devtools panels mount a client they cannot in jsdom and unmount by throwing when they have not; this suite is about which shell wraps a route, so they render nothing.
vi.mock('@tanstack/react-devtools', () => ({ TanStackDevtools: () => null }))

// oxlint-disable-next-line anti-slop/no-module-mocking -- The router devtools panel mounts the same client as above and is never part of what this suite asserts.
vi.mock('@tanstack/react-router-devtools', () => ({
  TanStackRouterDevtoolsPanel: () => null,
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- The query devtools panel mounts the same client as above and is never part of what this suite asserts.
vi.mock('../integrations/tanstack-query/devtools', () => ({
  default: () => null,
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- The workspace host opens the workspace's own queries; this suite is about which shell wraps a route, so the shell's content is replaced by its children.
vi.mock('#/components/workspace/workspace-host', () => ({
  WorkspaceHost: ({ children }: { children: React.ReactNode }) => children,
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- The coordinator opens an EventSource, which jsdom has no transport for; the shell only needs a provider that reports offline.
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

// Mock @tanstack/react-start so createServerFn doesn't require the server
// runtime (AsyncLocalStorage) during unit tests.
// oxlint-disable-next-line anti-slop/no-module-mocking -- `createServerFn` needs the server runtime (AsyncLocalStorage), which a unit test has no process for; the route only needs the handler it defines back unchanged.
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    handler: <T,>(fn: () => T) => fn,
  }),
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- The signed-in context is read from the request on the server; this suite drives which shell wraps a route with no session.
vi.mock('#/lib/current-user', () => ({ getCurrentContext: () => null }))

// oxlint-disable-next-line anti-slop/no-module-mocking -- Request headers come from the framework's server context, which a jsdom render has none of.
vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers(),
}))

// The two shells are distinguishable by their wrapper, so the assertion does
// not depend on either shell's chrome.
// oxlint-disable-next-line anti-slop/no-module-mocking -- The two shells are told apart by their wrapper so the assertion does not depend on either shell's chrome; the adopted shell's content is replaced here.
vi.mock('#/components/shell/app-shell', () => ({
  AppShell: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="v3-shell">{children}</div>
  ),
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- The legacy shell is the other side of the same comparison, replaced by a wrapper with its own marker.
vi.mock('../components/shell', () => ({
  ShellProvider: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="legacy-shell">{children}</div>
  ),
}))

afterEach(cleanup)

function Leaf() {
  return <p data-testid="leaf">leaf</p>
}

/** Build a router whose matched route ids follow `idTemplate`. */
function buildRouter(idTemplate: string) {
  const segments = idTemplate.split('/').filter(Boolean)
  const chain: AnyRoute[] = []
  let parent: AnyRoute = RootRoute
  segments.forEach((segment, index) => {
    // Capture this segment's parent: `getParentRoute` is called later, after
    // `parent` has moved on to the next segment.
    const routeParent = parent

    const route = createRoute({
      getParentRoute: () => routeParent,
      path: `/${segment}`,
      component: index === segments.length - 1 ? Leaf : () => <Outlet />,
    })

    chain.push(route)
    parent = route
  })

  let tree = chain[chain.length - 1]

  for (let index = chain.length - 2; index >= 0; index -= 1) {
    tree = chain[index].addChildren([tree])
  }

  return createRouter({
    routeTree: RootRoute.addChildren([tree]),
    context: {
      queryClient: new QueryClient(),
      auth: null,
      shellCounts: {},
      shellPinned: [],
      shellHiddenPages: [],
      shellNotifications: [],
      themePref: 'system' as const,
      labLogo: null,
      capabilities: noCapabilities,
    },
    history: createMemoryHistory({
      initialEntries: [idTemplate.replace(/\$[^/]+/g, 'x')],
    }),
  })
}

async function renderRoute(idTemplate: string) {
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={buildRouter(idTemplate)} />
    </QueryClientProvider>,
  )

  await waitFor(() => expect(view.queryByTestId('leaf')).toBeTruthy())

  return view
}

describe('R5-SHELL-01 — the adopted shell is the default', () => {
  it('wraps the project files tab in the v3 shell', async () => {
    const view = await renderRoute('/projects/$projectId/files')
    expect(view.queryByTestId('v3-shell')).toBeTruthy()
    expect(view.queryByTestId('legacy-shell')).toBeNull()
  })

  it('wraps the signed-revision evidence view in the v3 shell', async () => {
    const view = await renderRoute('/records/$recordId/evidence/$revisionId')
    expect(view.queryByTestId('v3-shell')).toBeTruthy()
    expect(view.queryByTestId('legacy-shell')).toBeNull()
  })

  it('wraps a route that appears in no list at all in the v3 shell', async () => {
    const view = await renderRoute('/reports/$reportId')
    expect(view.queryByTestId('v3-shell')).toBeTruthy()
    expect(view.queryByTestId('legacy-shell')).toBeNull()
  })

  it('keeps the route content inside the shell wrapper', async () => {
    const view = await renderRoute('/projects/$projectId/files')
    const shell = view.getByTestId('v3-shell')
    expect(shell.contains(view.getByTestId('leaf'))).toBe(true)
  })
})

describe('R5-SHELL-01 — recorded internal reference routes keep the legacy shell', () => {
  it.each([
    '/docs/$name',
    '/foundations',
    '/r/$identifier',
    '/sheetbase-components',
  ])('%s', async (idTemplate) => {
    const view = await renderRoute(idTemplate)
    expect(view.queryByTestId('legacy-shell')).toBeTruthy()
    expect(view.queryByTestId('v3-shell')).toBeNull()
  })
})

describe('R5-SHELL-01 — routes with their own chrome render bare', () => {
  it.each([
    '/client-portal',
    '/sign-in',
    '/sign-in_/two-factor',
    '/accept-invitation',
  ])('%s', async (idTemplate) => {
    const view = await renderRoute(idTemplate)
    expect(view.queryByTestId('v3-shell')).toBeNull()
    expect(view.queryByTestId('legacy-shell')).toBeNull()
    expect(view.queryByTestId('leaf')).toBeTruthy()
  })
})
