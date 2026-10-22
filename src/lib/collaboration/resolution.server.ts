/**
 * Server-side collaboration resolution (COLLAB). Powers the client-side
 * resolveUsers / resolveRoomsInfo / mention-suggestion callbacks. Every
 * lookup is permission-filtered: a caller only ever resolves users who share
 * a workspace with them, and rooms they can actually access.
 */

import { and, eq, inArray, isNull } from 'drizzle-orm'

import { db as database } from '#/db/client.server'
import * as schema from '#/db/schema'
import { collaborationObjectState } from '#/lib/collaboration/access.server'
import { parseRoomId } from '#/lib/collaboration/room-ids'
import { datasetPath, recordPath, sheetPath } from '#/lib/navigation'

/**
 * Resolves profile info for users who share at least one workspace membership
 * with the caller. Unknown or unrelated ids are omitted — never fabricated.
 */
export async function resolveUsersForCaller(
  callerId: string,
  userIds: string[],
): Promise<Array<{ id: string; name: string; avatar: string | null }>> {
  const unique = [...new Set(userIds)].filter(Boolean).slice(0, 100)
  if (unique.length === 0) return []

  const callerWorkspaces = await database
    .select({ workspaceId: schema.workspaceMemberships.workspaceId })
    .from(schema.workspaceMemberships)
    .where(
      and(
        eq(schema.workspaceMemberships.userId, callerId),
        isNull(schema.workspaceMemberships.suspendedAt),
      ),
    )
  const workspaceIds = callerWorkspaces.map((w) => w.workspaceId)
  if (workspaceIds.length === 0) return []

  const rows = await database
    .selectDistinct({
      id: schema.user.id,
      name: schema.user.name,
      image: schema.user.image,
    })
    .from(schema.workspaceMemberships)
    .innerJoin(
      schema.user,
      eq(schema.user.id, schema.workspaceMemberships.userId),
    )
    .where(
      and(
        inArray(schema.workspaceMemberships.userId, unique),
        inArray(schema.workspaceMemberships.workspaceId, workspaceIds),
      ),
    )

  // Stable order matching the request for predictable UI.
  const byId = new Map(rows.map((r) => [r.id, r]))
  return unique.flatMap((id) => {
    const row = byId.get(id)
    return row ? [{ id: row.id, name: row.name, avatar: row.image }] : []
  })
}

export interface CollaborationRoomInfo {
  id: string
  name: string
  url: string
}

interface RoomObjectInfo {
  name: string
  url: string
}

async function roomObjectInfo(
  kind: 'record' | 'sheet' | 'dataset',
  workspaceId: string,
  objectId: string,
): Promise<RoomObjectInfo | null> {
  switch (kind) {
    case 'record': {
      const row = await database.query.records.findFirst({
        where: and(
          eq(schema.records.id, objectId),
          eq(schema.records.workspaceId, workspaceId),
        ),
        columns: { identifier: true, title: true },
      })
      if (!row) return null
      return {
        name: `${row.identifier} · ${row.title}`,
        url: recordPath(objectId),
      }
    }
    case 'sheet': {
      const row = await database.query.sheetInstances.findFirst({
        where: and(
          eq(schema.sheetInstances.id, objectId),
          eq(schema.sheetInstances.workspaceId, workspaceId),
        ),
        columns: { name: true },
      })
      return row ? { name: row.name, url: sheetPath(objectId) } : null
    }
    case 'dataset': {
      const row = await database.query.datasets.findFirst({
        where: and(
          eq(schema.datasets.id, objectId),
          eq(schema.datasets.workspaceId, workspaceId),
        ),
        columns: { name: true },
      })
      return row ? { name: row.name, url: datasetPath(objectId) } : null
    }
  }
}

/**
 * Resolves room display info for rooms the caller can access. Rooms that do
 * not parse, belong to other workspaces, or sit in inactive workspaces are
 * skipped entirely so nothing leaks through the notification inbox.
 */
export async function resolveRoomsForCaller(
  callerId: string,
  roomIds: string[],
): Promise<CollaborationRoomInfo[]> {
  const unique = [...new Set(roomIds)].filter(Boolean).slice(0, 50)
  const results: CollaborationRoomInfo[] = []
  for (const roomId of unique) {
    const parsed = parseRoomId(roomId)
    if (!parsed.ok) continue
    if (
      (await collaborationObjectState(
        parsed.kind,
        parsed.workspaceId,
        parsed.objectId,
        callerId,
      )) === 'denied'
    )
      continue
    const info = await roomObjectInfo(
      parsed.kind,
      parsed.workspaceId,
      parsed.objectId,
    )
    if (info) results.push({ id: roomId, ...info })
  }
  return results
}

/**
 * Mention suggestions for one room: active members of the room's workspace,
 * filtered by the typed text on name prefix/substring, capped at 20.
 */
export async function mentionSuggestionsForRoom(
  callerId: string,
  room: string,
  text: string,
): Promise<string[]> {
  const parsed = parseRoomId(room)
  if (!parsed.ok) return []
  if (
    (await collaborationObjectState(
      parsed.kind,
      parsed.workspaceId,
      parsed.objectId,
      callerId,
    )) === 'denied'
  )
    return []

  const rows = await database
    .select({
      id: schema.user.id,
      name: schema.user.name,
      suspendedAt: schema.workspaceMemberships.suspendedAt,
    })
    .from(schema.workspaceMemberships)
    .innerJoin(
      schema.user,
      eq(schema.user.id, schema.workspaceMemberships.userId),
    )
    .where(eq(schema.workspaceMemberships.workspaceId, parsed.workspaceId))

  const query = text.trim().toLowerCase()
  const candidates = rows
    .filter((r) => !r.suspendedAt && r.id !== callerId)
    .filter((r) => (query ? r.name.toLowerCase().includes(query) : true))
  const suggestions: string[] = []
  for (const candidate of candidates) {
    if (
      (await collaborationObjectState(
        parsed.kind,
        parsed.workspaceId,
        parsed.objectId,
        candidate.id,
      )) !== 'denied'
    )
      suggestions.push(candidate.id)
    if (suggestions.length === 20) break
  }
  return suggestions
}
