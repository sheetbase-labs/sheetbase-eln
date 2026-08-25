/**
 * Room id construction and parsing. Room ids are derived deterministically
 * from canonical Sheetbase identities (workspace + object UUIDs); they are
 * the only bridge between Liveblocks rooms and PostgreSQL rows.
 */

import type {
  CollaborationObjectKind,
  CollaborationRoomId,
} from '#/lib/collaboration/types'

const ROOM_PREFIX = 'workspace'

/** Object path segment per room kind. */
export const ROOM_KIND_SEGMENTS = {
  record: 'record',
  sheet: 'sheet',
  dataset: 'dataset',
} as const satisfies Record<CollaborationObjectKind, string>

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function buildRoomId(
  workspaceId: string,
  kind: CollaborationObjectKind,
  objectId: string,
): CollaborationRoomId {
  if (!uuid.test(workspaceId) || !uuid.test(objectId)) {
    throw new Error('Room ids are built from canonical UUIDs only')
  }
  return `${ROOM_PREFIX}:${workspaceId}:${ROOM_KIND_SEGMENTS[kind]}:${objectId}` as CollaborationRoomId
}

export type ParsedRoomId =
  | {
      ok: true
      workspaceId: string
      kind: CollaborationObjectKind
      objectId: string
    }
  | { ok: false }

/** Parses `workspace:<ws>:record|sheet|dataset:<id>`; rejects everything else. */
export function parseRoomId(room: string): ParsedRoomId {
  const parts = room.split(':')
  if (parts.length !== 4 || parts[0] !== ROOM_PREFIX) return { ok: false }
  const [, workspaceId, segment, objectId] = parts
  const entry = (
    Object.entries(ROOM_KIND_SEGMENTS) as Array<
      [CollaborationObjectKind, string]
    >
  ).find(([, seg]) => seg === segment)
  if (!entry || !uuid.test(workspaceId) || !uuid.test(objectId)) {
    return { ok: false }
  }
  return {
    ok: true,
    workspaceId: workspaceId,
    kind: entry[0],
    objectId: objectId,
  }
}
