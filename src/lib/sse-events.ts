/**
 * LIVE-002: replayable server-sent events for durable workspace change
 * events. The browser opens `GET /api/events` (an authenticated, workspace-
 * scoped SSE stream); the server replays durable events the client missed
 * (from `Last-Event-ID`) and then streams live events as they are emitted.
 *
 * The handler is a pure function of injectable deps so the replay/reset
 * logic is unit-testable without a database or a long-lived socket. The
 * route (`src/routes/api/events.ts`) wires real deps: Better Auth session,
 * workspace lookup, a `pg` LISTEN subscription and a bounded replay query
 * against `api.change_events`.
 *
 * Wire format is standard SSE: each event is
 *   id: <sequence>\n
 *   event: <event type>\n
 *   data: <json>\n\n
 * The `id` is the per-workspace `sequence`, so the browser's native
 * `Last-Event-ID` header on reconnect carries the resume cursor without
 * any client-side state.
 *
 * A `reset` event tells the client its requested history is unavailable
 * (retention window or replay bound exceeded). The client refetches the
 * current state of the affected collections and reconnects from
 * `resumeFrom`. No silent data loss.
 */
import { logger } from '#/lib/logger'

// ---------------------------------------------------------------------------x
// Wire shape (camelCase, as the browser consumes it). The DB row is
// snake_case; readEvents maps it once on the server so the client never
// sees snake_case.
// ---------------------------------------------------------------------------x

export interface ChangeEventWire {
  id: string
  workspaceId: string
  sequence: number
  entityType: string
  entityUuid: string
  operation: string
  recordId: string | null
  projectId: string | null
  actorUserId: string | null
  clientId: string | null
  payload: Record<string, unknown>
  createdAt: string
}

export interface Unsubscribe {
  (): void
}

export interface ReplayResult {
  events: ChangeEventWire[]
  /** True when more retained events exist beyond the bound. */
  hasMore: boolean
  /** The earliest sequence still retained for the workspace (reset hint). */
  earliestAvailableSeq: number
}

export interface SseDeps {
  getSession: (headers: Headers) => Promise<{
    user: { id: string }
    session: { id: string }
  } | null>
  getWorkspaceForUser: (userId: string) => Promise<{ id: string } | null>
  /**
   * Read retained durable events with `sequence > afterSeq`, workspace-
   * scoped, bounded to `limit`. `earliestAvailableSeq` lets the handler
   * detect that the client's `Last-Event-ID` points into history that has
   * been cleaned up.
   */
  readEvents: (
    workspaceId: string,
    afterSeq: number,
    limit: number,
  ) => Promise<ReplayResult>
  /**
   * Subscribe to live change notifications for the workspace. The callback
   * is invoked for each durable event whose `workspaceId` matches. Returns
   * an unsubscribe that also releases the underlying listener/connection.
   */
  subscribe: (
    workspaceId: string,
    onEvent: (event: ChangeEventWire) => void,
  ) => Promise<Unsubscribe>
  /** Re-check the session is still valid at heartbeat time. */
  isSessionValid: (headers: Headers) => Promise<boolean>
  /** Now, in ms — injectable for deterministic heartbeats in tests. */
  now: () => number
}

// ---------------------------------------------------------------------------x
// Pure helpers.
// ---------------------------------------------------------------------------x

/** SSE max bound on a single replay batch. Larger histories → reset. */
export const REPLAY_BOUND = 500

/** Heartbeat interval (ms). A comment line keeps the connection alive. */
export const HEARTBEAT_INTERVAL_MS = 15_000

/** Session re-check interval (ms). */
export const SESSION_CHECK_INTERVAL_MS = 30_000

/**
 * Parse the SSE `Last-Event-ID` header into a non-negative integer. The
 * browser sends the `id` of the last event it received; we resume after
 * it. Missing or malformed → 0 (replay from the start).
 */
export function parseLastEventId(headers: Headers): number {
  const raw = headers.get('last-event-id')
  if (raw === null) return 0
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n < 0) return 0
  return n
}

/**
 * Format a durable event as an SSE block. The `id` is the sequence so a
 * native browser reconnect carries the resume cursor automatically.
 */
