/**
 * Room id construction and parsing. Room ids are derived deterministically
 * from canonical Sheetbase identities (workspace + object UUIDs); they are
 * the only bridge between co-editing rooms and PostgreSQL rows.
 */

import type {
  CollaborationObjectKind,
  CollaborationRoomId,
} from '#/lib/collaboration/types'

const ROOM_PREFIX = 'workspace'

/** Every room kind, so a path segment can be resolved back to its kind. */
const ROOM_KINDS = [
  'record',
  'sheet',
  'dataset',
] as const satisfies readonly CollaborationObjectKind[]

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

  // SAFETY: the prefix, a UUID checked above, one of the three literal kind segments and a second checked UUID are exactly the grammar `CollaborationRoomId` brands.
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

  const kind = ROOM_KINDS.find(
    (candidate) => ROOM_KIND_SEGMENTS[candidate] === segment,
  )

  if (kind === undefined || !uuid.test(workspaceId) || !uuid.test(objectId)) {
    return { ok: false }
  }

  return {
    ok: true,
    workspaceId: workspaceId,
    kind: kind,
    objectId: objectId,
  }
}
