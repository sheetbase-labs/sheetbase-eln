/**
 * Workspace bootstrap. Every successful sign-up gets a personal workspace
 * with an owner membership (decision record 0004). The same function backs
 * the automatic database hook and the manual recovery action, so a partially
 * failed first attempt can be retried safely.
 */
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { eq, sql } from 'drizzle-orm'

import * as schema from '#/db/schema'

type Db = NodePgDatabase<typeof schema>

interface BootstrapUser {
  id: string
  name: string
}

export function workspaceSlugForUser(userId: string): string {
  return `ws-${userId}`
}

/**
 * Adds a new sign-up to the workspace that claims their verified email domain
 * (Settings → Members and roles → Let colleagues join). Returns that workspace,
 * or null when none does, so the caller falls back to a personal one. The
 * database holds the rules: the address must be verified, and a person already
 * suspended from the workspace stays suspended.
 */
export async function joinWorkspaceByEmailDomain(
  db: Db,
  userId: string,
): Promise<string | null> {
  const result = await db.execute<{ id: string | null }>(
    sql`select internal.join_workspace_by_email_domain(${userId}) as id`,
  )
  return result.rows[0]?.id ?? null
}

/**
 * Creates the user's initial workspace and owner membership in one
 * transaction. Idempotent: a user who already has a membership is left
 * untouched, so repeat callbacks and retries never duplicate rows.
 */
export async function bootstrapWorkspaceForUser(
  db: Db,
  user: BootstrapUser,
): Promise<{ workspaceId: string; created: boolean }> {
  return await db.transaction(async (tx) => {
    const existing = await tx.query.workspaceMemberships.findFirst({
      where: eq(schema.workspaceMemberships.userId, user.id),
    })
    if (existing) {
      return { workspaceId: existing.workspaceId, created: false }
    }

    const inserted = await tx
      .insert(schema.workspaces)
      .values({
        slug: workspaceSlugForUser(user.id),
        name: `${user.name}'s workspace`,
      })
      .onConflictDoNothing({ target: schema.workspaces.slug })
      .returning({ id: schema.workspaces.id })

    // onConflictDoNothing returns no row when the slug already exists; the
    // type signature does not admit that, so check the length explicitly.
    const workspaceId =
      inserted.length > 0
        ? inserted[0].id
        : (
            await tx.query.workspaces.findFirst({
              where: eq(schema.workspaces.slug, workspaceSlugForUser(user.id)),
            })
          )?.id

    if (!workspaceId) {
      throw new Error('workspace bootstrap failed to establish a workspace')
    }

    await tx
      .insert(schema.workspaceMemberships)
      .values({ workspaceId, userId: user.id, role: 'owner' })
      .onConflictDoNothing({
        target: [
          schema.workspaceMemberships.workspaceId,
          schema.workspaceMemberships.userId,
        ],
      })

    return { workspaceId, created: true }
  })
}
