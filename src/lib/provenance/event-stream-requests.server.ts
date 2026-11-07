/**
 * GET /api/events/stream: the workspace's change history in order, as
 * CloudEvents 1.0. A JSON page by default, a Server-Sent Events stream when
 * the caller asks for `text/event-stream`. Both read through
 * `api.event_stream_page`, so a caller sees exactly what they could see in
 * the app and what a webhook would send them.
 *
 * Cursor: `after` (or the `Last-Event-ID` header) is the last sequence the
 * caller has. Without one a JSON read starts at the oldest kept event and a
 * live stream starts at the newest.
 */
import { annotateRequest } from '#/lib/request-log'
import { createRateLimiter } from '#/lib/rate-limit'
import {
  shapePage,
  sseFrame,
  knownEventNames,
  entityTypesFor,
} from './event-stream'
import type { ShapedPage, StreamPage } from './event-stream'

export interface StreamCaller {
  workspaceId: string
  /** What to stamp on the database session for the permission filter. */
  claims: Record<string, unknown>
}

export interface EventStreamDeps {
  authenticate: (headers: Headers) => Promise<StreamCaller | 'forbidden' | null>
  page: (
    caller: StreamCaller,
    after: number,
    limit: number,
    entityTypes: readonly string[],
  ) => Promise<StreamPage>
  /** Tell the loop to look now instead of waiting out the poll. */
  subscribe?: (workspaceId: string, wake: () => void) => Promise<() => void>
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
  pollMs?: number
  heartbeatMs?: number
  maxStreamMs?: number
  now?: () => number
}

const limiter = createRateLimiter({ maxRequests: 120, windowSeconds: 60 })

function problem(status: number, code: string, message: string, extra = {}) {
  if (status >= 500) annotateRequest({ error: { code, message } })
  return Response.json({ error: { code, message, ...extra } }, { status })
}

function parseCursor(raw: string | null): number | null | 'bad' {
  if (raw == null || raw === '') return null
  if (!/^\d{1,15}$/.test(raw)) return 'bad'
  return Number(raw)
}

export async function handleEventStream(
  request: Request,
  deps: EventStreamDeps,
): Promise<Response> {
  const caller = await deps.authenticate(request.headers)
  if (caller === 'forbidden') {
    return problem(
      403,
      'insufficient_scope',
      'This token needs the admin:read scope to read the event stream.',
    )
  }
  if (!caller) {
    return problem(401, 'unauthenticated', 'Authentication is required.')
  }
  const decision = limiter.hit(`events-stream:${caller.workspaceId}`)
  if (!decision.allowed) {
    return problem(
      429,
      'rate_limited',
      `Too many requests. Try again in ${decision.retryAfterSeconds ?? 60} seconds.`,
    )
  }
  const url = new URL(request.url)
  const cursorParam = parseCursor(
    url.searchParams.get('after') ?? request.headers.get('last-event-id'),
  )
  if (cursorParam === 'bad') {
    return problem(400, 'invalid_request', 'after must be a whole number.')
  }
  const limitRaw = url.searchParams.get('limit')
  const limit = limitRaw === null ? 200 : Number(limitRaw)
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    return problem(400, 'invalid_request', 'limit must be between 1 and 1000.')
  }
  const known = knownEventNames()
  const names = new Set(
    (url.searchParams.get('types') ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean),
  )
  const unknown = [...names].filter((name) => !known.has(name))
  if (unknown.length > 0) {
    return problem(
      400,
      'invalid_request',
      `Unknown event types: ${unknown.join(', ')}.`,
    )
  }
  annotateRequest({ workspace: { id: caller.workspaceId } })

  const wantsStream =
    (request.headers.get('accept') ?? '').includes('text/event-stream') &&
    url.searchParams.get('format') !== 'json'

  if (!wantsStream) {
    const page = await deps.page(
      caller,
      cursorParam ?? 0,
      limit,
      entityTypesFor(names),
    )
    if (page.expired) return expired(page)
    return Response.json(shapePage(caller.workspaceId, page, names))
  }
  return stream(request, caller, cursorParam, limit, names, deps)
}

function expired(page: StreamPage): Response {
  return problem(
    410,
    'cursor_expired',
    'That position is older than the events kept. Start again from the oldest kept event.',
    { earliest: page.earliest, retentionDays: page.retentionDays },
  )
}

function stream(
  request: Request,
  caller: StreamCaller,
  cursorParam: number | null,
  limit: number,
  names: ReadonlySet<string>,
  deps: EventStreamDeps,
): Response {
  const encoder = new TextEncoder()
  const pollMs = deps.pollMs ?? 3000
  const heartbeatMs = deps.heartbeatMs ?? 15000
  const maxMs = deps.maxStreamMs ?? 10 * 60_000
  const now = deps.now ?? Date.now
  const abort = new AbortController()
  request.signal.addEventListener('abort', () => abort.abort())
  const sleep =
    deps.sleep ??
    ((ms: number, signal: AbortSignal) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, ms)
        signal.addEventListener('abort', () => {
          clearTimeout(timer)
          resolve()
        })
      }))

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (text: string) => controller.enqueue(encoder.encode(text))
      let unsubscribe: (() => void) | null = null
      let wake: (() => void) | null = null
      const interrupt = new AbortController()
      abort.signal.addEventListener('abort', () => interrupt.abort())
      try {
        if (deps.subscribe) {
          unsubscribe = await deps.subscribe(caller.workspaceId, () => {
            wake?.()
          })
        }
        send('retry: 3000\n\n')
        let cursor = cursorParam
        if (cursor === null) {
          // A live stream with no cursor starts at the newest event.
          const probe = await deps.page(caller, 0, 1, [])
          cursor = probe.latest ?? 0
        }
        const startedAt = now()
        let lastSent = now()
        while (!abort.signal.aborted && now() - startedAt < maxMs) {
          const page = await deps.page(
            caller,
            cursor,
            limit,
            entityTypesFor(names),
          )
          if (page.expired) {
            send(
              `event: cursor_expired\ndata: ${JSON.stringify({ earliest: page.earliest, retentionDays: page.retentionDays })}\n\n`,
            )
            break
          }
          const shaped: ShapedPage = shapePage(caller.workspaceId, page, names)
          for (const event of shaped.events) send(sseFrame(event))
          if (shaped.events.length > 0) lastSent = now()
          cursor = shaped.nextCursor
          if (shaped.hasMore) continue
          if (now() - lastSent >= heartbeatMs) {
            send(': keep-alive\n\n')
            lastSent = now()
          }
          const nap = new AbortController()
          wake = () => nap.abort()
          interrupt.signal.addEventListener('abort', () => nap.abort())
          await sleep(pollMs, nap.signal)
          wake = null
        }
      } catch (error) {
        annotateRequest({
          error: {
            code: 'event_stream_failed',
            message: error instanceof Error ? error.message : String(error),
          },
        })
      } finally {
        unsubscribe?.()
        try {
          controller.close()
        } catch {
          // The client went away first.
        }
      }
    },
    cancel() {
      abort.abort()
    },
  })
  return new Response(body, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  })
}
