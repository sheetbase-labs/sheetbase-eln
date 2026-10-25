/**
 * Server-side DataClient over PostgREST with an already-minted JWT.
 *
 * The browser uses `createDataClient()` against the same-origin `/api/db`
 * proxy. A server function already has the actor's verified identity, so it
 * mints the short-lived JWT itself and talks to PostgREST directly. Reusing
 * `createDataClient` keeps one method/error contract; only the URL and auth
 * header differ. Every read and write still goes through PostgreSQL RLS.
 */
import { env } from '#/env.server'
import { createDataClient } from './data-client'
import type { DataClient } from './data-client'

export function createServerDataClient(
  token: string,
  fetchImpl: typeof fetch = fetch,
): DataClient {
  const authorisedFetch: typeof fetch = (input, init) => {
    const url =
      typeof input === 'string'
        ? input.replace(/^\/api\/db/, env.POSTGREST_URL)
        : input
    const headers = new Headers(init?.headers)
    headers.set('authorization', `Bearer ${token}`)
    return fetchImpl(url, { ...init, headers })
  }
  return createDataClient(authorisedFetch)
}
