/**
 * Server-side DataClient over PostgREST with an already-minted JWT.
 *
 * The browser uses `createDataClient()` against the same-origin `/api/db`
 * proxy. A server function already has the actor's verified identity, so it
 * mints the short-lived JWT itself and talks to PostgREST directly. Reusing
 * `createDataClient` keeps one method/error contract; only the URL and auth
 * header differ. Every read and write still goes through PostgreSQL RLS.
 */
import { z } from 'zod'

import { env } from '#/env.server'
import { createDataClient } from './data-client'
import type { DataClient } from './data-client'

export function createServerDataClient(
  token: string,
  fetchImpl: typeof fetch = fetch,
): DataClient {
  const authorisedFetch: typeof fetch = async (input, init) => {
    const url =
      input instanceof URL || input instanceof Request
        ? input
        : input.replace(/^\/api\/db/, env.POSTGREST_URL)

    const headers = new Headers(init?.headers)
    headers.set('authorization', `Bearer ${token}`)

    // Writes from the server (the assistant, imports, pipelines) are shown to
    // the plugin hooks that run before a save, like writes from the browser.
    // Only a path string can be matched against the PostgREST prefix.
    const guarded =
      url instanceof URL || url instanceof Request
        ? {}
        : await guardServerWrite(url, init, token)

    if (guarded.refusal) return guarded.refusal

    return fetchImpl(url, { ...init, ...guarded.init, headers })
  }

  return createDataClient(authorisedFetch)
}

const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT'])

/** Asks the plugin hooks about a write. Passes everything else straight through. */
async function guardServerWrite(
  url: string,
  init: RequestInit | undefined,
  token: string,
): Promise<{ init?: RequestInit; refusal?: Response }> {
  const method = (init?.method ?? 'GET').toUpperCase()

  if (!WRITE_METHODS.has(method)) return {}

  // The hooks read the JSON text the data client sends; a stream, blob or form
  // body is not something they can inspect, so it passes through unguarded.
  const body = z.string().safeParse(init?.body)

  if (!body.success) return {}
  const prefix = `${env.POSTGREST_URL}/`

  if (!url.startsWith(prefix)) return {}
  const rest = url.slice(prefix.length)
  const [pathPart, ...queryParts] = rest.split('?')
  const segments = pathPart.split('/')
  const isRpc = segments[0] === 'rpc'
  const resource = isRpc ? segments[1] : segments[0]

  if (!resource) return {}
  const { guardRecordWrite } = await import('./extensions/record-hooks.server')

  const result = await guardRecordWrite({
    method,
    kind: isRpc ? 'rpc' : 'table',
    resource,
    query: queryParts.join('?'),
    body: body.data,
    token,
  })

  if (result.kind === 'refused')
    return {
      refusal: Response.json(
        {
          message: `${result.plugin}: ${result.message}`,
          code: 'SB070',
        },
        { status: 422 },
      ),
    }

  return result.body === body.data ? {} : { init: { body: result.body } }
}
