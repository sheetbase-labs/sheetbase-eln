import { QueryClient } from '@tanstack/react-query'
import { createRootRoute, createRoute } from '@tanstack/react-router'

import { DataClientError } from '#/lib/data-client'

/**
 * The harness the v3 screen stories share.
 *
 * Two things every screen-level story in this lane needs, written once here
 * rather than re-invented per file:
 *
 * - **A sandbox router that knows every destination the screen links to.** The
 *   Storybook TanStack framework builds its router from the story's own `route`
 *   parameter, so a `path` alone moves the story URL and leaves every `Link` in
 *   the screen unresolvable ("Route not found"). `screenRoutes` builds the
 *   sibling route tree those links need: one route per path the screen can link
 *   to, plus the path the story itself renders on (a story supplies that one as
 *   `path`/`params`).
 * - **A query client whose reads are static.** No story in this repository
 *   reaches the network or the database. `screenQueryClient` seeds the reads a
 *   screen performs, and leaves the ones it does not seed pending, refused or
 *   failed, which renders the screen's own loading, denied and error states.
 */

/** The sandbox route tree for one story: the paths the screen links to. */
export function screenRoutes(paths: readonly string[]) {
  const root = createRootRoute()
  return root.addChildren(
    paths.map((path) =>
      createRoute({
        path,
        getParentRoute: () => root,
        component: () => null,
      }),
    ),
  )
}

/** The reads a story seeds, by query key. */
export type ReadSeed = { key: readonly unknown[]; value: unknown }

/** What an unseeded read does: never settle, refuse, or fail. */
export type UnseededRead = 'pending' | 'denied' | 'error'

export function screenQueryClient({
  data = [],
  read = 'pending',
  failureMessage = 'The workspace connection failed.',
}: {
  data?: ReadSeed[]
  read?: UnseededRead
  failureMessage?: string
} = {}): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Infinity,
        queryFn: () => {
          if (read === 'pending') return new Promise(() => {})
          if (read === 'denied') {
            return Promise.reject(
              new DataClientError(
                'permission_denied',
                'Permission denied',
                403,
              ),
            )
          }
          return Promise.reject(new Error(failureMessage))
        },
      },
    },
  })
  for (const seed of data) client.setQueryData(seed.key, seed.value)
  return client
}

/**
 * One page of an infinite read, as React Query holds it: the screens that use
 * `useInfiniteQuery` (the history timelines) read `data.pages`.
 */
export function infinitePage<T>(page: T, pageParams: unknown[] = [undefined]) {
  return { pages: [page], pageParams }
}
