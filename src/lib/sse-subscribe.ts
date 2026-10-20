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

import { env } from '#/env.server'
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
  const client = new Client({ connectionString })
  await client.connect()
  try {
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
  } finally {
    await client.end()
  }
}

/** The newest retained sequence for the workspace, or 0 when none. */
export async function latestChangeEventSequence(
  workspaceId: string,
  connectionString: string = env.DATABASE_URL,
): Promise<number> {
  const client = new Client({ connectionString })
  await client.connect()
  try {
    const result = await client.query<{ max: string | null }>(
      `SELECT max(sequence)::text AS max FROM api.change_events WHERE workspace_id = $1`,
      [workspaceId],
    )
    return result.rows[0].max ? Number(result.rows[0].max) : 0
  } finally {
    await client.end()
  }
}

interface NotificationPayload {
  workspace_id: string
  sequence: number
  id: string
  entity_type: string
  operation: string
}

/**
 * Subscribe to live change notifications for the workspace. Opens a
 * dedicated `pg` connection that stays alive until the returned
 * unsubscribe is called. Notifications whose `workspace_id` does not match
 * are ignored, so a shared channel never leaks cross-workspace metadata to
 * the callback.
 */
export async function subscribeToChangeEvents(
  workspaceId: string,
  onEvent: (event: ChangeEventWire) => void,
  connectionString: string = env.DATABASE_URL,
): Promise<Unsubscribe> {
  const client = new Client({ connectionString })
  await client.connect()
  let closed = false

  // Fetch the full durable row by id. The NOTIFY payload is intentionally a
  // lightweight pointer; the durable row is the source of truth.
  async function fetchAndDeliver(payload: NotificationPayload): Promise<void> {
    if (closed) return
    if (payload.workspace_id !== workspaceId) return
    const { rows } = await client.query<ChangeEventRow>(
      `SELECT * FROM api.change_events WHERE id = $1`,
      [payload.id],
    )
    if (rows[0]) {
      onEvent(mapChangeEventRow(rows[0]))
    }
  }

  client.on('notification', (msg) => {
    if (!msg.payload) return
    try {
      const payload = JSON.parse(msg.payload) as NotificationPayload
      void fetchAndDeliver(payload)
    } catch {
      /* malformed payload: ignore */
    }
  })

  await client.query('LISTEN sheetbase_change')

  return async () => {
    if (closed) return
    closed = true
    try {
      await client.query('UNLISTEN sheetbase_change')
    } catch {
      /* best effort */
    }
    try {
      await client.end()
    } catch {
      /* best effort */
    }
  }
}
