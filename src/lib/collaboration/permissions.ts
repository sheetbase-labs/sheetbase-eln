/**
 * Workspace-role ceiling for collaboration grants. access.server.ts also
 * intersects these scopes with current canonical object authority/lifecycle.
 * This mapping alone never authorizes a room.
 *
 * Matrix (docs/subsystems/collaboration.md is normative):
 *
 * | role                          | connect | see presence | edit together         |
 * |-------------------------------|---------|--------------|-----------------------|
 * | owner/admin/member/steward/   | yes     | yes          | yes                   |
 * | scientist/analyst/reviewer    |         |              |                       |
 * | viewer                        | yes     | yes          | no (GOV-01 read-only) |
 * | suspended / non-member        | no      | no           | no                    |
 * | workspace not active          | no      | no           | no                    |
 *
 * A room grants one of two things: `room:read` (see who is here and what they
 * are doing) or `room:write` (also send document changes). The bundled
 * collaboration server enforces it per connection.
 */

/** What a connection may do in a room. */
export type RoomScope = 'room:read' | 'room:write'

export type RoomPermissions = readonly RoomScope[]

export type WorkspaceRole =
  | 'owner'
  | 'admin'
  | 'member'
  | 'steward'
  | 'scientist'
  | 'analyst'
  | 'reviewer'
  | 'viewer'

/** Roles allowed to write domain data; `viewer` is read-only (GOV-01). */
const WRITER_ROLES: ReadonlySet<string> = new Set([
  'owner',
  'admin',
  'member',
  'steward',
  'scientist',
  'analyst',
  'reviewer',
])

/**
 * Canonical object lifecycle state derived from PostgreSQL during room
 * access resolution. `read_only` covers archived records/instances/datasets
 * and locked (signed) records; deleted objects are denied outright.
 */
export type ObjectAccessState = 'writable' | 'read_only'

export const READ_ONLY_ROOM_SCOPES: RoomPermissions = ['room:read']

/**
 * Scopes for a room grant: the intersection of workspace-role
 * capability and object lifecycle state. An archived or locked object grants
 * read-only collaboration scopes regardless of writer membership; viewers
 * never exceed read-only even on writable objects.
 */
export function roomPermissionsForRole(
  role: string,
  objectState: ObjectAccessState = 'writable',
): RoomPermissions {
  if (objectState === 'read_only') {
    return READ_ONLY_ROOM_SCOPES
  }

  if (role === 'viewer') {
    return READ_ONLY_ROOM_SCOPES
  }

  if (!WRITER_ROLES.has(role)) return []

  return ['room:write']
}

export interface CollaborationMembership {
  role: string
  suspendedAt: Date | null
}

export type CollaborationAccessResult =
  | { ok: true; permissions: RoomPermissions; role: string }
  | { ok: false; reason: 'no_membership' | 'suspended' | 'unknown_role' }

/** Maps an active membership to room scopes; denies suspended members. */
export function accessForMembership(
  membership: CollaborationMembership | null,
): CollaborationAccessResult {
  if (!membership) return { ok: false, reason: 'no_membership' }

  if (membership.suspendedAt) return { ok: false, reason: 'suspended' }
  const permissions = roomPermissionsForRole(membership.role)

  if (permissions.length === 0) {
    return { ok: false, reason: 'unknown_role' }
  }

  return { ok: true, permissions, role: membership.role }
}

/** Client-facing capability hint mirroring the server scopes above. */
export function canCommentInRoom(role: string): boolean {
  return WRITER_ROLES.has(role)
}

/** True when the grant lets a connection send document changes. */
export function canWriteInRoom(permissions: RoomPermissions): boolean {
  return permissions.includes('room:write')
}
