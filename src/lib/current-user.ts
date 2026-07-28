/**
 * Server-side accessors for the signed-in context. Used by route loaders;
 * never import into client-only modules.
 */
import { eq } from 'drizzle-orm'

import { db } from '#/db/client.server'
import * as schema from '#/db/schema'
import { auth } from '#/lib/auth'

export interface CurrentContext {
  user: { id: string; name: string; email: string }
  workspace: { id: string; slug: string; name: string; role: string } | null
}

/** Returns the signed-in user and their active workspace, or null. */
export async function getCurrentContext(
  headers: Headers,
): Promise<CurrentContext | null> {
  const session = await auth.api.getSession({ headers })
  if (!session) return null

  const membership = await db.query.workspaceMemberships.findFirst({
    where: eq(schema.workspaceMemberships.userId, session.user.id),
    with: { workspace: true },
  })

  return {
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
    },
    workspace: membership
      ? {
          id: membership.workspace.id,
          slug: membership.workspace.slug,
          name: membership.workspace.name,
          role: membership.role,
        }
      : null,
  }
}
