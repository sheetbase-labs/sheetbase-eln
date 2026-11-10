import { buildRoomId } from '#/lib/collaboration/room-ids'
import type { CollaborationObjectKind } from '#/lib/collaboration/types'

/** Invalid or absent canonical UUIDs mean no collaboration for this surface. */
export function safeBuildRoomId(
  workspaceId: string | null | undefined,
  kind: CollaborationObjectKind,
  objectId: string | null | undefined,
): string | null {
  if (!workspaceId || !objectId) return null

  try {
    return buildRoomId(workspaceId, kind, objectId)
  } catch {
    return null
  }
}
