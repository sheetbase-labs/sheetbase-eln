/**
 * LIVE-002 real deps for the SSE handler: a bounded replay reader and a
 * Postgres LISTEN subscription against `api.change_events`. Server-only.
 *
 * `readEvents` queries durable events directly (the server is trusted; the
 * workspace filter is applied here, not via RLS) and maps the snake_case
 * rows to the camelCase `ChangeEventWire`.
 *
 * `subscribe` opens a dedicated `pg` connection, `LISTEN`s on the
 * `sheetbase_change` channel, and for each notification whose
 * `workspace_id` matches, fetches the full event row and calls `onEvent`.
 * The unsubscribe releases the listener and ends the connection.
 */
import { Client } from 'pg'

import { getPool } from '#/db/pool.server'
import { env } from '#/env.server'
import { logger } from '#/lib/logger'
import type {
  ChangeEventWire,
  ReplayResult,
  Unsubscribe,
} from '#/lib/sse-events'

export interface ChangeEventRow {
  id: string
  workspace_id: string
  sequence: string
  entity_type: string
  entity_uuid: string
  operation: string
  record_id: string | null
  project_id: string | null
  actor_user_id: string | null
  actor_credential_id: string | null
  client_id: string | null
  payload: Record<string, unknown>
  created_at: string
}

export function mapChangeEventRow(row: ChangeEventRow): ChangeEventWire {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    sequence: Number(row.sequence),
    entityType: row.entity_type,
    entityUuid: row.entity_uuid,
    operation: row.operation,
    recordId: row.record_id,
    projectId: row.project_id,
    actorUserId: row.actor_user_id,
    actorCredentialId: row.actor_credential_id,
    clientId: row.client_id,
    payload: row.payload,
    createdAt: row.created_at,
  }
}

/**
 * Read retained durable events for the workspace after `afterSeq`, bounded
 * to `limit`. `earliestAvailableSeq` is the minimum retained sequence (0
 * when none retained), which lets the handler detect a `Last-Event-ID`
 * pointing into cleaned-up history.
 */
export async function readChangeEvents(
  workspaceId: string,
  afterSeq: number,
  limit: number,
  connectionString: string = env.DATABASE_URL,
): Promise<ReplayResult> {
  const client = getPool(connectionString)
  {
    const rows = await client.query<ChangeEventRow>(
      `SELECT * FROM api.change_events
        WHERE workspace_id = $1 AND sequence > $2
        ORDER BY sequence ASC
        LIMIT $3`,
      [workspaceId, afterSeq, limit],
    )
    const minSeq = await client.query<{ min: string | null }>(
      `SELECT min(sequence)::text AS min FROM api.change_events WHERE workspace_id = $1`,
      [workspaceId],
    )
    const earliestAvailableSeq = minSeq.rows[0].min
      ? Number(minSeq.rows[0].min)
      : 0
    const events = rows.rows.map(mapChangeEventRow)
    // hasMore when we filled the limit and there is at least one more.
    const hasMore = events.length === limit
    return { events, hasMore, earliestAvailableSeq }
  }
}

/** The newest retained sequence for the workspace, or 0 when none. */
export async function latestChangeEventSequence(
  workspaceId: string,
  connectionString: string = env.DATABASE_URL,
): Promise<number> {
  const result = await getPool(connectionString).query<{ max: string | null }>(
    `SELECT max(sequence)::text AS max FROM api.change_events WHERE workspace_id = $1`,
    [workspaceId],
  )
  return result.rows[0].max ? Number(result.rows[0].max) : 0
}

interface NotificationPayload {
  workspace_id: string
  sequence: number
  id: string
  entity_type: string
  operation: string
}

/**
 * One LISTEN connection per database serves every open stream. Opening a
 * connection per tab used up the database's connection slots after a few
 * minutes of normal browsing.
 */
interface Listener {
  subscribers: Set<{
    workspaceId: string
    onEvent: (event: ChangeEventWire) => void
  }>
  client: Client | null
  connecting: Promise<void> | null
  retry: ReturnType<typeof setTimeout> | null
}

