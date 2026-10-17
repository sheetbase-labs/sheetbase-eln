import { useEffect, useMemo, useRef } from 'react'
import { QueryClient } from '@tanstack/react-query'
import { createRootRoute, createRoute } from '@tanstack/react-router'
import type { AnyRoute } from '@tanstack/react-router'

import { DataClientError } from '#/lib/data-client'
import type { DataClient } from '#/lib/data-client'
import { notebookDataClient } from '#/lib/notebook-data'

/**
 * The harness the v3 screen stories share.
 *
 * Every story in this lane is a still frame of a real screen with no database
 * and no network behind it. That takes four things, and each of them is here
 * once rather than re-invented per file:
 *
 * - **A sandbox router that knows every destination the screen links to.**
 *   `screenRoutes` builds it. The framework injects the story into the tree's
 *   first route, so the screen's own path goes first.
 * - **A query client whose reads are static.** `screenQueryClient` seeds the
 *   reads a screen performs — a seeded key is fresh forever, so nothing is
 *   fetched — and `holdRead` puts a read in the cache in the state a story
 *   claims (loading, refused, failed) before the screen mounts.
 * - **A data client a module takes as a prop.** `stubDataClient` answers its
 *   reads by name and refuses everything else.
 * - **The shared client, for the two screens that read through it
 *   imperatively.** `StubDataClient` replaces its two methods for the story's
 *   lifetime, because no query-cache seed can drive an imperative read and
 *   `createDataClient` captured `fetch` before any story could stub it.
 *
 * `withApiReads` is the last resort, at the fetch boundary, for a screen that
 * resolves a request while it runs rather than through the cache.
 */

// --- Router -----------------------------------------------------------------

/**
 * One entry in the sandbox route tree: a path, or a section path with the
 * routes nested under it, relative to their section as the app's own file tree
 * has them.
 */
export type ScreenPath = string | readonly [string, ...string[]]

/**
 * The sandbox route tree for one story: the screen's own path, then the paths
 * it links to.
 *
 * The first argument is where the story renders. It must come first: the
 * framework injects the story into the tree's first route and resolves the
 * story URL against it, so a tree that starts with a different destination
 * renders nothing at all, silently.
 *
 * Nest a record route under its section rather than listing the pair flat: a
 * flat `/projects` beside `/projects/$projectId` leaves the parameterised route
 * unresolved, so a `Link` to it renders the path with its placeholder still in
 * it and a story rendering *at* that path renders nothing.
 *
 * ```ts
 * screenRoutes(['/projects', '$projectId'], ['/records/$recordId'])
 * ```
 */
export function screenRoutes(
  mount: ScreenPath,
  links: readonly ScreenPath[] = [],
) {
  const root = createRootRoute()
  const leaf = (parent: AnyRoute, path: string) =>
    createRoute({
      path,
      getParentRoute: () => parent,
      component: () => null,
    })
  return root.addChildren(
    [mount, ...links].map((entry) => {
      if (typeof entry === 'string') return leaf(root, entry)
      const [section, ...children] = entry
      const parent = leaf(root, section)
      return parent.addChildren(children.map((child) => leaf(parent, child)))
    }),
  )
}

// --- Query cache ------------------------------------------------------------

/** The reads a story seeds, by query key. */
export type ReadSeed = { key: readonly unknown[]; value: unknown }

/**
 * One read a story answers with a failure instead of a seed: the key, which
 * failure, and the message it carries.
 */
export interface FailedRead {
  key: readonly unknown[]
  kind: 'denied' | 'error'
  message?: string
}

/** What an unseeded read does: never settle, refuse, or fail. */
export type UnseededRead = 'pending' | 'denied' | 'error'

/** One read function per mode, so a cache-seeded read and a held read agree. */
function readBehaviour(
  read: UnseededRead,
  failureMessage: string,
): () => Promise<never> {
  return () => {
    if (read === 'pending') return new Promise(() => {})
    if (read === 'denied') {
      return Promise.reject(
        new DataClientError('permission_denied', 'Permission denied', 403),
      )
    }
    return Promise.reject(new Error(failureMessage))
  }
}

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
        // A story is a still frame: nothing re-runs a read once the story has
        // rendered it. Without these, the `staleTime` a domain hook sets itself
        // (15–60s) would let a mount, focus or reconnect turn a fixture into a
        // request. `retryOnMount` is also what holds a deliberately refused read
        // against the mount fetch — see `holdRead`.
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        retryOnMount: false,
        queryFn: readBehaviour(read, failureMessage),
      },
    },
  })
  for (const seed of data) client.setQueryData(seed.key, seed.value)
  return client
}

/**
 * Put a read in the cache before the screen mounts, in the state the story
 * names.
 *
 * `screenQueryClient`'s own `read` mode only covers a hook that borrows the
 * query client's default `queryFn`. A domain read is written `useQuery({queryKey,
 * queryFn})`, so leaving its key empty runs *that* function and leaves the page —
 * a static server answers it with a 404, which renders the failure state where
 * the story asked for the loading one. Pre-fetching the key instead puts the read
 * in flight from inside the query cache: React Query keeps the first fetch for a
 * key, so the screen's own hook subscribes to that read and never runs its own
 * `queryFn`. `denied` and `error` resolve it to a refusal, which the observer
 * then holds because the client above neither retries nor refetches on mount.
 */
