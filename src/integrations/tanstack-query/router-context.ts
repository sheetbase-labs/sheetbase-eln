import { QueryClient } from '@tanstack/react-query'

import { DataClientError, onRowsChanged } from '#/lib/data-client'

/**
 * A request the server refused (not found, not allowed, bad input) answers the
 * same way every time, so retrying it only repeats the wait and the request.
 * Timeouts, rate limits and server or network failures still retry.
 */
export function shouldRetryQuery(
  failureCount: number,
  error: unknown,
): boolean {
  if (
    error instanceof DataClientError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 408 &&
    error.status !== 429
  ) {
    return false
  }
  return failureCount < 3
}

/**
 * Caches that hold what a person is typing into or editing cell by cell. A
 * write made from them must not refetch them under the person's hands.
 */
const EDITING_CACHES = new Set([
  'notebook',
  'scientific-table',
  'scientific-tables',
  'scientific-rows',
  'scientific-all-rows',
  'scientific-formulas',
  'scientific-dependencies',
  'scientific-calculation-results',
  'formula',
  'calculation',
  'comments',
])

/**
 * After this tab saves something, every other cached list, count, header and
 * sidebar row that could show it is marked stale (and refetched when on
 * screen). Without this each mutation has to remember every other place that
 * shows its data, and the ones it forgets keep the old value until a reload.
 * Writes that arrive in a burst are folded into one refresh.
 */
export function refreshAfterWrites(
  queryClient: QueryClient,
  delayMs = 250,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const stop = onRowsChanged(() => {
    if (timer !== null) return
    timer = setTimeout(() => {
      timer = null
      void queryClient.invalidateQueries({
        predicate: (query) => !EDITING_CACHES.has(String(query.queryKey[0])),
      })
    }, delayMs)
  })
  return () => {
    stop()
    if (timer !== null) clearTimeout(timer)
    timer = null
  }
}

export function createRouterContext() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Live reconciliation is handled by the LIVE-003 SSE coordinator
        // (src/lib/live-events.ts), which invalidates the narrowest
        // affected query keys when a durable change event arrives.
        // Window-focus refetching would duplicate that work with a burst
        // of requests every time the user alt-tabs back, which makes the
        // app feel sluggish. Disable it; the stream keeps caches fresh.
        retry: shouldRetryQuery,
        refetchOnWindowFocus: false,
        // A short stale window lets cached data render immediately on
        // remount/navigation without forcing a background refetch on
        // every single mount (the default staleTime of 0 refetches on
        // every mount, which churns the network and the UI).
        staleTime: 30_000,
      },
    },
  })

  if (typeof window !== 'undefined') refreshAfterWrites(queryClient)

  return {
    queryClient,
  }
}