const listeners = new Map<string, Listener>()
const RECONNECT_DELAY_MS = 2_000

async function deliver(
  listener: Listener,
  connectionString: string,
  payload: NotificationPayload,
): Promise<void> {
  const interested = [...listener.subscribers].filter(
    (s) => s.workspaceId === payload.workspace_id,
  )
  if (interested.length === 0) return
  // Fetch the full durable row by id. The NOTIFY payload is intentionally a
  // lightweight pointer; the durable row is the source of truth.
  const { rows } = await getPool(connectionString).query<ChangeEventRow>(
    `SELECT * FROM api.change_events WHERE id = $1`,
    [payload.id],
  )
  if (!rows[0]) return
  const event = mapChangeEventRow(rows[0])
  for (const subscriber of interested) subscriber.onEvent(event)
}

function scheduleReconnect(listener: Listener, connectionString: string) {
  if (listener.retry || listener.subscribers.size === 0) return
  listener.retry = setTimeout(() => {
    listener.retry = null
    void ensureConnected(listener, connectionString).catch(() =>
      scheduleReconnect(listener, connectionString),
    )
  }, RECONNECT_DELAY_MS)
  listener.retry.unref()
}

function ensureConnected(
  listener: Listener,
  connectionString: string,
): Promise<void> {
  if (listener.client) return Promise.resolve()
  if (listener.connecting) return listener.connecting
  listener.connecting = (async () => {
    const client = new Client({ connectionString })
    client.on('notification', (msg) => {
      if (!msg.payload) return
      try {
        const payload = JSON.parse(msg.payload) as NotificationPayload
        void deliver(listener, connectionString, payload).catch((error) =>
          logger.warn('live event delivery failed', {
            message: error instanceof Error ? error.message : String(error),
          }),
        )
      } catch {
        /* malformed payload: ignore */
      }
    })
    const lost = () => {
      if (listener.client !== client) return
      listener.client = null
      client.removeAllListeners()
      client.on('error', () => {})
      client.end().catch(() => {})
      scheduleReconnect(listener, connectionString)
    }
    client.on('error', (error) => {
      logger.warn('live event connection error', { message: error.message })
      lost()
    })
    client.on('end', lost)
    try {
      await client.connect()
      await client.query('LISTEN sheetbase_change')
      listener.client = client
    } catch (error) {
      client.removeAllListeners()
      client.on('error', () => {})
      client.end().catch(() => {})
      throw error
    } finally {
      listener.connecting = null
    }
  })()
  return listener.connecting
}

/**
 * Subscribe to live change notifications for the workspace. Streams share one
 * LISTEN connection that reconnects by itself. Notifications whose
 * `workspace_id` does not match are ignored, so a shared channel never leaks
 * cross-workspace metadata to the callback.
 */
export async function subscribeToChangeEvents(
  workspaceId: string,
  onEvent: (event: ChangeEventWire) => void,
  connectionString: string = env.DATABASE_URL,
): Promise<Unsubscribe> {
  let listener = listeners.get(connectionString)
  if (!listener) {
    listener = {
      subscribers: new Set(),
      client: null,
      connecting: null,
      retry: null,
    }
    listeners.set(connectionString, listener)
  }
  const active = listener
  const subscriber = { workspaceId, onEvent }
  active.subscribers.add(subscriber)
  try {
    await ensureConnected(active, connectionString)
  } catch (error) {
    active.subscribers.delete(subscriber)
    throw error
  }

  return async () => {
    if (!active.subscribers.delete(subscriber)) return
    if (active.subscribers.size > 0) return
    if (active.retry) {
      clearTimeout(active.retry)
      active.retry = null
    }
    const client = active.client
    active.client = null
    listeners.delete(connectionString)
    if (client) {
      client.removeAllListeners()
      client.on('error', () => {})
      await client.end().catch(() => {})
    }
  }
}
