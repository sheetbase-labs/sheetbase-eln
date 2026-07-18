/**
 * Server-side accessors for the current signed-in context. Used by route
 * loaders; never import into client-only modules.
 */
import { drizzle } from 'drizzle-orm/node-postgres'
import { eq } from 'drizzle-orm'

import * as schema from '#/db/schema'
import { env } from '#/env.server'
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

  const db = drizzle(env.DATABASE_URL, { schema })
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
