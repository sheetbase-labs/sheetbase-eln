import { QueryClient } from '@tanstack/react-query'

import { DataClientError } from '#/lib/data-client'

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

  return {
    queryClient,
  }
}
