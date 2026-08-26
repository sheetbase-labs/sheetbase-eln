/**
 * Sheetbase collaboration type contract (COLLAB programme).
 *
 * Liveblocks is the realtime substrate for presence, comments and
 * notifications. PostgreSQL remains authoritative for all scientific state:
 * records, blocks, sheet instances, datasets, revisions, evidence and
 * permissions. Nothing in this file stores canonical scientific content in
 * Liveblocks — threads carry only stable identity anchors, never values.
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

// ---------------------------------------------------------------------------
// Thread anchors (COLLAB-02)
// ---------------------------------------------------------------------------

/**
 * Anchor kinds. Every anchor addresses a durable Sheetbase identity — stable
 * UUIDs / content-derived row keys — never visible row numbers, column labels
 * or DOM coordinates. `ThreadMetadata` must be flat JSON scalars, so anchors
 * flatten into individual fields (see ThreadAnchorMetadata).
 */
export type ThreadAnchorType =
  // Record-level discussion thread.
  | 'record'
  // One Notebook block by its stable UUID (survives reorder).
  | 'notebook-block'
  // Dataset-level thread.
  | 'dataset'
  // Dataset row by stable row UUID.
  | 'dataset-row'
  // Dataset field by stable field UUID (schema-versioned).
  | 'dataset-field'
  // Row + field cell where meaningful.
  | 'dataset-cell'

/** Typed anchor used by application code. */
export type ThreadAnchor =
  | { anchorType: 'record'; workspaceId: string; recordId: string }
  | {
      anchorType: 'notebook-block'
      workspaceId: string
      recordId: string
      blockId: string
    }
  | { anchorType: 'dataset'; workspaceId: string; datasetId: string }
  | {
      anchorType: 'dataset-row'
      workspaceId: string
      datasetId: string
      rowId: string
    }
  | {
      anchorType: 'dataset-field'
      workspaceId: string
      datasetId: string
      fieldId: string
    }
  | {
      anchorType: 'dataset-cell'
      workspaceId: string
      datasetId: string
      rowId: string
      fieldId: string
    }

/**
 * Flat scalar metadata stored on each Liveblocks thread. Liveblocks requires
 * a scalar index signature; optional anchor fields are simply absent keys.
 * `objectId` repeats the room object id so filtering by object never needs
 * room-id parsing.
 */
export interface ThreadAnchorMetadata {
  anchorType: ThreadAnchorType
  workspaceId: string
  objectId: string
  [key: string]: string
}
