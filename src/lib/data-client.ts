/**
 * Typed fetch helper for the same-origin /api/db PostgREST boundary
 * (AUTH-003). The browser never talks to PostgREST directly; this module is
 * the single client-side surface that builds requests against /api/db and
 * parses the consistent error envelope the proxy returns.
 *
 * PostgREST field names are snake_case (docs/development/conventions.md); callers work
 * with the raw wire shape. Domain mappers belong at the call site, not here.
 */

import { markSessionExpired } from './session-expiry'
import { CLIENT_ID_HEADER, getOrCreateClientId } from './client-identity'

export interface DataError {
  code: string
  message: string
}

interface ErrorEnvelope {
  error: DataError & { category?: string }
}

const API_BASE = '/api/db'

/** SET-01.3 — the request header the editing-rule triggers read. */
export const CHANGE_REASON_HEADER = 'x-sheetbase-change-reason'

export class DataClientError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status: number) {
    super(message)
    this.name = 'DataClientError'
    this.code = code
    this.status = status
  }
}

async function parseError(response: Response): Promise<DataClientError> {
  // The proxy returns { error: { code, message } } for auth/proxy failures.
  // PostgREST returns its own JSON error body (passed through unchanged);
  // normalise both into DataClientError so callers see one shape.
  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    // Non-JSON body (e.g. upstream returned HTML or empty): fall back to
    // status text so the caller still gets a usable message.
  }

  if (body && typeof body === 'object' && 'error' in body) {
    const envelope = body as ErrorEnvelope
    // The public envelope uses `category` (see src/lib/errors.ts); accept
    // `code` as well so older test mocks and any legacy callers still work.
    const code = envelope.error.category ?? envelope.error.code
    if (code && envelope.error.message) {
      return new DataClientError(code, envelope.error.message, response.status)
    }
  }

  if (body && typeof body === 'object' && 'message' in body) {
    // PostgREST's own error shape: { code, message, details, hint }
    const pgrst = body as { code?: string; message?: string }
    return new DataClientError(
      pgrst.code ?? 'upstream_error',
      pgrst.message ?? response.statusText,
      response.status,
    )
  }

  return new DataClientError(
    'unknown_error',
    response.statusText || 'Request failed',
    response.status,
  )
}

export interface DataClient {
  list: <T>(resource: string, query?: string) => Promise<T[]>
  /**
   * Cheap total count for a resource query. Uses PostgREST's
   * `Prefer: count=exact` + `Range: 0-0` so at most one row is transferred
   * and the total is read from the `Content-Range` header
   * (`0-0/<total>`, including empty totals). Rejects responses without an exact total.
   */
  count: (resource: string, query?: string) => Promise<number>
  rpc: <T>(
    name: string,
    args: Record<string, unknown>,
    options?: { changeReason?: string },
  ) => Promise<T>
  insert: <T>(resource: string, row: Record<string, unknown>) => Promise<T>
  patch: <T>(
    resource: string,
    query: string,
    row: Record<string, unknown>,
  ) => Promise<T[]>
  /**
   * Delete rows matching a PostgREST filter query (e.g. `?id=eq.<uuid>`).
   * Goes through the same authenticated /api/db boundary as every other
   * method so RLS applies. Returns the deleted rows when the caller requests
   * `return=representation`, otherwise an empty array.
   */
  remove: (resource: string, query: string) => Promise<unknown[]>
}

export function createDataClient(fetchImpl: typeof fetch = fetch): DataClient {
  async function request(path: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers)
    // LIVE-003: stamp the tab-scoped client id on every data request so
    // the proxy mints it into the JWT and durable change events record
    // the actor's client. Missing on SSR / blocked storage → omitted.
    const clientId = getOrCreateClientId()
    if (clientId) headers.set(CLIENT_ID_HEADER, clientId)
    const response = await fetchImpl(`${API_BASE}${path}`, {
      ...init,
      headers,
    })
    if (!response.ok) {
      // J-SET-05: a 401 here means the session ended; say so once, centrally.
      if (response.status === 401 && typeof window !== 'undefined') {
        console.warn(`Data request returned 401: ${path}`)
        markSessionExpired()
      }
      throw await parseError(response)
    }
    return response
  }

  return {
    async list<T>(resource: string, query = ''): Promise<T[]> {
      const response = await request(`/${resource}${query}`, {
        method: 'GET',
        headers: { accept: 'application/json' },
      })
      return (await response.json()) as T[]
    },

    async count(resource: string, query = ''): Promise<number> {
      const response = await request(`/${resource}${query}`, {
        method: 'GET',
        // Ask PostgREST for an exact total via the Content-Range header while
        // limiting the body to a single row so counts stay cheap at scale.
        headers: {
          accept: 'application/json',
          prefer: 'count=exact',
          range: '0-0',
        },
      })
      const contentRange = response.headers.get('content-range')
      // Drain successful and invalid-count responses, without hiding stream
      // failures or mistaking a one-row response for the exact total.
      await response.text()
      const match = contentRange?.match(/^(?:(\d+)-(\d+)|\*)\/(\d+)$/)
      const total = match ? Number(match[3]) : NaN
      const start = match?.[1] === undefined ? null : Number(match[1])
      const end = match?.[2] === undefined ? null : Number(match[2])
      if (
        !Number.isSafeInteger(total) ||
        (start !== null &&
          end !== null &&
          (!Number.isSafeInteger(start) ||
            !Number.isSafeInteger(end) ||
            start > end ||
            end >= total))
      ) {
        throw new DataClientError(
          'invalid_count',
          'The server did not return an exact count.',
          response.status,
        )
      }
      return total
    },

    async rpc<T>(
      name: string,
      args: Record<string, unknown>,
      options?: { changeReason?: string },
    ): Promise<T> {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        accept: 'application/json',
        prefer: 'return=representation',
      }
      // SET-01.3: a workspace can require a reason for changing a saved value;
      // the reason travels in the header the write triggers read.
      if (options?.changeReason)
        headers[CHANGE_REASON_HEADER] = options.changeReason
      const response = await request(`/rpc/${name}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(args),
      })
      // Native PostgREST void functions succeed with 204 and no JSON body.
      return (response.status === 204 ? undefined : await response.json()) as T
    },

    async insert<T>(
      resource: string,
      row: Record<string, unknown>,
    ): Promise<T> {
      const response = await request(`/${resource}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          prefer: 'return=representation',
        },
        body: JSON.stringify(row),
      })
      return (await response.json()) as T
    },

    async patch<T>(
      resource: string,
      query: string,
      row: Record<string, unknown>,
    ): Promise<T[]> {
      const response = await request(`/${resource}${query}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          prefer: 'return=representation',
        },
        body: JSON.stringify(row),
      })
      return (await response.json()) as T[]
    },

    async remove(resource: string, query: string): Promise<unknown[]> {
      const response = await request(`/${resource}${query}`, {
        method: 'DELETE',
        headers: {
          accept: 'application/json',
          prefer: 'return=representation',
        },
      })
      // PostgREST returns the deleted rows with return=representation; an
      // empty body (e.g. when nothing matched) parses to an empty array.
      try {
        return (await response.json()) as unknown[]
      } catch {
        return []
      }
    },
  }
}
