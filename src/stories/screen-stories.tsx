import { useEffect, useRef } from 'react'
import { QueryClient } from '@tanstack/react-query'
import { createRootRoute, createRoute } from '@tanstack/react-router'

import { DataClientError } from '#/lib/data-client'
import { notebookDataClient } from '#/lib/notebook-data'

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

/** The sandbox route tree for one story: the screen's own path, then its links. */
export function screenRoutes(
  /**
   * The path the story renders on. It must come first: the framework injects
   * the story into the tree's first route, and the story URL is resolved
   * against it — a tree whose first route is a different destination renders
   * nothing at all, silently.
   */
  mount: string,
  /** Every other path the screen links to, so its `Link`s resolve. */
  links: readonly string[] = [],
) {
  const root = createRootRoute()
  return root.addChildren(
    [mount, ...links].map((path) =>
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

/** The two client methods a story can replace for an imperative read. */
export type DataClientStub = {
  rpc?: (name: string, args: Record<string, unknown>) => Promise<unknown>
  list?: (resource: string, query?: string) => Promise<unknown[]>
}

/**
 * Some screens call the shared `notebookDataClient` imperatively rather than
 * through React Query — the palette's search and the schedule dialog's
 * workspace time zone. A query cache cannot seed those, and Storybook has no
 * module-boundary mock, so those stories replace the two methods for their
 * lifetime. The patch is applied during render because a child's mount effect
 * runs before the parent's, so an effect-installed patch would arrive after the
 * screen's first read. No request leaves the page: the stub answers instead.
 */
export function StubDataClient({
  stub,
  children,
}: {
  stub: DataClientStub
  children: React.ReactNode
}) {
  const saved = useRef<DataClientStub | null>(null)
  const applied = useRef<DataClientStub | null>(null)

  const install = () => {
    const client = notebookDataClient as unknown as DataClientStub
    saved.current ??= {}
    if (stub.rpc) {
      saved.current.rpc ??= client.rpc
      client.rpc = stub.rpc
    }
    if (stub.list) {
      saved.current.list ??= client.list
      client.list = stub.list
    }
    applied.current = stub
  }

  if (applied.current !== stub) install()

  useEffect(() => {
    // Re-install after StrictMode's effect cleanup restored the originals.
    if (applied.current !== stub) install()
    return () => {
      const client = notebookDataClient as unknown as DataClientStub
      if (saved.current?.rpc) client.rpc = saved.current.rpc
      if (saved.current?.list) client.list = saved.current.list
      saved.current = null
      applied.current = null
    }
  }, [stub])

  return <>{children}</>
}

/**
 * One page of an infinite read, as React Query holds it: the screens that use
 * `useInfiniteQuery` (the history timelines) read `data.pages`.
 */
export function infinitePage<T>(page: T, pageParams: unknown[] = [undefined]) {
  return { pages: [page], pageParams }
}
