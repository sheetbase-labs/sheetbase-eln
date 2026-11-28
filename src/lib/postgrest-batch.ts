/**
 * Read batching, server side. `POST /api/db-batch` takes a list of reads that
 * the browser started together and answers them in one response. Each read
 * goes through the same data proxy as a read sent alone (`handleProxyRequest`),
 * as the same signed-in person with the same short-lived token, so row-level
 * security, rate limits, path checks and error shapes are unchanged. The only
 * thing shared is the sign-in lookup, done once for the batch.
 *
 * Only reads travel here: table reads and the stable functions listed in
 * `batchable-reads.ts`. Anything else is refused for that entry, never run.
 */
import { z } from 'zod'

import { isBatchableRead } from './batchable-reads'
import { errorEnvelope } from './errors'
import { handleProxyRequest } from './postgrest-proxy'
import type { ProxyDeps } from './postgrest-proxy'
import { BATCH_MAX_READS } from './read-batch'
import { stampRequestId, resolveRequestId } from './request-id'

const batchBody = z.object({
  reads: z
    .array(
      z.object({
        path: z.string().min(2).max(8192).startsWith('/'),
        method: z.enum(['GET', 'POST']),
        headers: z.record(z.string(), z.string()).default({}),
        body: z.string().max(65536).optional(),
      }),
    )
    .min(1)
    .max(BATCH_MAX_READS),
})

/** The request headers a batched read inherits from the batch request. */
const INHERITED_HEADERS = [
  'cookie',
  'x-sheetbase-client-id',
  'x-sheetbase-workspace',
  'user-agent',
  'accept-language',
] as const

/** The headers a read may set for itself. Anything else is dropped. */
const OWN_HEADERS = ['accept', 'prefer', 'range', 'content-type'] as const

function once<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null

  return () => {
    pending ??= load()

    return pending
  }
}

/** The proxy's own dependencies, with the sign-in lookup shared by the batch. */
function sharedSignIn(deps: ProxyDeps, headers: Headers): ProxyDeps {
  const session = once(() => deps.getSession(headers))
  const minted = new Map<string, Promise<string>>()

  const workspaces = new Map<
    string,
    ReturnType<ProxyDeps['getWorkspaceForUser']>
  >()

  return {
    ...deps,
    getSession: () => session(),
    getWorkspaceForUser: (userId) => {
      let found = workspaces.get(userId)

      if (!found) {
        found = deps.getWorkspaceForUser(userId)
        workspaces.set(userId, found)
      }

      return found
    },
    mintToken: (input) => {
      const key = JSON.stringify(input)
      let token = minted.get(key)

      if (!token) {
        token = deps.mintToken(input)
        minted.set(key, token)
      }

      return token
    },
  }
}

export async function handleBatchRequest(
  request: Request,
  deps: ProxyDeps,
): Promise<Response> {
  const requestId = resolveRequestId(request.headers)

  // Reads are answered for people signed in with a browser session only; an
  // API token sends its reads to /api/db directly.
  if (request.headers.get('authorization') !== null) {
    return stampRequestId(
      errorEnvelope({
        category: 'unauthenticated',
        status: 401,
        message: 'Batched reads need a browser session.',
        requestId,
      }),
      requestId,
    )
  }

  const parsed = batchBody.safeParse(
    await request.json().catch(() => undefined),
  )

  if (!parsed.success) {
    return stampRequestId(
      errorEnvelope({
        category: 'validation_error',
        status: 400,
        message: 'The batch is not a list of reads.',
        requestId,
      }),
      requestId,
    )
  }

  // The person is resolved once, from the batch's own cookies; the reads inherit them.
  const inherited = new Headers()

  for (const name of INHERITED_HEADERS) {
    const value = request.headers.get(name)

    if (value) inherited.set(name, value)
  }

  const shared = sharedSignIn(deps, request.headers)
  const origin = new URL(request.url).origin

  const results = await Promise.all(
    parsed.data.reads.map(async (read) => {
      const headers = new Headers(inherited)

      for (const name of OWN_HEADERS) {
        const value = read.headers[name]

        if (value) headers.set(name, value)
      }

      const url = new URL(`/api/db${read.path}`, origin)
      const stable = isBatchableRead(read.method, read.path)

      if (!stable || !url.pathname.startsWith('/api/db/')) {
        const refused = errorEnvelope({
          category: 'validation_error',
          status: 400,
          message: 'Only reads can be batched.',
          requestId,
        })

        return {
          status: refused.status,
          body: await refused.text(),
          contentRange: null,
        }
      }

      const response = await handleProxyRequest(
        new Request(url, {
          method: read.method,
          headers,
          body: read.method === 'POST' ? (read.body ?? '{}') : undefined,
        }),
        url.pathname.slice('/api/db/'.length),
        shared,
      )

      return {
        status: response.status,
        body: await response.text(),
        contentRange: response.headers.get('content-range'),
      }
    }),
  )

  return stampRequestId(Response.json({ results }), requestId)
}
