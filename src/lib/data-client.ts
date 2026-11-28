/**
 * Typed fetch helper for the same-origin /api/db PostgREST boundary
 * (AUTH-003). The browser never talks to PostgREST directly; this module is
 * the single client-side surface that builds requests against /api/db and
 * parses the consistent error envelope the proxy returns.
 *
 * PostgREST field names are snake_case (docs/development/conventions.md); callers work
 * with the raw wire shape. Domain mappers belong at the call site, not here.
 */

import { mergeChunkedRows, splitLongInQuery } from '#/lib/chunked-in-query'
import { z } from 'zod'

import { markSessionExpired } from './session-expiry'
import { CLIENT_ID_HEADER, getOrCreateClientId } from './client-identity'
import { isBatchableRead } from './batchable-reads'
import { devFetch } from './dev-network'
import { queueRead } from './read-batch'
import { announcePluginWarnings } from './plugin-warnings'
import {
  CHANGE_REASON_REQUIRED_CODE,
  askForChangeReason,
  rememberedChangeReason,
} from './change-reason'

export interface DataError {
  code: string
  message: string
}

const proxyErrorSchema = z.object({
  error: z.object({
    category: z.unknown().optional(),
    code: z.unknown().optional(),
    message: z.string(),
  }),
})

const postgrestErrorSchema = z.object({
  code: z.string().nullish(),
  message: z.string().nullable(),
})

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
  // Non-JSON, empty and malformed bodies use the status-text fallback below.
  let body: unknown

  try {
    body = await response.json()
  } catch {
    // Preserve fallback even when a supplied fetch implementation throws synchronously.
  }

  const envelope = proxyErrorSchema.safeParse(body)

  if (envelope.success) {
    // The public envelope uses `category` (see src/lib/errors.ts); accept
    // `code` as well so older test mocks and any legacy callers still work.
    // Validate only the selected code so an unused legacy field cannot override category.
    const code = z
      .string()
      .safeParse(envelope.data.error.category ?? envelope.data.error.code)

    if (code.success && code.data && envelope.data.error.message) {
      return new DataClientError(
        code.data,
        envelope.data.error.message,
        response.status,
      )
    }
  }

  // PostgREST's own error shape: { code, message, details, hint }
  const pgrst = postgrestErrorSchema.safeParse(body)

  if (pgrst.success) {
    return new DataClientError(
      pgrst.data.code ?? 'upstream_error',
      pgrst.data.message ?? response.statusText,
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
  /** Starts a read ahead of whoever will ask for it (see `primeRead`). Optional: test doubles leave it out. */
  prime?: (read: ReadSpec) => void
  /** Holds an answer already on its way for a read (see `primeReadWith`). */
  primeWith?: (
    read: ReadSpec,
    answer: Promise<ReadAnswer>,
    since: number,
  ) => void
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
    // Domain callers own argument schemas; native JSON serialization happens here.
    // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type
    args: Record<string, unknown>,
    options?: { changeReason?: string },
  ) => Promise<T>
  // Transport accepts caller-owned row contracts, including their native JSON coercion.
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type
  insert: <T>(resource: string, row: Record<string, unknown>) => Promise<T>
  patch: <T>(
    resource: string,
    query: string,
    // Partial row schemas belong to the resource owner, not this generic transport.
    // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type
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

/**
 * A read started ahead of the page that will ask for it (see
 * route-warm-start.ts). It waits this long for its first reader; after that it
 * is forgotten, so a guess that was never needed cannot serve stale rows.
 */
const PRIMED_READ_MS = 10_000

/** What a read answered: enough to hand it to each caller as a response. */
export interface ReadAnswer {
  body: string
  status: number
  contentRange: string | null
}

interface SharedRead {
  at: number
  created: number
  settled: boolean
  /** Started ahead of time and not yet asked for by anything. */
  primed: boolean
  result: Promise<ReadAnswer>
}

/** One read as the client sends it: enough to send the same read again. */
export interface ReadSpec {
  method: 'GET' | 'POST'
  path: string
  headers: Record<string, string>
  body?: string
}

let readObserver: ((read: ReadSpec) => void) | null = null

/** Hears every read the browser data client is asked for (not the ones it primes). */
export function observeReads(listener: ((read: ReadSpec) => void) | null) {
  readObserver = listener
}

/** Starts a read ahead of the page that will ask for it; the first reader gets its answer. */
export function primeRead(read: ReadSpec): void {
  createDataClient().prime?.(read)
}

/**
 * Holds an answer that is already on its way, started at `since` (the page's
 * first reads, sent before the app's code loaded: early-reads.ts). The first
 * reader gets it, the same as a primed read; if it fails, the reader asks for
 * itself.
 */
export function primeReadWith(
  read: ReadSpec,
  answer: Promise<ReadAnswer>,
  since: number,
): void {
  createDataClient().primeWith?.(read, answer, since)
}

const readStores = new Set<Map<string, SharedRead>>()
const sharedReads = new WeakMap<typeof fetch, Map<string, SharedRead>>()

/** Forget every shared read: something the app knows about has changed. */
export function dropSharedReads(): void {
  readStores.forEach((store) => store.clear())
}

type RowsChangedListener = (path: string) => void

const rowsChangedListeners = new Set<RowsChangedListener>()

/**
 * Hear about every write that succeeded and changed rows. The app uses it to
 * mark cached lists, counts and sidebars stale so a change made on one page
 * shows on every other page straight away, not only after a reload.
 */
export function onRowsChanged(listener: RowsChangedListener): () => void {
  rowsChangedListeners.add(listener)

  return () => {
    rowsChangedListeners.delete(listener)
  }
}

function readStoreFor(fetchImpl: typeof fetch): Map<string, SharedRead> | null {
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
  /^\/rpc\/(set_list_view$|my_|is_|can_|has_|get_|list_|query_|compare_|record_recent_view$|require_capability$|project_members$|workspace_(members_list|member_status|groups_list|project_access_rules)$|[a-z_]*_list$)/

function changesRows(path: string, method: string | undefined): boolean {
  if (method === undefined || method === 'GET') return false

  // A STABLE database function reads and never writes, so it changes no rows.
  if (isBatchableRead(method, path)) return false

  return !READ_ONLY_RPC.test(path)
}

/**
 * Functions the app calls with POST that really change something. Some read
 * functions are also POSTs (reports, audit, member lists), so a POST alone does
 * not mean a change; announcing those would refresh the page that just asked.
 */
const WRITING_RPC =
  /^\/rpc\/(create|set|update|remove|delete|save|apply|retire|request|cancel|add|archive|unarchive|resolve|move|start|restore|publish|complete|revoke|edit|register|link|unlink|submit|assign|unassign|mark|withdraw|commit|duplicate|fail|receive|instantiate|insert|decide|approve|reject|clear|freeze|unfreeze|follow|unfollow|return|promote|bind|rotate|replace|upgrade|reparent|transition|mutate|enable|disable|leave|rename|reorder|sign|install|append|advance|change|release|end|grant|accept|share|unshare|dispose|discard|quarantine|dismiss|pin|unpin|reopen|transfer|certify|import|suspend|reinstate|reissue|dissolve|resume|activate|aliquot|pool|join|flag|skip|keep|claim|confirm|acknowledge|send|reply|answer|post|log|finalize|ensure|configure|extension|enrol|propose|adopt|convert|retarget|consume|ingest|touch|run|recompute|sweep|prune|snapshot|record_(?:sample_measurement|reagent_movement|stocktake_scan|qc_check|instrument_calibration|protocol_deviation_reason|client_sharing))/

function announcesChange(path: string, method: string | undefined): boolean {
  if (!changesRows(path, method)) return false

  return !path.startsWith('/rpc/') || WRITING_RPC.test(path)
}

/** The request headers a batched read keeps; the rest belong to the batch request. */
function batchedHeaders(headers: Headers) {
  return Object.fromEntries(
    ['accept', 'prefer', 'range', 'content-type'].flatMap((name) => {
      const value = headers.get(name)

      return value ? [[name, value]] : []
    }),
  )
}

export function createDataClient(fetchImpl: typeof fetch = fetch): DataClient {
  const reads = readStoreFor(fetchImpl)

  function readKey(spec: ReadSpec): string {
    return `${spec.method} ${spec.path}\n${spec.headers.prefer}\n${spec.headers.range}\n${spec.body ?? ''}`
  }

  async function sharedRead(
    spec: ReadSpec,
    primed = false,
  ): Promise<ReadAnswer> {
    const run = async () => {
      const response = await request(spec.path, {
        method: spec.method,
        headers: spec.headers,
        body: spec.body,
      })

      return {
        body: await response.text(),
        status: response.status,
        contentRange: response.headers.get('content-range'),
      }
    }

    if (!reads) return run()

    if (!primed) readObserver?.(spec)
    const key = readKey(spec)
    const known = reads.get(key)

    if (known?.primed) {
      if (primed) return known.result

      if (Date.now() - known.created > PRIMED_READ_MS) {
        reads.delete(key)
      } else {
        // First reader: it gets the answer, and the usual short sharing starts.
        known.primed = false
        known.at = Date.now()

        // A guess that failed is not the page's answer: the page asks for itself.
        return known.result.catch(() => sharedRead(spec))
      }
    } else if (
      known &&
      (!known.settled || Date.now() - known.at < SHARED_READ_MS)
    ) {
      return known.result
    }

    const entry: SharedRead = {
      at: Date.now(),
      created: Date.now(),
      settled: false,
      primed,
      result: run(),
    }

    reads.set(key, entry)

    const settle = () => {
      entry.settled = true

      if (!entry.primed) entry.at = Date.now()
    }

    entry.result.then(settle, () => {
      settle()

      if (reads.get(key) === entry) reads.delete(key)
    })

    return entry.result
  }

  function sharedGet(path: string, headers: Record<string, string>) {
    return sharedRead({ method: 'GET', path, headers })
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

    const sendAlone = () =>
      devFetch(fetchImpl, `${API_BASE}${path}`, { ...init, headers })

    // Reads that start together travel together (see read-batch.ts); writes,
    // and anything else, go on their own as they always did.
    const queued = queueRead(
      {
        path,
        method: init.method === 'POST' ? 'POST' : 'GET',
        headers: batchedHeaders(headers),
        // A read's body is the JSON text of a function's arguments, or nothing.
        // oxlint-disable-next-line anti-slop/no-runtime-typeof -- rpc() always sends a JSON string
        body: typeof init.body === 'string' ? init.body : undefined,
      },
      sendAlone,
      (url, batchInit) => devFetch(fetchImpl, url, batchInit),
      (batchHeaders) => {
        if (clientId) batchHeaders.set(CLIENT_ID_HEADER, clientId)
      },
    )

    let response = await (queued ?? sendAlone())

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

    if (writes) announcePluginWarnings(response)

    if (announcesChange(path, init.method))
      rowsChangedListeners.forEach((listener) => listener(path))

    return response
  }

  async function listRows<T>(resource: string, query = ''): Promise<T[]> {
    // An id list too long for one request is read in groups, here, once.
    const groups = splitLongInQuery(query)

    if (groups) {
      const parts = await Promise.all(
        groups.map((group) => listRows<T>(resource, group)),
      )

      return mergeChunkedRows(query, parts)
    }

    const shared = await sharedGet(`/${resource}${query}`, {
      accept: 'application/json',
    })

    // T is the caller's wire expectation; domain consumers validate their own rows.
    // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion
    return JSON.parse(shared.body) as T[]
  }

  return {
    prime(read: ReadSpec) {
      if (!reads) return
      // A guess that fails is not an error anyone should see; the page's own read will say so.
      sharedRead(read, true).catch(() => undefined)
    },

    primeWith(read: ReadSpec, answer: Promise<ReadAnswer>, since: number) {
      if (!reads) return
      const key = readKey(read)

      if (reads.has(key)) return

      const entry: SharedRead = {
        at: since,
        created: since,
        settled: false,
        primed: true,
        result: answer,
      }

      reads.set(key, entry)
      // A failed answer is dropped, so whoever asks next sends the read itself.
      answer.then(
        () => {
          entry.settled = true
        },
        () => {
          entry.settled = true

          if (reads.get(key) === entry) reads.delete(key)
        },
      )
    },

    list: listRows,

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
      // This is serialization, not validation of the operation-specific argument contract.
      // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type
      args: Record<string, unknown>,
      options?: { changeReason?: string },
    ): Promise<T> {
      const headers = {
        'content-type': 'application/json',
        accept: 'application/json',
        prefer: 'return=representation',
      }

      // SET-01.3: a workspace can require a reason for changing a saved value;
      // the reason travels in the header the write triggers read.
      if (options?.changeReason)
        Object.assign(headers, { [CHANGE_REASON_HEADER]: options.changeReason })

      // A stable function only reads: ask for it the way every read is asked
      // for, so identical calls share one answer and a primed one is used.
      if (
        !(CHANGE_REASON_HEADER in headers) &&
        isBatchableRead('POST', `/rpc/${name}`)
      ) {
        const shared = await sharedRead({
          method: 'POST',
          path: `/rpc/${name}`,
          headers,
          body: JSON.stringify(args),
        })

        // The caller selects T; this generic transport does not validate RPC result schemas.
        // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion
        return (
          shared.status === 204 ? undefined : JSON.parse(shared.body)
        ) as T
      }

      const response = await request(`/rpc/${name}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(args),
      })

      // Native PostgREST void functions succeed with 204 and no JSON body.
      // The caller selects T; this generic transport does not validate RPC result schemas.
      // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion
      return (response.status === 204 ? undefined : await response.json()) as T
    },

    async insert<T>(
      resource: string,
      // Preserve native JSON conversion; resource owners supply the row contract.
      // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type
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

      // T is caller-owned, not established by JSON decoding alone.
      // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion
      return (await response.json()) as T
    },

    async patch<T>(
      resource: string,
      query: string,
      // Partial rows can contain native values with existing JSON coercion semantics.
      // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type
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

      // Resource-specific response validation belongs to callers of this transport.
      // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion
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
        // The transport preserves the decoded representation without validating its row schema.
        // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion
        return (await response.json()) as unknown[]
      } catch {
        return []
      }
    },
  }
}
