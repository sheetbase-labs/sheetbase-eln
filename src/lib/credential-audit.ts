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
 * Runs on whichever client it is given: callers pass the transaction that
 * performs the credential mutation, so an event can never be committed
 * without its mutation nor a mutation land without its event.
 *
 * Payloads carry display metadata only — never secret material.
 */
import { sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

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
  await db.execute(sql`
    SELECT internal.emit_change_event_as_actor(
      ${input.actorUserId}::text,
      ${input.workspaceId}::uuid,
      'api_credential',
      ${input.credentialId}::uuid,
      ${input.operation}::text,
      NULL::uuid,
      NULL::uuid,
      ${JSON.stringify(input.payload)}::jsonb
    )
  `)
}
