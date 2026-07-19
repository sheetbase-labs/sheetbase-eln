/**
 * Typed fetch helper for the same-origin /api/db PostgREST boundary
 * (AUTH-003). The browser never talks to PostgREST directly; this module is
 * the single client-side surface that builds requests against /api/db and
 * parses the consistent error envelope the proxy returns.
 *
 * PostgREST field names are snake_case (docs/conventions.md); callers work
 * with the raw wire shape. Domain mappers belong at the call site, not here.
 */

import { CLIENT_ID_HEADER, getOrCreateClientId } from './client-identity'

export interface DataError {
  code: string
  message: string
}

interface ErrorEnvelope {
  error: DataError & { category?: string }
}

const API_BASE = '/api/db'

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
  rpc: <T>(name: string, args: Record<string, unknown>) => Promise<T>
  insert: <T>(resource: string, row: Record<string, unknown>) => Promise<T>
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

    async rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
      const response = await request(`/rpc/${name}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          prefer: 'return=representation',
        },
        body: JSON.stringify(args),
      })
      return (await response.json()) as T
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
  }
}
