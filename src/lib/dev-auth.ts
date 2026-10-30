import { and, eq, isNull } from 'drizzle-orm'

import { db } from '#/db/client.server'
import {
  session,
  user,
  userPreferences,
  workspaceMemberships,
} from '#/db/schema'
import { pickActiveMembership } from '#/lib/active-membership'
import { env } from '#/env.server'
import { parseViewAsCookie, personaSessionId } from '#/lib/demo-persona'
import {
  DEFAULT_DEV_USER_EMAIL,
  DEV_SESSION_ID,
  DEV_USER_NAME,
  devUserEmail,
} from '#/lib/dev-identity'

/** Stable identity used by the disposable auth-free development environment. */
export { DEV_SESSION_ID }
export { DEFAULT_DEV_USER_EMAIL as DEV_USER_EMAIL, DEV_USER_NAME }

export interface AppSession {
  user: {
    id: string
    name: string
    email: string
  }
  session: {
    id: string
  }
}

/**
 * Auth-free access is deliberately opt-in for the disposable development
 * surface. The deployment validator rejects this flag outside development
 * as a second boundary against accidentally publishing an open environment.
 */
export function isDevAuthFreeEnabled(): boolean {
  return env.SHEETBASE_ENV === 'development' && env.SHEETBASE_DEV_AUTH_FREE
}

/**
 * The name and email of the configured development identity. The app chrome and
 * the data-driven surfaces must name the same person the same way, so read the
 * name from the same `internal.user` row the RPCs resolve; an identity with no
 * row keeps the documented placeholder.
 */
async function devIdentity(
  userId: string,
): Promise<{ name: string; email: string }> {
  const row = await db.query.user.findFirst({
    where: eq(user.id, userId),
    columns: { name: true, email: true },
  })
  return {
    name: row?.name.trim() || DEV_USER_NAME,
    email: row?.email || devUserEmail(userId),
  }
}

/**
 * The workspace the demo opens in: the configured identity's active one. Every
 * person viewed-as stays in it, so switching changes who is acting, not where.
 */
async function demoWorkspaceId(): Promise<string | null> {
  const id = env.SHEETBASE_DEV_USER_ID
  const [preference, memberships] = await Promise.all([
    db.query.userPreferences.findFirst({
      where: eq(userPreferences.userId, id),
    }),
    db
      .select()
      .from(workspaceMemberships)
      .where(eq(workspaceMemberships.userId, id)),
  ])
  return (
    pickActiveMembership(memberships, preference?.activeWorkspaceId)
      ?.workspaceId ?? null
  )
}

/**
 * The person the demo is being viewed as: the one chosen in the account menu
 * (a cookie), provided they belong to the demo workspace. Anything else,
 * including a stale or hand-edited cookie, falls back to the configured
 * identity.
 */
async function resolveViewAs(
  headers: Headers | undefined,
): Promise<{ userId: string; workspaceId: string } | null> {
  const chosen = parseViewAsCookie(headers?.get('cookie'))
  if (!chosen || chosen === env.SHEETBASE_DEV_USER_ID) return null
  const workspaceId = await demoWorkspaceId()
  if (!workspaceId) return null
  const member = await db
    .select({ id: workspaceMemberships.userId })
    .from(workspaceMemberships)
    .where(
      and(
        eq(workspaceMemberships.workspaceId, workspaceId),
        eq(workspaceMemberships.userId, chosen),
        isNull(workspaceMemberships.suspendedAt),
      ),
    )
    .limit(1)
  return member.length > 0 ? { userId: chosen, workspaceId } : null
}

/** Sessions already written this process, so a switch costs one insert. */
const personaSessions = new Set<string>()

/**
 * Signing and certification look the caller's session up by id and require it
 * to belong to them, so each person viewed-as needs a session row of their own.
 * The first time, they are also pointed at the demo workspace, since someone
 * with several would otherwise land in their own first one.
 */
async function ensurePersonaSession(
  userId: string,
  workspaceId: string,
): Promise<string> {
  const id = personaSessionId(userId)
  if (personaSessions.has(id)) return id
  const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
  await db
    .insert(session)
    .values({ id, token: `${id}-token`, userId, expiresAt })
    .onConflictDoUpdate({
      target: session.id,
      set: { userId, expiresAt, updatedAt: new Date() },
    })
  await db
    .insert(userPreferences)
    .values({ userId, activeWorkspaceId: workspaceId })
    .onConflictDoUpdate({
      target: userPreferences.userId,
      set: { activeWorkspaceId: workspaceId, updatedAt: new Date() },
    })
  personaSessions.add(id)
  return id
}

export async function getDevSession(headers?: Headers): Promise<AppSession> {
  const viewAs = await resolveViewAs(headers)
  const id = viewAs?.userId ?? env.SHEETBASE_DEV_USER_ID
  return {
    user: { id, ...(await devIdentity(id)) },
    session: {
      id: viewAs
        ? await ensurePersonaSession(viewAs.userId, viewAs.workspaceId)
        : DEV_SESSION_ID,
    },
  }
}
