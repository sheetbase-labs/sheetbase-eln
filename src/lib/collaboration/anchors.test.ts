import { describe, expect, it } from 'vitest'

import {
  anchorBelongsToRoom,
  anchorFromMetadata,
  anchorRoomId,
  anchorToMetadata,
  threadAnchorSchema,
} from './anchors'
import { buildRoomId, parseRoomId } from './room-ids'
import type { ThreadAnchor } from './types'

const WS = 'a0000000-0000-7000-8000-000000000001'
const RECORD = 'b0000000-0000-7000-8000-000000000002'
const BLOCK = 'c0000000-0000-7000-8000-000000000003'
const SHEET = 'd0000000-0000-7000-8000-000000000004'
const FIELD = 'e0000000-0000-7000-8000-000000000005'
const DATASET = 'f0000000-0000-7000-8000-000000000006'

describe('room ids', () => {
  it('builds deterministic room ids from canonical identities', () => {
    expect(buildRoomId(WS, 'record', RECORD)).toBe(
      `workspace:${WS}:record:${RECORD}`,
    )
    expect(buildRoomId(WS, 'sheet', SHEET)).toBe(
      `workspace:${WS}:sheet:${SHEET}`,
    )
  })

  it('round-trips through parse', () => {
    const parsed = parseRoomId(buildRoomId(WS, 'dataset', DATASET))
    expect(parsed).toEqual({
      ok: true,
      workspaceId: WS,
      kind: 'dataset',
      objectId: DATASET,
    })
  })

  it('rejects non-canonical rooms, wrong segments and non-uuid ids', () => {
    expect(parseRoomId('record:abc').ok).toBe(false)
    expect(parseRoomId(`workspace:${WS}:widget:${RECORD}`).ok).toBe(false)
    expect(parseRoomId(`workspace:not-a-uuid:record:${RECORD}`).ok).toBe(false)
    expect(parseRoomId(`workspace:${WS}:record:title-of-record`).ok).toBe(false)
    expect(parseRoomId('').ok).toBe(false)
  })

  it('refuses to build from display names', () => {
    expect(() => buildRoomId(WS, 'record', 'Experiment 42')).toThrow()
  })
})

describe('thread anchors', () => {
  const blockAnchor: ThreadAnchor = {
    anchorType: 'notebook-block',
    workspaceId: WS,
    recordId: RECORD,
    blockId: BLOCK,
  }

  it('maps every anchor onto its canonical object room', () => {
    expect(anchorRoomId(blockAnchor)).toBe(buildRoomId(WS, 'record', RECORD))
    expect(
      anchorRoomId({
        anchorType: 'dataset',
        workspaceId: WS,
        datasetId: DATASET,
      }),
    ).toBe(buildRoomId(WS, 'dataset', DATASET))
  })

  it('survives metadata flattening (reorder/rename safety)', () => {
    const metadata = anchorToMetadata(blockAnchor)
    expect(metadata).toEqual({
      anchorType: 'notebook-block',
      workspaceId: WS,
      objectId: RECORD,
      recordId: RECORD,
      blockId: BLOCK,
    })
    expect(anchorFromMetadata(metadata)).toEqual(blockAnchor)
  })

  it('rejects retired sheet-cell anchors outright', () => {
    // Sheet cell/range anchoring waits for a canonical per-row identity;
    // legacy scientific-table ids must never validate.
    const parsed = threadAnchorSchema.safeParse({
      anchorType: 'sheet-cell',
      workspaceId: WS,
      sheetInstanceId: SHEET,
      rowKey: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
      fieldId: FIELD,
    })
    expect(parsed.success).toBe(false)
  })

  it('rejects anchors with missing or malformed identities', () => {
    expect(
      threadAnchorSchema.safeParse({
        anchorType: 'notebook-block',
        workspaceId: WS,
        recordId: RECORD,
      }).success,
    ).toBe(false)
    expect(
      threadAnchorSchema.safeParse({
        anchorType: 'sheet-cell',
        workspaceId: WS,
        sheetInstanceId: SHEET,
        rowKey: 'row #12',
        fieldId: 'Column B',
      }).success,
    ).toBe(false)
    expect(anchorFromMetadata({ garbage: true })).toBeNull()
  })

  it('filters threads by room without parsing room ids ad hoc', () => {
    const metadata = anchorToMetadata(blockAnchor) as unknown
    expect(
      anchorBelongsToRoom(metadata as never, buildRoomId(WS, 'record', RECORD)),
    ).toBe(true)
    expect(
      anchorBelongsToRoom(metadata as never, buildRoomId(WS, 'record', BLOCK)),
    ).toBe(false)
  })
})
