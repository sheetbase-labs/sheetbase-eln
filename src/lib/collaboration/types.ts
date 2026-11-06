/**
 * Sheetbase collaboration type contract (COLLAB programme).
 *
 * The bundled co-editing server is the realtime substrate for presence and
 * live editing. PostgreSQL remains authoritative for all scientific state:
 * records, blocks, sheet instances, datasets, revisions, evidence and
 * permissions. Nothing in a room is canonical: it is a relay that exists
 * only while people are connected.
 */

// ---------------------------------------------------------------------------
// Room identity
// ---------------------------------------------------------------------------

/** The canonical object class a room hangs off. */
export type CollaborationObjectKind = 'record' | 'sheet' | 'dataset'

/**
 * Deterministic room id derived from canonical Sheetbase identities. Never
 * built from display names or titles, and never carrying scientific content:
 *
 *   workspace:<workspaceId>:record:<recordId>
 *   workspace:<workspaceId>:sheet:<sheetInstanceId>
 *   workspace:<workspaceId>:dataset:<datasetId>
 */
export type CollaborationRoomId = string & { __brand: 'CollaborationRoomId' }

// ---------------------------------------------------------------------------
// User metadata
// ---------------------------------------------------------------------------

export interface CollaborationUserMeta {
  id: string
  info: {
    name: string
    avatar?: string
  }
}

// ---------------------------------------------------------------------------
// Presence (COLLAB-01) — ephemeral awareness only, never authoritative
// ---------------------------------------------------------------------------

/**
 * Ephemeral selection awareness. Keys are whatever stable identities the
 * surface already has (dataset row UUIDs, notebook block ids); sheet surfaces
 * stay passive until the Sheet Instance model grows a canonical per-row
 * identity.
 */
export interface PresenceSelection {
  /** Stable row identity of the surface (e.g. dataset row UUID). */
  rowKey?: string
  fieldId?: string
  endRowKey?: string
  endFieldId?: string
}

export interface ActiveObjectRef {
  type: CollaborationObjectKind
  id: string
}

export interface CollaborationPresence {
  activeObject?: ActiveObjectRef
  activeBlockId?: string | null
  activeFieldId?: string | null
  selection?: PresenceSelection | null
  mode?: 'viewing' | 'editing'
}
