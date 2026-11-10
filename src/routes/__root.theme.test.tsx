import { renderToString } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createMemoryHistory,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { noCapabilities } from '#/lib/capabilities'
import { Route as RootRoute } from './__root'

// oxlint-disable-next-line anti-slop/no-module-mocking -- The root document mounts the workspace shell, which owns a live-events connection and the signed-in person; this suite renders the theme class alone, so the shell draws only its children.
vi.mock('#/components/workspace/workspace-host', () => ({
  WorkspaceHost: ({ children }: { children: React.ReactNode }) => children,
}))

/**
 * R5-SHELL-02: the server renders the person's theme on the first paint. The
 * preference lives in the `sb-theme` cookie, which the request carries, so the
 * root document must emit the `dark` class exactly when the cookie says so and
 * leave the class off for `system` and for an absent cookie (the inline script
 * resolves the device setting in the browser).
 */

const request = vi.hoisted(() => ({ cookie: '' }))

// oxlint-disable-next-line anti-slop/no-module-mocking -- The shell opens its live-events coordinator at module scope; a real one holds an EventSource, which a server render has no browser for.
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

// oxlint-disable-next-line anti-slop/no-module-mocking -- `getOrCreateClientId` reads localStorage, which server rendering does not have.
vi.mock('#/lib/client-identity', () => ({
  getOrCreateClientId: () => 'test-client-id',
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- The root module builds its server function from `createServerFn` at import time; the framework's factory needs the server runtime to exist before the module loads, and this suite renders the route directly.
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    handler: <Answer,>(fn: () => Answer) => fn,
  }),
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- `getCurrentContext` resolves a session from the database; this suite needs the signed-out context the theme render falls back to, with no database.
vi.mock('#/lib/current-user', () => ({
  getCurrentContext: () => null,
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- `getRequestHeaders` reads the framework's ambient server request; the suite supplies the one cookie header the document's theme decision reads.
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
      shellHiddenPages: [],
      shellNotifications: [],
      themePref: 'system' as const,
      labLogo: null,
      capabilities: noCapabilities,
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
