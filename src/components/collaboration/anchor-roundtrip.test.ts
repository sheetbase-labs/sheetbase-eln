import { describe, expect, it } from 'vitest'

import {
  anchorFromMetadata,
  anchorRoomId,
  anchorToMetadata,
  threadAnchorSchema,
} from '#/lib/collaboration/anchors'
import type { ThreadAnchor } from '#/lib/collaboration/types'
import { buildRoomId } from '#/lib/collaboration/room-ids'

const WS = 'a0000000-0000-7000-8000-000000000001'
const RECORD = 'b0000000-0000-7000-8000-000000000002'
const BLOCK = 'c0000000-0000-7000-8000-000000000003'
const SHEET = 'd0000000-0000-7000-8000-000000000004'
const FIELD = 'e0000000-0000-7000-8000-000000000005'
const DATASET = 'f0000000-0000-7000-8000-000000000006'
const ROW = '1a000000-0000-7000-8000-000000000007'

const ALL_ANCHORS: ThreadAnchor[] = [
  { anchorType: 'record', workspaceId: WS, recordId: RECORD },
  {
    anchorType: 'notebook-block',
    workspaceId: WS,
    recordId: RECORD,
    blockId: BLOCK,
  },
  { anchorType: 'dataset', workspaceId: WS, datasetId: DATASET },
  {
    anchorType: 'dataset-row',
    workspaceId: WS,
    datasetId: DATASET,
    rowId: ROW,
  },
  {
    anchorType: 'dataset-field',
    workspaceId: WS,
    datasetId: DATASET,
    fieldId: FIELD,
  },
  {
    anchorType: 'dataset-cell',
    workspaceId: WS,
    datasetId: DATASET,
    rowId: ROW,
    fieldId: FIELD,
  },
]

describe('anchor round-trip (all supported anchor types)', () => {
  it.each(ALL_ANCHORS.map((anchor) => [anchor.anchorType, anchor] as const))(
    '%s survives metadata flattening unchanged',
    (_type, anchor) => {
      const metadata = anchorToMetadata(anchor)
      // Metadata must be flat scalars only — Liveblocks requires this.
      for (const [key, value] of Object.entries(metadata)) {
        expect(typeof key).toBe('string')
        expect(typeof value).toBe('string')
      }
      expect(anchorFromMetadata(metadata)).toEqual(anchor)
    },
  )

  it('keeps room identity stable through the round trip', () => {
    for (const anchor of ALL_ANCHORS) {
      const restored = anchorFromMetadata(anchorToMetadata(anchor))
      expect(restored).not.toBeNull()
      expect(anchorRoomId(restored!)).toBe(
        buildRoomId(
          anchor.workspaceId,
          // The object kind is implied by each anchor's object id.
          anchor.anchorType === 'record' ||
            anchor.anchorType === 'notebook-block'
            ? 'record'
            : 'dataset',
          anchorRoomId(anchor).split(':')[3],
        ),
      )
    }
  })

  it('rejects retired sheet-cell anchors entirely', () => {
    // Sheet cell anchoring returns only when the Sheet Instance model gains a
    // canonical per-row persisted identity; legacy scientific-table ids must
    // never validate.
    expect(
      threadAnchorSchema.safeParse({
        anchorType: 'sheet-cell',
        workspaceId: WS,
        sheetInstanceId: SHEET,
        rowKey: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
        fieldId: FIELD,
      }).success,
    ).toBe(false)
    expect(
      threadAnchorSchema.safeParse({
        anchorType: 'sheet-range',
        workspaceId: WS,
        sheetInstanceId: SHEET,
        startRowKey: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
        startFieldId: FIELD,
        endRowKey: '8c9e6679-7425-40de-944b-e07fc1f90ae8',
        endFieldId: FIELD,
      }).success,
    ).toBe(false)
  })
})

describe('anchorFromMetadata rejects malformed metadata', () => {
  const valid: ThreadAnchor = {
    anchorType: 'dataset-cell',
    workspaceId: WS,
    datasetId: DATASET,
    rowId: ROW,
    fieldId: FIELD,
  }

  it('accepts a fully valid metadata payload', () => {
    const metadata = anchorToMetadata(valid) as Record<string, unknown>
    expect(anchorFromMetadata(metadata)).toEqual(valid)
  })

  it('rejects missing fields and non-scalar values', () => {
    const metadata = anchorToMetadata(valid) as Record<string, unknown>
    delete metadata.rowId
    expect(anchorFromMetadata(metadata)).toBeNull()
    expect(
      threadAnchorSchema.safeParse({ ...metadata, rowId: 42 }).success,
    ).toBe(false)
    expect(anchorFromMetadata({})).toBeNull()
    expect(
      anchorFromMetadata({ anchorType: 'record', workspaceId: WS }),
    ).toBeNull()
  })

  it('rejects visual-coordinate substitutes for durable identities', () => {
    const metadata = anchorToMetadata(valid) as Record<string, unknown>
    // Smuggling a visual row index into an identity slot fails validation.
    metadata.rowId = ''
    expect(anchorFromMetadata(metadata)).toBeNull()
  })
})
