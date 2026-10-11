import { renderToString } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createMemoryHistory,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Route as RootRoute } from './__root'

/**
 * R5-SHELL-02: the server renders the person's theme on the first paint. The
 * preference lives in the `sb-theme` cookie, which the request carries, so the
 * root document must emit the `dark` class exactly when the cookie says so and
 * leave the class off for `system` and for an absent cookie (the inline script
 * resolves the device setting in the browser).
 */

const request = vi.hoisted(() => ({ cookie: '' }))

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

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    handler: (fn: () => unknown) => fn,
  }),
}))

vi.mock('#/lib/current-user', () => ({
  getCurrentContext: () => null,
}))

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => {
    const headers = new Headers()
    if (request.cookie) headers.set('cookie', request.cookie)
    return headers
  },
}))

afterEach(() => {
  vi.restoreAllMocks()
})

beforeEach(() => {
  request.cookie = ''
})

async function renderRootHtml(): Promise<string> {
  const child = createRoute({
    getParentRoute: () => RootRoute,
    path: '/',
    component: () => null,
  })

  const router = createRouter({
    routeTree: RootRoute.addChildren([child]),
    context: {
      queryClient: new QueryClient(),
      auth: null,
      shellCounts: {},
      shellPinned: [],
      shellNotifications: [],
      themePref: 'system' as const,
    },
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  await router.load()

  return renderToString(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

describe('root document theme class', () => {
  it('emits the dark class when the cookie says dark', async () => {
    request.cookie = 'sb-theme=dark'
    const html = await renderRootHtml()
    expect(html).toMatch(/<html[^>]*class="dark"/)
    expect(html).toContain('data-theme-pref="dark"')
  })

  it('leaves the class off for the system preference', async () => {
    request.cookie = 'sb-theme=system'
    const html = await renderRootHtml()
    expect(html).toMatch(/<html(?![^>]*class="dark")/)
    expect(html).toContain('data-theme-pref="system"')
  })

  it('leaves the class off when the cookie is absent', async () => {
    request.cookie = ''
    const html = await renderRootHtml()
    expect(html).toMatch(/<html(?![^>]*class="dark")/)
    expect(html).toContain('data-theme-pref="system"')
  })
})
