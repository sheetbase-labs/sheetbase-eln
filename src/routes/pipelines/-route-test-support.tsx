import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import type { RouteComponent } from '@tanstack/react-router'
import { QueryClient } from '@tanstack/react-query'

/** Real route and query providers shared by the pipeline route suites. */
export function routeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  })
}

export async function pipelineTestRouter(
  component: RouteComponent | undefined,
  path: string,
  entry: string,
) {
  if (!component) throw new Error('Route component required')

  const root = createRootRoute({
    beforeLoad: () => ({
      context: {
        user: { id: 'u-1', name: 'Ada Lovelace' },
        workspace: { id: 'ws-1', role: 'owner' },
      },
    }),
  })

  const route = createRoute({ getParentRoute: () => root, path, component })

  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: [entry] }),
  })

  await router.load()

  return router
}
