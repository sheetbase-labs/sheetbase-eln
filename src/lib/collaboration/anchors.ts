/**
 * Thread anchor model (COLLAB-02). Anchors are durable Sheetbase identities:
 * block UUIDs, content-derived sheet row keys, dataset row/field UUIDs. They
 * deliberately exclude visible row numbers, column labels, titles and DOM
 * coordinates so comments stay attached across reorder and rename.
 *
 * Liveblocks `ThreadMetadata` must be a flat record of JSON scalars, so the
 * typed anchors here flatten into `ThreadAnchorMetadata` for storage and
 * rehydrate back into typed anchors for rendering.
 */

import { z } from 'zod'

import type {
  CollaborationObjectKind,
  CollaborationRoomId,
  ThreadAnchor,
  ThreadAnchorMetadata,
  ThreadAnchorType,
} from '#/lib/collaboration/types'
import { buildRoomId } from '#/lib/collaboration/room-ids'

const uuid = z.string().uuid()

/** Validates an untrusted metadata object as one of the known anchors. */
export const threadAnchorSchema = z.discriminatedUnion('anchorType', [
  z.object({
    anchorType: z.literal('record'),
    workspaceId: uuid,
    recordId: uuid,
  }),
  z.object({
    anchorType: z.literal('notebook-block'),
    workspaceId: uuid,
    recordId: uuid,
    blockId: uuid,
  }),
  z.object({
    anchorType: z.literal('dataset'),
    workspaceId: uuid,
    datasetId: uuid,
  }),
  z.object({
    anchorType: z.literal('dataset-row'),
    workspaceId: uuid,
    datasetId: uuid,
    rowId: uuid,
  }),
  z.object({
    anchorType: z.literal('dataset-field'),
    workspaceId: uuid,
    datasetId: uuid,
    fieldId: uuid,
  }),
  z.object({
    anchorType: z.literal('dataset-cell'),
    workspaceId: uuid,
    datasetId: uuid,
    rowId: uuid,
    fieldId: uuid,
  }),
])

/**
 * The room a thread lives in is derived from its anchor's object. Record and
 * notebook-block anchors share the record room; sheet cells/ranges the sheet
 * room; all dataset anchors the dataset room.
 */
export function anchorRoomId(anchor: ThreadAnchor): CollaborationRoomId {
  switch (anchor.anchorType) {
    case 'record':
    case 'notebook-block':
      return buildRoomId(anchor.workspaceId, 'record', anchor.recordId)
    case 'dataset':
    case 'dataset-row':
    case 'dataset-field':
    case 'dataset-cell':
      return buildRoomId(anchor.workspaceId, 'dataset', anchor.datasetId)
  }
}

export function anchorObjectKind(
  anchor: ThreadAnchor,
): CollaborationObjectKind {
  return (
    {
      record: 'record',
      'notebook-block': 'record',
      dataset: 'dataset',
      'dataset-row': 'dataset',
      'dataset-field': 'dataset',
      'dataset-cell': 'dataset',
    } as const
  )[anchor.anchorType]
}

/** Flattens a typed anchor into flat scalar thread metadata. */
export function anchorToMetadata(anchor: ThreadAnchor): ThreadAnchorMetadata {
  const base = {
    anchorType: anchor.anchorType satisfies ThreadAnchorType,
    workspaceId: anchor.workspaceId,
  }
  switch (anchor.anchorType) {
    case 'record':
      return { ...base, objectId: anchor.recordId, recordId: anchor.recordId }
    case 'notebook-block':
      return {
        ...base,
        objectId: anchor.recordId,
        recordId: anchor.recordId,
        blockId: anchor.blockId,
      }
    case 'dataset':
      return {
        ...base,
        objectId: anchor.datasetId,
        datasetId: anchor.datasetId,
      }
    case 'dataset-row':
      return {
        ...base,
        objectId: anchor.datasetId,
        datasetId: anchor.datasetId,
        rowId: anchor.rowId,
      }
    case 'dataset-field':
      return {
        ...base,
        objectId: anchor.datasetId,
        datasetId: anchor.datasetId,
        fieldId: anchor.fieldId,
      }
    case 'dataset-cell':
      return {
        ...base,
        objectId: anchor.datasetId,
        datasetId: anchor.datasetId,
        rowId: anchor.rowId,
        fieldId: anchor.fieldId,
      }
  }
}

/** Rehydrates a typed anchor from stored thread metadata; null if invalid. */
export function anchorFromMetadata(
  metadata: Record<string, unknown>,
): ThreadAnchor | null {
  const result = threadAnchorSchema.safeParse(metadata)
  return result.success ? result.data : null
}

/**
 * True when the thread belongs to the given room. Threads are created in the
 * room their anchor resolves to; this keeps filtering O(1) without parsing.
 */
export function anchorBelongsToRoom(
  anchor: ThreadAnchorMetadata,
  roomId: string,
): boolean {
  const parsed = threadAnchorSchema.safeParse(anchor)
  return parsed.success && anchorRoomId(parsed.data) === roomId
}
