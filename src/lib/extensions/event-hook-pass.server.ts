/**
 * Runs plugin reactions on their own schedule. Webhooks are only worked out
 * for workspaces that have one, so reactions keep a cursor per workspace and
 * read the change log themselves (migration plugin_hook_cursor).
 */
import { PooledClient } from '#/db/pool.server'
import { env } from '#/env.server'
import { mapEventType, buildEventPayload } from '#/lib/webhook-events'
import type { ChangeEventInput } from '#/lib/webhook-events'

const BATCH = 200

/** Reads new events for every workspace with a reaction switched on. Returns how many it looked at. */
export async function runEventHookPass(
  connectionString: string = env.DATABASE_URL,
): Promise<number> {
  const client = new PooledClient({ connectionString })
  await client.connect()
  let seen = 0
  try {
    const { rows: workspaces } = await client.query(
      `SELECT DISTINCT workspace_id FROM api.extensions
        WHERE status = 'enabled'
          AND jsonb_array_length(COALESCE(manifest -> 'contributions' -> 'event-hooks', '[]'::jsonb)) > 0`,
    )
    // The plugin runtime is only loaded once a workspace has a reaction on, so
    // a lab without one never pays for it when the server starts.
    const { runEventHooks } =
      workspaces.length > 0
        ? await import('./event-hooks.server')
        : { runEventHooks: async () => undefined }
    for (const { workspace_id: workspaceId } of workspaces) {
      const cursor = await client.query(
        `SELECT sequence FROM internal.plugin_hook_cursor WHERE workspace_id = $1`,
        [workspaceId],
      )
      if (cursor.rows.length === 0) {
        await client.query(
          `INSERT INTO internal.plugin_hook_cursor (workspace_id, sequence)
           SELECT $1::uuid, COALESCE(max(sequence), 0)
             FROM api.change_events WHERE workspace_id = $1::uuid
           ON CONFLICT DO NOTHING`,
          [workspaceId],
        )
        continue
      }
      const { rows } = await client.query(
        `SELECT id, workspace_id, sequence, entity_type, entity_uuid, operation,
                record_id, project_id, actor_user_id, actor_credential_id,
                client_id, payload, created_at::text
           FROM api.change_events
          WHERE workspace_id = $1 AND sequence > $2::bigint
          ORDER BY sequence ASC
          LIMIT ${BATCH}`,
        [workspaceId, cursor.rows[0].sequence],
      )
      for (const row of rows) {
        seen += 1
        const event: ChangeEventInput = {
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
        const name = mapEventType(
          event.entityType,
          event.operation,
          event.payload,
        )
        if (!name) continue
        await runEventHooks({
          id: event.id,
          workspaceId: event.workspaceId,
          actorUserId: event.actorUserId,
          recordId: event.recordId,
          entityType: event.entityType,
          entityId: event.entityUuid,
          name,
          data: buildEventPayload(event, name),
        })
      }
      if (rows.length > 0)
        await client.query(
          `UPDATE internal.plugin_hook_cursor
              SET sequence = $2::bigint, updated_at = now()
            WHERE workspace_id = $1`,
          [workspaceId, rows[rows.length - 1].sequence],
        )
    }
  } finally {
    await client.end()
  }
  return seen
}
