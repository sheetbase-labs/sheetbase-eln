import { eq } from 'drizzle-orm'

import { db } from '#/db/client.server'
import * as schema from '#/db/schema'
import { env } from '#/env.server'
import { getAppSession } from '#/lib/auth'
import { verifyExternalCredential, readBearerToken } from '#/lib/external-token'
import { subscribeToChangeEvents } from '#/lib/sse-subscribe'
import type {
  EventStreamDeps,
  StreamCaller,
} from './event-stream-requests.server'
import type { StreamPage } from './event-stream'

/** A session, or a token with the admin:read scope (personal or service). */
export const eventStreamDeps: EventStreamDeps = {
  async authenticate(headers) {
    const session = await getAppSession(headers)
    if (session) {
      const membership = await db.query.workspaceMemberships.findFirst({
        where: eq(schema.workspaceMemberships.userId, session.user.id),
      })
      if (!membership) return null
      return {
        workspaceId: membership.workspaceId,
        claims: {
          sub: session.user.id,
          workspace_id: membership.workspaceId,
          role: 'authenticated',
        },
      } satisfies StreamCaller
    }
    const token = readBearerToken(headers)
    if (!token) return null
    try {
      const claims = await verifyExternalCredential(
        db,
        token,
        env.PGRST_JWT_SECRET,
      )
      if (!claims.scopes.includes('admin:read')) return 'forbidden'
      return {
        workspaceId: claims.workspace_id,
        claims:
          claims.role === 'authenticated'
            ? {
                sub: claims.sub,
                workspace_id: claims.workspace_id,
                role: 'authenticated',
              }
            : {
                workspace_id: claims.workspace_id,
                credential_id: claims.credential_id,
                role: 'api_client',
              },
      } satisfies StreamCaller
    } catch {
      return null
    }
  },
  async page(caller, after, limit, entityTypes): Promise<StreamPage> {
    const client = await db.$client.connect()
    try {
      await client.query('BEGIN')
      const role =
        caller.claims.role === 'api_client' ? 'api_client' : 'authenticated'
      await client.query(`SET LOCAL ROLE ${role}`)
      await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify(caller.claims),
      ])
      const { rows } = await client.query(
        `SELECT api.event_stream_page($1::bigint, $2::int, $3::text[]) AS page`,
        [after, limit, entityTypes.length ? [...entityTypes] : null],
      )
      await client.query('COMMIT')
      return rows[0].page as StreamPage
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      client.release()
    }
  },
  subscribe: (workspaceId, wake) =>
    subscribeToChangeEvents(workspaceId, () => wake()),
}
