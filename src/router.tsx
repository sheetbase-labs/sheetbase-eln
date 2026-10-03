import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'
import { createRouterContext } from './integrations/tanstack-query/router-context'

export function getRouter() {
  const context = {
    ...createRouterContext(),
    auth: null,
    shellCounts: {},
    shellPinned: [],
    shellNotifications: [],
  }

  const router = createTanStackRouter({
    routeTree,
    context,
    scrollRestoration: true,
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

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
