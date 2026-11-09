import {
  createMemoryHistory,
  createRouter as createTanStackRouter,
} from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import type { RouterContext } from './routes/__root'

import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'
import { createRouterContext } from './integrations/tanstack-query/router-context'
import { NotFound } from '#/components/shell/not-found'
import { noCapabilities } from './lib/capabilities'
import { ROOT_CONTEXT_QUERY_KEY } from './lib/root-context-cache'

export function getRouter() {
  const context = {
    ...createRouterContext(),
    auth: null,
    capabilities: noCapabilities,
    shellCounts: {},
    shellPinned: [],
    shellHiddenPages: [],
    shellNotifications: [],
    themePref: 'system' as const,
    labLogo: null,
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

  // The root context is cached between navigations (src/lib/root-context-cache).
  // Every caller of router.invalidate() wants a fresh shell, so drop the cached
  // context first and the root's beforeLoad reads it again.
  const invalidate = router.invalidate.bind(router)
  router.invalidate = (...args: Parameters<typeof router.invalidate>) => {
    context.queryClient.removeQueries({ queryKey: ROOT_CONTEXT_QUERY_KEY })

    return invalidate(...args)
  }

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
  router._scroll.n = false

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
