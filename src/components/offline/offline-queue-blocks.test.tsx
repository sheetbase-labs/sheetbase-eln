// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it } from 'vitest'

import {
  createInMemoryStorage,
  createOfflineEditStore,
} from '#/lib/offline/store'
import { replayOfflineEdits, samePayload } from '#/lib/offline/replay'
import type { OfflineReplayPort } from '#/lib/offline/replay'
import {
  OfflineEditsProvider,
  canEditBlockOffline,
  describeOfflineEdit,
  overlayQueuedBlocks,
  useOfflineEdits,
} from './offline-edits'

const scope = { userId: 'u1', recordId: 'r1' }

function setup() {
  const store = createOfflineEditStore(createInMemoryStorage())
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <OfflineEditsProvider store={store} scope={scope}>
      {children}
    </OfflineEditsProvider>
  )
  return { store, ...renderHook(() => useOfflineEdits(), { wrapper }) }
}

const checklist = (done: boolean) => ({
  items: [{ id: 'i1', text: 'Weigh sample', done }],
})
const block = (version: number) => ({
  id: 'b1',
  type: 'checklist',
  version,
  payloadSchemaVersion: 1,
})

describe('canEditBlockOffline', () => {
  it('allows blocks edited in place and refuses ones that need the server', () => {
    for (const type of [
      'rich_text',
      'checklist',
      'callout',
      'metric',
      'structure',
      'reaction',
    ]) {
      expect(canEditBlockOffline(type)).toBe(true)
    }
    for (const type of ['file', 'dataset_import', 'signature_request']) {
      expect(canEditBlockOffline(type)).toBe(false)
    }
  })
})

describe('queueBlockPayload', () => {
  it('keeps the latest payload and the first revision it was based on', async () => {
    const { store, result } = setup()
    await act(async () => {
      await result.current.queueBlockPayload(block(4), checklist(false))
    })
    await act(async () => {
      await result.current.queueBlockPayload(block(4), checklist(true))
    })
    const edits = await store.listEdits(scope)
    expect(edits).toHaveLength(1)
    expect(edits[0]).toMatchObject({
      kind: 'block_payload',
      blockType: 'checklist',
      expectedRevision: 4,
      payload: checklist(true),
    })
  })

  it('keeps formatted text, which plain text could not hold', async () => {
    const { store, result } = setup()
    const bold = {
      doc: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'x', marks: [{ type: 'bold' }] }],
          },
        ],
      },
    }
    let kept = false
    await act(async () => {
      kept = await result.current.queueBlockPayload(
        { ...block(1), type: 'rich_text' },
        bold,
      )
    })
    expect(kept).toBe(true)
    expect((await store.listEdits(scope))[0]).toMatchObject({ payload: bold })
  })

  it('declines a block that needs the server', async () => {
    const { store, result } = setup()
    let kept = true
    await act(async () => {
      kept = await result.current.queueBlockPayload(
        { ...block(1), type: 'file' },
        {},
      )
    })
    expect(kept).toBe(false)
    expect(await store.listEdits(scope)).toHaveLength(0)
  })

  it('describes the edit in words', async () => {
    const { store, result } = setup()
    await act(async () => {
      await result.current.queueBlockPayload(block(1), checklist(true))
    })
    const [edit] = await store.listEdits(scope)
    expect(describeOfflineEdit(edit)).toMatchObject({
      title: 'Edited a checklist block',
      detail: 'Weigh sample',
    })
  })
})

describe('queueSheetCells and queueSheetRow', () => {
  const sheet = { instanceId: 's1', revision: 7 }

  it('replaces a cell edited twice but keeps its first revision', async () => {
    const { store, result } = setup()
    await act(async () => {
      await result.current.queueSheetCells(sheet, [
        { rowId: 'r', columnId: 'c', value: 1 },
      ])
    })
    await act(async () => {
      await result.current.queueSheetCells({ ...sheet, revision: 9 }, [
        { rowId: 'r', columnId: 'c', value: 2 },
      ])
    })
    const edits = await store.listEdits(scope)
    expect(edits).toHaveLength(1)
    expect(edits[0]).toMatchObject({ value: 2, expectedRevision: 7 })
  })

  it('folds a cell typed into an offline row into that row', async () => {
    const { store, result } = setup()
    await act(async () => {
      await result.current.queueSheetRow(sheet, {
        rowKey: 'new',
        values: { a: 1 },
      })
    })
    await act(async () => {
      await result.current.queueSheetCells(sheet, [
        { rowId: 'new', columnId: 'b', value: 'x' },
      ])
    })
    const edits = await store.listEdits(scope)
    expect(edits).toHaveLength(1)
    expect(edits[0]).toMatchObject({
      kind: 'row',
      rowKey: 'new',
      values: { a: 1, b: 'x' },
    })
  })
})

describe('replay of a block payload', () => {
  function port(commit: OfflineReplayPort['commit']): OfflineReplayPort {
    return { commit, raiseCellConflict: async () => null }
  }

  it('commits and clears the edit', async () => {
    const { store, result } = setup()
    await act(async () => {
      await result.current.queueBlockPayload(block(2), checklist(true))
    })
    const sent: unknown[] = []
    const report = await replayOfflineEdits({
      scope,
      store,
      port: port(async (edit) => void sent.push(edit)),
    })
    expect(report.committedEditIds).toHaveLength(1)
    expect(sent).toHaveLength(1)
    expect(await store.listEdits(scope)).toHaveLength(0)
  })

  it('keeps a stale block edit as a conflict instead of overwriting', async () => {
    const { store, result } = setup()
    await act(async () => {
      await result.current.queueBlockPayload(block(2), checklist(true))
    })
    const report = await replayOfflineEdits({
      scope,
      store,
      port: port(async () => {
        throw Object.assign(new Error('stale'), { code: 'stale_version' })
      }),
    })
    expect(report.conflicts).toHaveLength(1)
    expect(report.conflicts[0].message).toMatch(/someone else/)
    expect(await store.listEdits(scope)).toHaveLength(1)
  })
})

describe('samePayload', () => {
  it('ignores key order and compares deeply', () => {
    expect(
      samePayload({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 }),
    ).toBe(true)
    expect(samePayload({ a: 1 }, { a: 2 })).toBe(false)
    expect(samePayload([1], [1, 2])).toBe(false)
  })
})

describe('overlayQueuedBlocks', () => {
  it('shows the queued payload and leaves other blocks untouched', async () => {
    const { store, result } = setup()
    await act(async () => {
      await result.current.queueBlockPayload(block(1), checklist(true))
    })
    const edits = await store.listEdits(scope)
    const blocks = [
      { id: 'b1', payload: checklist(false) },
      { id: 'b2', payload: { other: true } },
    ]
    const shown = overlayQueuedBlocks(blocks, edits)
    expect(shown[0].payload).toEqual(checklist(true))
    expect(shown[1]).toBe(blocks[1])
    expect(overlayQueuedBlocks(blocks, [])).toBe(blocks)
  })
})
