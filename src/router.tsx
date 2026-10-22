import {
  createMemoryHistory,
  createRouter as createTanStackRouter,
} from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import type { RouterContext } from './routes/__root'

import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'
import { createRouterContext } from './integrations/tanstack-query/router-context'
import { NotFound } from '#/components/v3/shell/not-found'
import { noCapabilities } from './lib/capabilities'

export function getRouter() {
  const context = {
    ...createRouterContext(),
    auth: null,
    capabilities: noCapabilities,
    shellCounts: {},
    shellPinned: [],
    shellNotifications: [],
    themePref: 'system' as const,
  }

  const router = createTanStackRouter({
    routeTree,
    context,
    scrollRestoration: true,
    // R5-SURF-03: a notFound() thrown by a loader inside a matched layout (e.g.
    // a record id that isn't in the workspace) renders the product's screen in
    // that layout's outlet; the catch-all `/$` route covers unmatched URLs.
    defaultNotFoundComponent: NotFound,
    defaultPreload: 'intent',
    // Reuse hover-preloaded data for the actual navigation. The
    // previous value of 0 marked every preload as instantly stale, so
    // navigating to a preloaded route refetched immediately — doubling
    // the requests and making navigation feel sluggish.
    defaultPreloadStaleTime: 30_000,
  })

  setupRouterSsrQueryIntegration({ router, queryClient: context.queryClient })

  return router
}

/** Client-only page router. Providers and query ownership stay with the app. */
export function getPaneRouter(context: RouterContext, href: string) {
  const history = createMemoryHistory({ initialEntries: [href] })
  history.replace(href, { __hashScrollIntoViewOptions: false })
  const router = createTanStackRouter({
    routeTree,
    history,
    context: { ...context, workspacePane: true },
    isServer: false,
    scrollRestoration: false,
    defaultHashScrollIntoView: false,
    defaultNotFoundComponent: NotFound,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 30_000,
  })
  // TanStack still scrolls the document on the first render when restoration
  // is false. Panes must not move another pane's document or hash target.
  router._scroll.next = false
  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
