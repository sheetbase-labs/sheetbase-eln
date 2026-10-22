/**
 * Server-side collaboration access resolution (COLLAB). The single gate in
 * front of Liveblocks: every room-auth request is resolved against the
 * Better Auth session and current canonical object authority/lifecycle.
 * Client-supplied identity is never trusted.
 *
 * Deps are injectable so tests exercise the real decision logic against
 * stubbed stores (same pattern as request-auth.ts).
 */

import { and, eq } from 'drizzle-orm'

import { db } from '#/db/client.server'
import * as schema from '#/db/schema'
import { env } from '#/env.server'
import { getAppSession } from '#/lib/auth'
import { getScopedClient } from '#/lib/admin-platform'
import { parseRoomId } from '#/lib/collaboration/room-ids'
import {
  accessForMembership,
  roomPermissionsForRole,
} from '#/lib/collaboration/permissions'
import type { CollaborationAccessResult } from '#/lib/collaboration/permissions'

export interface CollaborationUserInfo {
  id: string
  name: string
  avatar: string | null
}

export type RoomAccessResolution =
  | {
      ok: true
      userId: string
      userInfo: CollaborationUserInfo
      permissions: CollaborationAccessResult & { ok: true }
      /** Lifecycle state of the object behind the room. */
      objectState: 'writable' | 'read_only'
    }
  | { ok: false; status: number; code: string; message: string }

export interface CollaborationAuthDeps {
  getSession: typeof getAppSession
  /** Active membership of the user in the given workspace, or null. */
  getMembership: (
    userId: string,
    workspaceId: string,
  ) => Promise<{ role: string; suspendedAt: Date | null } | null>
  /**
   * Current canonical authority intersected with lifecycle. No read access
   * means denied; lack of Edit or archived/locked state means read_only.
   */
  objectState: (
    kind: 'record' | 'sheet' | 'dataset',
    workspaceId: string,
    objectId: string,
    userId: string,
  ) => Promise<'writable' | 'read_only' | 'denied'>
  /** Stored profile image for a user, if any (never scientific content). */
  getUserAvatar: (userId: string) => Promise<string | null>
  /** Workspace lifecycle status, or null when it does not exist. */
  getWorkspaceStatus: (workspaceId: string) => Promise<string | null>
}

/** Real production deps: session + direct drizzle lookups. */
export const realCollaborationAuthDeps: CollaborationAuthDeps = {
  getSession: getAppSession,
  getMembership: async (userId, workspaceId) => {
    const row = await db.query.workspaceMemberships.findFirst({
      where: and(
        eq(schema.workspaceMemberships.userId, userId),
        eq(schema.workspaceMemberships.workspaceId, workspaceId),
      ),
    })
    return row ? { role: row.role, suspendedAt: row.suspendedAt } : null
  },
  objectState: collaborationObjectState,
  getWorkspaceStatus: async (workspaceId) => {
    const row = await db.query.workspaces.findFirst({
      where: eq(schema.workspaces.id, workspaceId),
      columns: { status: true },
    })
    return row?.status ?? null
  },
  getUserAvatar: lookupAvatar,
}

/** Shared by room grants, room resolution and mention eligibility. */
export async function collaborationObjectState(
  kind: 'record' | 'sheet' | 'dataset',
  workspaceId: string,
  objectId: string,
  userId: string,
): Promise<'writable' | 'read_only' | 'denied'> {
  const { client, release } = await getScopedClient(workspaceId, userId)
  try {
    const { rows } = await client.query<{ state: string }>(
      'select api.collaboration_object_state($1, $2) as state',
      [kind, objectId],
    )
    const state = rows[0]?.state
    return state === 'writable' || state === 'read_only' ? state : 'denied'
  } finally {
    await release()
  }
}

/** True when the Liveblocks substrate is configured at all. */
export function isCollaborationEnabled(): boolean {
  return Boolean(env.LIVEBLOCKS_SECRET_KEY)
}

/**
 * Full room-access pipeline for one POST /api/collaboration/auth request.
 * Denials carry the same status/code envelope as the /api/db boundary.
 */
export async function resolveRoomAccess(
  headers: Headers,
  room: unknown,
  deps: CollaborationAuthDeps = realCollaborationAuthDeps,
): Promise<RoomAccessResolution> {
  if (!isCollaborationEnabled()) {
    return {
      ok: false,
      status: 503,
      code: 'collaboration_disabled',
      message: 'Collaboration is not configured on this deployment.',
    }
  }
  if (typeof room !== 'string') {
    return {
      ok: false,
      status: 400,
      code: 'invalid_room',
      message: 'A room id string is required.',
    }
  }

  const parsed = parseRoomId(room)
  if (!parsed.ok) {
    return {
      ok: false,
      status: 403,
      code: 'invalid_room',
      message: 'Unknown room.',
    }
  }

  const session = await deps.getSession(headers)
  if (!session) {
    return {
      ok: false,
      status: 401,
      code: 'unauthenticated',
      message: 'Sign in to collaborate.',
    }
  }
  const workspaceStatus = await deps.getWorkspaceStatus(parsed.workspaceId)
  if (workspaceStatus !== 'active') {
    return {
      ok: false,
      status: 403,
      code: 'forbidden',
      message: 'This workspace is not active.',
    }
  }

  // Re-evaluate current authority on every grant; never cache this decision.
  const state = await deps.objectState(
    parsed.kind,
    parsed.workspaceId,
    parsed.objectId,
    session.user.id,
  )
  if (state === 'denied') {
    return {
      ok: false,
      status: 403,
      code: 'forbidden',
      message: 'No access to this object.',
    }
  }

  const membership = await deps.getMembership(
    session.user.id,
    parsed.workspaceId,
  )
  const access = accessForMembership(membership)
  if (!access.ok) {
    return {
      ok: false,
      status: 403,
      code:
        access.reason === 'suspended' ? 'membership_suspended' : 'forbidden',
      message:
        access.reason === 'suspended'
          ? 'This membership is suspended.'
          : 'No access to this workspace.',
    }
  }

  // Final grant = role capability x object lifecycle. Archived/locked
  // objects force read-only scopes even for full writers.
  const permissions =
    state === 'read_only'
      ? roomPermissionsForRole('viewer', 'read_only')
      : access.permissions

  return {
    ok: true,
    userId: session.user.id,
    userInfo: {
      id: session.user.id,
      name: session.user.name,
      // GitHub avatars only; never scientific content.
      avatar: await deps.getUserAvatar(session.user.id),
    },
    objectState: state,
    permissions: { ...access, permissions },
  }
}

/** Resolves the stored profile image for a user, if any. */
async function lookupAvatar(userId: string): Promise<string | null> {
  const row = await db.query.user.findFirst({
    where: eq(schema.user.id, userId),
    columns: { image: true },
  })
  return row?.image ?? null
}