export function formatSseEvent(event: ChangeEventWire): string {
  const data = JSON.stringify(event)
  return `id: ${event.sequence}\nevent: change\ndata: ${data}\n\n`
}

/**
 * Format a control event (reset/heartbeat/hello). Control events have no
 * `id` so they do not advance the client's resume cursor.
 */
export function formatControlEvent(
  type: 'reset' | 'hello' | 'bye',
  data: Record<string, unknown>,
): string {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`
}

/** A heartbeat is an SSE comment line — keeps the connection alive, no id. */
export function formatHeartbeat(): string {
  return `:heartbeat\n\n`
}

/**
 * Decide what to send after reading a bounded replay batch.
 *
 * - If the client's `afterSeq` is below `earliestAvailableSeq`, the
 *   requested history has been cleaned up: send a `reset` with
 *   `resumeFrom = earliestAvailableSeq` and reason `history_unavailable`.
 * - Else if `hasMore` (the bound was hit and events remain), send a
 *   `reset` with `resumeFrom = lastEventSeq` and reason `replay_bound` so
 *   the client reconnects from the furthest point we did deliver.
 * - Otherwise send the events as-is; live mode follows.
 */
export function decideReplay(
  afterSeq: number,
  replay: ReplayResult,
): {
  events: ChangeEventWire[]
  reset: {
    reason: 'history_unavailable' | 'replay_bound'
    resumeFrom: number
  } | null
} {
  if (afterSeq > 0 && afterSeq < replay.earliestAvailableSeq) {
    return {
      events: [],
      reset: {
        reason: 'history_unavailable',
        resumeFrom: replay.earliestAvailableSeq,
      },
    }
  }
  if (replay.hasMore && replay.events.length > 0) {
    const lastSeq = replay.events[replay.events.length - 1].sequence
    return {
      events: replay.events,
      reset: { reason: 'replay_bound', resumeFrom: lastSeq },
    }
  }
  return { events: replay.events, reset: null }
}

// ---------------------------------------------------------------------------x
// Handler.
// ---------------------------------------------------------------------------x

export interface SseHandlerOptions {
  replayBound?: number
  heartbeatIntervalMs?: number
  sessionCheckIntervalMs?: number
}

/**
 * Handle `GET /api/events`. Returns a `text/event-stream` Response whose
 * body is a ReadableStream that:
 *   1. sends a `hello` control event;
 *   2. replays durable events after `Last-Event-ID` (bounded, with a
 *      `reset` if the requested history is unavailable or exceeds the
 *      bound);
 *   3. streams live events as they are emitted;
 *   4. sends comment heartbeats;
 *   5. closes the connection when the session is no longer valid.
 *
 * Unauthenticated or workspace-less callers get a plain JSON 401/403; they
 * never reach the stream.
 */
export async function handleSseRequest(
  request: Request,
  deps: SseDeps,
  options: SseHandlerOptions = {},
): Promise<Response> {
  const replayBound = options.replayBound ?? REPLAY_BOUND
  const heartbeatIntervalMs =
    options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS
  const sessionCheckIntervalMs =
    options.sessionCheckIntervalMs ?? SESSION_CHECK_INTERVAL_MS

  const session = await deps.getSession(request.headers)
  if (!session) {
    return Response.json(
      { error: { category: 'unauthenticated', message: 'Sign in required.' } },
      { status: 401 },
    )
  }
  const workspace = await deps.getWorkspaceForUser(session.user.id)
  if (!workspace) {
    return Response.json(
      { error: { category: 'no_workspace', message: 'No active workspace.' } },
      { status: 403 },
    )
  }

  const lastSeen = parseLastEventId(request.headers)
  const encoder = new TextEncoder()
  const controller = new ReadableStreamDefaultControllerHolder()

  let unsub: Unsubscribe | null = null
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  let sessionTimer: ReturnType<typeof setInterval> | null = null
  let closed = false

  function send(chunk: string): void {
    if (closed) return
    try {
      controller.enqueue(encoder.encode(chunk))
    } catch {
      // The client went away; the cancel path will clean up.
      close(new Error('stream gone'))
    }
  }

  function close(reason?: unknown): void {
    if (closed) return
    closed = true
    if (heartbeatTimer) clearInterval(heartbeatTimer)
    if (sessionTimer) clearInterval(sessionTimer)
    if (unsub) {
      try {
        unsub()
      } catch {
        /* best effort */
      }
      unsub = null
    }
    try {
      controller.close()
    } catch {
      /* already closed */
    }
    if (reason instanceof Error) {
      logger.info('sse connection closed', {
        workspace_id: workspace?.id,
        reason: reason.message,
      })
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controllerInner) {
      controller.attach(controllerInner)
      // Hello + the resume cursor we are starting from, so the client can
      // surface "caught up to N" status.
      send(
        formatControlEvent('hello', {
          workspaceId: workspace.id,
          resumeFrom: lastSeen,
        }),
      )

      // Subscribe BEFORE replay so events emitted between replay and live
      // mode are not lost. Buffer any that arrive during replay; forward
      // them once replay completes.
      const liveBuffer: ChangeEventWire[] = []
      let replayDone = false
      // Last sequence actually written to the stream. Used to drop live
      // notifications that overlap replay (race between the LISTEN
      // connection and the replay read) so a client never sees the same
      // event id twice.
      let lastDeliveredSeq = lastSeen
      unsub = await deps.subscribe(workspace.id, (event) => {
        if (!replayDone) {
          liveBuffer.push(event)
        } else if (event.sequence > lastDeliveredSeq) {
          lastDeliveredSeq = event.sequence
          send(formatSseEvent(event))
        }
      })

      // Replay.
      let replay: ReplayResult
      try {
        replay = await deps.readEvents(workspace.id, lastSeen, replayBound)
      } catch (err) {
        send(
          formatControlEvent('bye', {
            reason: 'replay_failed',
            message: err instanceof Error ? err.message : 'replay_failed',
          }),
        )
        close(new Error('replay_failed'))
        return
      }
      const decision = decideReplay(lastSeen, replay)
      for (const event of decision.events) {
        send(formatSseEvent(event))
      }
      if (decision.reset) {
        send(
          formatControlEvent('reset', {
            reason: decision.reset.reason,
            resumeFrom: decision.reset.resumeFrom,
          }),
        )
        // After a reset, stop streaming live for this connection; the
        // client refetches state and reconnects from resumeFrom.
        close(new Error(decision.reset.reason))
        return
      }

      // Drain the live buffer, dropping any event whose sequence was
      // already delivered during replay (idempotent replay / dup).
      lastDeliveredSeq =
        decision.events.length > 0
          ? decision.events[decision.events.length - 1].sequence
          : lastSeen
      for (const buffered of liveBuffer) {
        if (buffered.sequence > lastDeliveredSeq) {
          lastDeliveredSeq = buffered.sequence
          send(formatSseEvent(buffered))
        }
      }
      replayDone = true

      // Heartbeats.
      heartbeatTimer = setInterval(() => {
        send(formatHeartbeat())
      }, heartbeatIntervalMs)

      // Periodic session validity check.
      sessionTimer = setInterval(async () => {
        try {
          const valid = await deps.isSessionValid(request.headers)
          if (!valid) {
            send(formatControlEvent('bye', { reason: 'session_expired' }))
            close(new Error('session_expired'))
          }
        } catch {
          close(new Error('session_check_failed'))
        }
      }, sessionCheckIntervalMs)
    },
    cancel() {
      close(new Error('client_cancelled'))
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      // Disable Nagle and any proxy buffering; the stream is one chunk per
      // event. `X-Accel-Buffering: no` covers nginx in front of the orb.
      'x-accel-buffering': 'no',
      connection: 'keep-alive',
    },
  })
}

/**
 * Tiny holder so the `close`/`send` closures above can reference the
 * controller before `start` attaches it. The stream always calls `start`
 * synchronously on construction, so attach() happens immediately; the
 * holder exists only to keep the closure types honest.
 */
class ReadableStreamDefaultControllerHolder {
  private ctl: ReadableStreamDefaultController<Uint8Array> | null = null
  attach(ctl: ReadableStreamDefaultController<Uint8Array>): void {
    this.ctl = ctl
  }
  enqueue(chunk: Uint8Array): void {
    this.ctl?.enqueue(chunk)
  }
  close(): void {
    try {
      this.ctl?.close()
    } catch {
      /* already closed */
    }
  }
}
