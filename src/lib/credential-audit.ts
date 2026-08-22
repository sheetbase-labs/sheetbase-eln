/**
 * API-02 completion: credential lifecycle events in the workspace activity
 * stream (api.change_events).
 *
 * Writes go through internal.emit_change_event_as_actor, the SECURITY
 * DEFINER emitter used by trusted server-side paths. It allocates the
 * per-workspace gapless sequence, validates that the acting user exists and
 * NOTIFYs sheetbase_change so live subscribers refetch. The application
 * connection is the only caller outside SQL; EXECUTE stays revoked from
 * every PostgREST request role, so clients can neither forge events nor
 * allocate sequences.
 *
 * Payloads carry display metadata only — never secret material.
 *
 * Uses raw pg query to avoid drizzle-orm sql template issues with
 * SECURITY DEFINER function calls (same pattern as formula_write.server.ts).
 */
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { Pool } from 'pg'

import type * as schema from '#/db/schema'

export type CredentialAuditOperation = 'create' | 'revoke'

export interface CredentialAuditInput {
  /** The owner who performed the mutation; becomes actor_user_id. */
  actorUserId: string
  workspaceId: string
  credentialId: string
  operation: CredentialAuditOperation
  payload: {
    name?: string
    displayPrefix?: string
    kind?: 'service' | 'personal'
    rotatedFromCredentialId?: string
    rotatedToCredentialId?: string
  }
}

export async function emitCredentialAuditEvent(
  db: NodePgDatabase<typeof schema>,
  input: CredentialAuditInput,
): Promise<void> {
  const pool = (db as unknown as { $client: Pool }).$client
  await pool.query(
    `SELECT internal.emit_change_event_as_actor($1::text, $2::uuid, 'api_credential', $3::uuid, $4::text, NULL::uuid, NULL::uuid, $5::jsonb)`,
    [
      input.actorUserId,
      input.workspaceId,
      input.credentialId,
      input.operation,
      JSON.stringify(input.payload),
    ],
  )
}
