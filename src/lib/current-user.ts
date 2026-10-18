/**
 * Server-side accessors for the signed-in context. Used by route loaders;
 * never import into client-only modules.
 */
import { and, eq, inArray } from 'drizzle-orm'

import { db } from '#/db/client.server'
import * as schema from '#/db/schema'
import { pickActiveMembership } from '#/lib/active-membership'
import { getAppSession } from '#/lib/auth'
import { isCollaborationEnabled } from '#/lib/collaboration/access.server'

export interface CurrentContext {
  user: { id: string; name: string; email: string }
  workspace: {
    id: string
    slug: string
    name: string
    role: string
    /** The membership is suspended: the database treats the person as a non-member. */
    suspended?: boolean
  } | null
  /**
   * When the active membership is suspended: the people who can reinstate it
   * (active owners and administrators of that workspace).
   */
  accessContacts?: Array<{ name: string; email: string; role: string }>
  /** Every workspace the user is a member of (SHELL-01.4 switcher). */
  workspaces: Array<{
    id: string
    slug: string
    name: string
    role: string
    suspended?: boolean
  }>
  /** COLLAB: Liveblocks substrate configured on this deployment? */
  collaborationEnabled: boolean
}

/** Active owners and administrators of a workspace: who can reinstate someone. */
export async function listAccessContacts(
  workspaceId: string,
): Promise<NonNullable<CurrentContext['accessContacts']>> {
  const rows = await db
    .select({
      name: schema.user.name,
      email: schema.user.email,
      role: schema.workspaceMemberships.role,
      suspendedAt: schema.workspaceMemberships.suspendedAt,
    })
    .from(schema.workspaceMemberships)
    .innerJoin(
      schema.user,
      eq(schema.user.id, schema.workspaceMemberships.userId),
    )
    .where(
      and(
        eq(schema.workspaceMemberships.workspaceId, workspaceId),
        inArray(schema.workspaceMemberships.role, ['owner', 'admin']),
      ),
    )
  return rows
    .filter((row) => !row.suspendedAt)
    .map(({ name, email, role }) => ({ name, email, role }))
}

/** Returns the signed-in user and their active workspace, or null. */
export async function getCurrentContext(
  headers: Headers,
): Promise<CurrentContext | null> {
  const session = await getAppSession(headers)
  if (!session) return null

  const [preference, memberships] = await Promise.all([
    db.query.userPreferences.findFirst({
      where: eq(schema.userPreferences.userId, session.user.id),
    }),
    db.query.workspaceMemberships.findMany({
      where: eq(schema.workspaceMemberships.userId, session.user.id),
      with: { workspace: true },
    }),
  ])

  // SHELL-01.4: honour the user's chosen workspace while they are still a
  // member; otherwise fall back to their first membership.
  const membership = pickActiveMembership(
    memberships,
    preference?.activeWorkspaceId,
  )
  const suspended = Boolean(membership?.suspendedAt)
  const accessContacts =
    membership && suspended
      ? await listAccessContacts(membership.workspaceId)
      : []

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
          suspended,
        }
      : null,
    accessContacts,
    workspaces: memberships.map((item) => ({
      id: item.workspace.id,
      slug: item.workspace.slug,
      name: item.workspace.name,
      role: item.role,
      suspended: Boolean(item.suspendedAt),
    })),
    collaborationEnabled: isCollaborationEnabled(),
  }
}

/**
 * Resolve a set of user IDs to { id → name } for display. Queries
 * `internal.user` (not PostgREST-exposed) joined with workspace memberships.
 * Returns only the names that exist; missing IDs are omitted so callers can
 * fall back to a short-id slice.
 */
export async function resolveUserNames(
  userIds: string[],
): Promise<Record<string, string>> {
  if (userIds.length === 0) return {}
  const uniqueIds = [...new Set(userIds)].filter(Boolean)
  if (uniqueIds.length === 0) return {}
  const rows = await db
    .select({ id: schema.user.id, name: schema.user.name })
    .from(schema.user)
    .where(inArray(schema.user.id, uniqueIds))
  const map: Record<string, string> = {}
  for (const r of rows) map[r.id] = r.name
  return map
}
