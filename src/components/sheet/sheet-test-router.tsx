import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { act, render } from '@testing-library/react'

/** A real router and isolated Query cache for sheet interaction tests. */
export async function renderSheetRoute(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  const routeTree = createRootRoute({ component: () => ui })

  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  await router.load()
  let rendered: ReturnType<typeof render> | undefined
  await act(async () => {
    rendered = render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )
  })

  if (!rendered) throw new Error('Router did not render')

  return { ...rendered, router, queryClient }
}
