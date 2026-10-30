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
import { devFetch } from './dev-network'
import {
  CHANGE_REASON_REQUIRED_CODE,
  askForChangeReason,
  rememberedChangeReason,
} from './change-reason'

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

/**
 * One screen asks for the same rows from several places (the record, its
 * links, its project). Reads for an identical URL that are already in flight,
 * or finished a moment ago, share one network call; each caller still parses
 * its own copy. Any write, and any live change event, empties the cache so a
 * read never returns rows from before a change the app knows about.
 */
const SHARED_READ_MS = 1000

interface SharedRead {
  at: number
  settled: boolean
  result: Promise<{ body: string; status: number; contentRange: string | null }>
}

const readStores = new Set<Map<string, SharedRead>>()
const sharedReads = new WeakMap<object, Map<string, SharedRead>>()

/** Forget every shared read: something the app knows about has changed. */
export function dropSharedReads(): void {
  readStores.forEach((store) => store.clear())
}

function readStoreFor(fetchImpl: object): Map<string, SharedRead> | null {
  // The server renders for many people; only the browser shares reads.
  if (typeof window === 'undefined') return null
  let store = sharedReads.get(fetchImpl)
  if (!store) {
    store = new Map()
    sharedReads.set(fetchImpl, store)
    readStores.add(store)
  }
  return store
}

/** Functions that only look things up, or only note a view, change no rows a read returns. */
const READ_ONLY_RPC =
  /^\/rpc\/(my_|is_|can_|has_|get_|list_|query_|compare_|record_recent_view$|require_capability$|project_members$|workspace_(members_list|member_status|groups_list|project_access_rules)$|[a-z_]*_list$)/

function changesRows(path: string, method: string | undefined): boolean {
  if (method === undefined || method === 'GET') return false
  return !READ_ONLY_RPC.test(path)
}

export function createDataClient(fetchImpl: typeof fetch = fetch): DataClient {
  const reads = readStoreFor(fetchImpl)

  async function sharedGet(
    path: string,
    headers: Record<string, string>,
  ): Promise<{ body: string; status: number; contentRange: string | null }> {
    const run = async () => {
      const response = await request(path, { method: 'GET', headers })
      return {
        body: await response.text(),
        status: response.status,
        contentRange: response.headers.get('content-range'),
      }
    }
    if (!reads) return run()
    const key = `${path}\n${headers.prefer as string | undefined}\n${headers.range as string | undefined}`
    const known = reads.get(key)
    if (known && (!known.settled || Date.now() - known.at < SHARED_READ_MS)) {
      return known.result
    }
    const entry: SharedRead = {
      at: Date.now(),
      settled: false,
      result: run(),
    }
    reads.set(key, entry)
    const settle = () => {
      entry.settled = true
      entry.at = Date.now()
    }
    entry.result.then(settle, () => {
      settle()
      if (reads.get(key) === entry) reads.delete(key)
    })
    return entry.result
  }

  async function request(path: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers)
    // LIVE-003: stamp the tab-scoped client id on every data request so
    // the proxy mints it into the JWT and durable change events record
    // the actor's client. Missing on SSR / blocked storage → omitted.
    const clientId = getOrCreateClientId()
    if (clientId) headers.set(CLIENT_ID_HEADER, clientId)
    // A reason given a moment ago covers the edits that follow it.
    const writes = init.method !== undefined && init.method !== 'GET'
    const changes = changesRows(path, init.method)
    if (changes) dropSharedReads()
    if (writes && !headers.has(CHANGE_REASON_HEADER)) {
      const known = rememberedChangeReason()
      if (known) headers.set(CHANGE_REASON_HEADER, known)
    }
    let response = await devFetch(fetchImpl, `${API_BASE}${path}`, {
      ...init,
      headers,
    })
    if (!response.ok && writes && !headers.has(CHANGE_REASON_HEADER)) {
      // The workspace asks for a reason when a saved value changes: ask once,
      // then send the same write again with it.
      const refusal = await parseError(response.clone())
      if (refusal.code === CHANGE_REASON_REQUIRED_CODE) {
        const reason = await askForChangeReason()
        if (reason) {
          headers.set(CHANGE_REASON_HEADER, reason)
          response = await devFetch(fetchImpl, `${API_BASE}${path}`, {
            ...init,
            headers,
          })
        }
      }
    }
    if (changes) dropSharedReads()
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
      const shared = await sharedGet(`/${resource}${query}`, {
        accept: 'application/json',
      })
      return JSON.parse(shared.body) as T[]
    },

    async count(resource: string, query = ''): Promise<number> {
      // Ask PostgREST for an exact total via the Content-Range header while
      // limiting the body to a single row so counts stay cheap at scale.
      const shared = await sharedGet(`/${resource}${query}`, {
        accept: 'application/json',
        prefer: 'count=exact',
        range: '0-0',
      })
      const contentRange = shared.contentRange
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
          shared.status,
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
