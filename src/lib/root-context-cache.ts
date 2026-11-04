/**
 * The root route's context (who is signed in, their workspace, the sidebar
 * counts) comes from one server function. It used to run before every client
 * navigation, including hover preloads, and the navigation waited for it. In
 * the browser it is now reused for a short while; the server render always
 * reads it fresh.
 *
 * `router.invalidate()` is how the app asks for a fresh shell after a change
 * (switching workspace, finishing setup, a role or profile change), so the
 * router drops this entry before every invalidation (see `src/router.tsx`).
 */
export const ROOT_CONTEXT_QUERY_KEY = ['root-context'] as const

/** Short enough that sidebar counts stay current without a server event. */
export const ROOT_CONTEXT_STALE_MS = 10_000