export function holdRead(
  client: QueryClient,
  key: readonly unknown[],
  read: UnseededRead = 'pending',
  failureMessage = 'The workspace connection failed.',
): void {
  // A key that is already seeded is fresh for `staleTime: Infinity`, so the
  // prefetch below would resolve to that data and the held state would never
  // render. Holding a read means not seeding it.
  if (client.getQueryData(key) !== undefined) {
    throw new Error(
      `holdRead: the read ${JSON.stringify(key)} is already seeded with data.`,
    )
  }
  void client.prefetchQuery({
    queryKey: key,
    queryFn: readBehaviour(read, failureMessage),
  })
}

/**
 * One page of an infinite read, as React Query holds it: the screens that use
 * `useInfiniteQuery` (the history timelines) read `data.pages`.
 */
export function infinitePage<T>(page: T, pageParams: unknown[] = [undefined]) {
  return { pages: [page], pageParams }
}

// --- Data clients -----------------------------------------------------------

/** A read a `stubDataClient` answers with: fixtures, or one of the modes. */
export type ClientRead =
  UnseededRead | readonly unknown[] | Record<string, unknown>

/**
 * A data client for a module that takes one (`client?: DataClient` in the
 * module's props). Each PostgREST resource or RPC is answered by name from the
 * story's fixtures, or left in one of the modes by name, so a screen that reads
 * through its client renders the same states as one that reads through the
 * query cache. A name the story does not answer, and every write, refuses: a
 * read with no fixture shows the module's own error state rather than an empty
 * list, and a reader who clicks a button gets that error path with no request
 * leaving the page.
 */
export function stubDataClient(
  reads: Record<string, ClientRead> = {},
): DataClient {
  const answer = (name: string): Promise<unknown> => {
    // An index signature hides the absent key: the story's fixtures are the
    // only reads it answers, and an unlisted one refuses rather than answering
    // an empty list the screen would render as "nothing here".
    if (!Object.hasOwn(reads, name)) {
      return Promise.reject(
        new Error(`This story answers no read named ${name}.`),
      )
    }
    const read = reads[name]
    if (read === 'pending' || read === 'denied' || read === 'error') {
      return readBehaviour(read, 'The workspace connection failed.')()
    }
    return Promise.resolve(read)
  }
  const refuse = () =>
    Promise.reject(new Error('A story never reaches the server.'))
  return {
    list: <T,>(resource: string) => answer(resource) as Promise<T[]>,
    count: refuse,
    rpc: <T,>(name: string) => answer(name) as Promise<T>,
    insert: refuse,
    patch: refuse,
    remove: refuse,
  }
}

/** The two client methods a story can replace for an imperative read. */
export type DataClientStub = {
  rpc?: (name: string, args: Record<string, unknown>) => Promise<unknown>
  list?: (resource: string, query?: string) => Promise<unknown[]>
}

/**
 * Some screens call the shared `notebookDataClient` imperatively rather than
 * through React Query — the palette's search and the schedule dialog's
 * workspace time zone. A query cache cannot seed those, a module-scope client
 * has already captured `fetch`, and Storybook has no module-boundary mock, so
 * those stories replace the two methods for their lifetime. The patch is
 * applied during render because a child's mount effect runs before the parent's,
 * so an effect-installed patch would arrive after the screen's first read. No
 * request leaves the page: the stub answers instead.
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

// --- Fetch ----------------------------------------------------------------

const deniedResponse = () =>
  new Response(
    JSON.stringify({
      error: { category: 'permission_denied', message: 'Permission denied' },
    }),
    { status: 403, headers: { 'content-type': 'application/json' } },
  )

const failedResponse = (message: string) =>
  new Response(
    JSON.stringify({ error: { category: 'upstream_error', message } }),
    { status: 500, headers: { 'content-type': 'application/json' } },
  )

function requestPath(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.pathname
  return input.url
}

/** Replaces `window.fetch`; returns the restore. */
function installApiReads(read: UnseededRead, message: string): () => void {
  const original = window.fetch
  window.fetch = (input, init) => {
    if (!requestPath(input).startsWith('/api/')) {
      return original.call(window, input, init)
    }
    if (read === 'pending') return new Promise<Response>(() => {})
    if (read === 'denied') return Promise.resolve(deniedResponse())
    return Promise.resolve(failedResponse(message))
  }
  return () => {
    window.fetch = original
  }
}

/**
 * Answers every `/api/…` request a story's screen makes *when the request is
 * made* — the last resort for a screen that resolves a request while it runs
 * (a component that builds its client in an effect, a raw `/api/…` call, a
 * server function) rather than through the query cache. A story that seeds or
 * holds its reads makes no request at all; this is what stops the ones it does
 * not know about from leaving the page.
 */
export const withApiReads =
  (read: UnseededRead, message = 'The workspace connection failed.') =>
  (Story: () => React.ReactNode) => (
    <ApiReads read={read} message={message}>
      <Story />
    </ApiReads>
  )

function ApiReads({
  read,
  message,
  children,
}: {
  read: UnseededRead
  message: string
  children: React.ReactNode
}) {
  // Installed while rendering, not in an effect: a screen starts its first
  // fetch in its own mount effect, which runs before this wrapper's.
  const restore = useMemo(() => installApiReads(read, message), [read, message])
  useEffect(() => restore, [restore])
  return <>{children}</>
}
