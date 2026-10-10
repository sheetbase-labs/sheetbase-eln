/**
 * EXP-05.3 — offline replay engine and canonical port.
 *
 * The engine is proven against a fake port so the acceptance points are
 * deterministic: edits replay in sequence order, a clean edit commits and
 * leaves the store, an overlapping cell edit raises a conflict and stays
 * queued, a refused write is never reported as committed, and a sheet with an
 * unresolved conflict holds the edits that depend on it.
 *
 * The canonical port is proven above the `DataClient` boundary: it detects an
 * overlap before writing, sends a stale cell to `record_cell_conflict` with
 * both sides, and blocks a draft comment that has no anchor rather than
 * inventing one.
 */

import { describe, expect, it, vi } from 'vitest'

import type { DataClient } from '#/lib/data-client'
import { DataClientError } from '#/lib/data-client'
import {
  OfflineReplayOverlapError,
  createCanonicalOfflineReplayWriter,
  isOfflineReplayOverlap,
  replayOfflineEdits,
  retryTokenForEdit,
  richTextPayloadFromText,
  shouldReplayOfflineEdits,
} from './replay'
import type {
  OfflineCellEdit,
  OfflineReplayPort,
} from './replay'
import {
  createInMemoryStorage,
  createOfflineEditStore,
} from './store'
import type {
  OfflineEdit,
  OfflineEditDraft,
  OfflineEditScope,
  OfflineEditStore,
} from './store'

const scope: OfflineEditScope = { userId: 'user-a', recordId: 'record-1' }

function cellDraft(overrides: Partial<OfflineCellEdit> = {}) {
  return {
    kind: 'cell' as const,
    sheetInstanceId: 'sheet-1',
    rowId: 'sb-row-v1:abc',
    columnId: 'field-1',
    value: 4.1,
    expectedRevision: 5,
    ...overrides,
  } satisfies OfflineEditDraft
}

/** A fake port that records the calls the engine makes and can fail per edit. */
function createFakePort(
  behaviour: (edit: OfflineEdit) => 'commit' | 'overlap' | 'refuse' | 'network',
) {
  const calls: string[] = []
  const raised: string[] = []
  const port: OfflineReplayPort = {
    async commit(edit) {
      calls.push(`commit:${edit.id}`)
      switch (behaviour(edit)) {
        case 'overlap':
          throw new OfflineReplayOverlapError()
        case 'refuse':
          throw new DataClientError(
            'validation_error',
            'invalid value',
            422,
          )
        case 'network':
          throw new TypeError('Failed to fetch')
        default:
          return
      }
    },
    async raiseCellConflict(edit) {
      raised.push(edit.id)
      return `conflict-for-${edit.id}`
    },
  }
  return { port, calls, raised }
}

async function seed(
  store: OfflineEditStore,
  drafts: OfflineEditDraft[],
): Promise<OfflineEdit[]> {
  const saved: OfflineEdit[] = []
  for (const draft of drafts) saved.push(await store.putEdit(scope, draft))
  return saved
}

describe('offline replay engine', () => {
  it('replays edits in sequence order, not the order it was handed them', async () => {
    const store = createOfflineEditStore(createInMemoryStorage())
    const saved = await seed(store, [
      { kind: 'block_text', blockId: 'block-1', text: 'one', expectedRevision: 1 },
      cellDraft(),
      {
        kind: 'comment',
        sheetInstanceId: 'sheet-1',
        body: 'checked',
        mentions: [],
        parentId: 'comment-9',
      },
    ])
    const { port, calls } = createFakePort(() => 'commit')

    const report = await replayOfflineEdits({ scope, store, port })

    expect(calls).toEqual(saved.map((edit) => `commit:${edit.id}`))
    expect(report.outcomes.map((outcome) => outcome.sequence)).toEqual([1, 2, 3])
    expect(report.committedEditIds).toEqual(saved.map((edit) => edit.id))
  })

  it('commits a clean edit and removes it from the store', async () => {
    const store = createOfflineEditStore(createInMemoryStorage())
    const [saved] = await seed(store, [cellDraft()])
    const { port } = createFakePort(() => 'commit')

    const report = await replayOfflineEdits({ scope, store, port })

    expect(report.outcomes[0]).toMatchObject({
      status: 'committed',
      reason: null,
      conflictId: null,
    })
    await expect(store.listEdits(scope)).resolves.toEqual([])
    expect(saved).toBeDefined()
  })

  it('raises a conflict for an overlapping cell and keeps it queued', async () => {
    const store = createOfflineEditStore(createInMemoryStorage())
    await seed(store, [cellDraft()])
    const { port, raised } = createFakePort(() => 'overlap')

    const report = await replayOfflineEdits({ scope, store, port })

    expect(report.outcomes[0]).toMatchObject({
      status: 'conflict',
      reason: 'overlap',
    })
    expect(report.outcomes[0]?.conflictId).toMatch(/^conflict-for-/)
    expect(raised).toHaveLength(1)
    // The overlapping edit is not dropped: it stays until it is resolved.
    await expect(store.listEdits(scope)).resolves.toHaveLength(1)
  })

  it('holds later sheet edits and their calculations while a conflict is open', async () => {
    const store = createOfflineEditStore(createInMemoryStorage())
    const saved = await seed(store, [
      cellDraft({ rowId: 'row-6', columnId: 'viability' }),
      cellDraft({ rowId: 'row-6', columnId: 'titre' }),
      { kind: 'block_text', blockId: 'block-1', text: 'note', expectedRevision: 1 },
    ])
    const { port, calls } = createFakePort((edit) =>
      edit.kind === 'cell' && edit.columnId === 'viability' ? 'overlap' : 'commit',
    )

    const report = await replayOfflineEdits({ scope, store, port })

    expect(calls).toEqual([`commit:${saved[0]!.id}`, `commit:${saved[2]!.id}`])
    expect(report.held).toHaveLength(1)
    expect(report.held[0]).toMatchObject({
      status: 'held',
      reason: 'sheet_conflict_unresolved',
      sheetInstanceId: 'sheet-1',
    })
    expect(report.held[0]?.message).toMatch(/unresolved conflict/)
    expect(report.heldCalculations).toEqual([
      expect.objectContaining({
        sheetInstanceId: 'sheet-1',
        rowId: 'row-6',
        columnId: 'viability',
        conflictId: `conflict-for-${saved[0]!.id}`,
      }),
    ])
    // Two edits stay queued (the conflict and the held dependent), the block
    // committed and left.
    const remaining = await store.listEdits(scope)
    expect(remaining.map((edit) => edit.id)).toEqual([saved[0]!.id, saved[1]!.id])
  })

  it('does not report a refused write as committed and keeps it queued', async () => {
    const store = createOfflineEditStore(createInMemoryStorage())
    await seed(store, [
      cellDraft({ expectedRevision: 5 }),
      cellDraft({ sheetInstanceId: 'sheet-2', expectedRevision: 2 }),
    ])
    const { port } = createFakePort((edit) =>
      edit.sheetInstanceId === 'sheet-1' ? 'refuse' : 'commit',
    )

    const report = await replayOfflineEdits({ scope, store, port })

    expect(report.outcomes[0]).toMatchObject({
      status: 'failed',
      reason: 'refused',
    })
    expect(report.committedEditIds).toHaveLength(1)
    expect(report.failed).toHaveLength(1)
    await expect(store.listEdits(scope)).resolves.toHaveLength(1)
  })

  it('reports a transport failure as failed, not committed', async () => {
    const store = createOfflineEditStore(createInMemoryStorage())
    await seed(store, [cellDraft()])
    const { port } = createFakePort(() => 'network')

    const report = await replayOfflineEdits({ scope, store, port })

    expect(report.outcomes[0]).toMatchObject({
      status: 'failed',
      reason: 'commit_failed',
    })
    await expect(store.listEdits(scope)).resolves.toHaveLength(1)
  })

  it('keeps a stale edit queued when the conflict cannot be recorded', async () => {
    const store = createOfflineEditStore(createInMemoryStorage())
    await seed(store, [cellDraft()])
    const port: OfflineReplayPort = {
      commit: async () => {
        throw new OfflineReplayOverlapError()
      },
      raiseCellConflict: async () => {
        throw new DataClientError('permission_denied', 'not allowed', 403)
      },
    }

    const report = await replayOfflineEdits({ scope, store, port })

    expect(report.outcomes[0]).toMatchObject({
      status: 'failed',
      reason: 'conflict_raise_failed',
    })
    expect(report.conflicts).toHaveLength(0)
    expect(report.heldCalculations).toHaveLength(0)
    await expect(store.listEdits(scope)).resolves.toHaveLength(1)
  })
})

describe('replay overlap classification', () => {
  it('treats a stale revision error as an overlap', () => {
    expect(
      isOfflineReplayOverlap(
        new DataClientError('stale_version', 'revision conflict', 409),
      ),
    ).toBe(true)
    expect(isOfflineReplayOverlap(new OfflineReplayOverlapError())).toBe(true)
    expect(
      isOfflineReplayOverlap(new DataClientError('validation_error', 'bad', 422)),
    ).toBe(false)
  })

  it('replays on the transition to live, not on every status update', () => {
    expect(shouldReplayOfflineEdits('offline', 'live')).toBe(true)
    expect(shouldReplayOfflineEdits('reconnecting', 'live')).toBe(true)
    expect(shouldReplayOfflineEdits('connecting', 'live')).toBe(true)
    expect(shouldReplayOfflineEdits('live', 'live')).toBe(false)
    expect(shouldReplayOfflineEdits('live', 'offline')).toBe(false)
  })
})

describe('canonical replay writer', () => {
  function fakeClient(overrides: Partial<DataClient>): DataClient {
    return {
      list: vi.fn(async () => []),
      count: vi.fn(async () => 0),
      rpc: vi.fn(async () => undefined),
      insert: vi.fn(async () => ({}) as never),
      patch: vi.fn(async () => []),
      remove: vi.fn(async () => []),
      ...overrides,
    } as DataClient
  }

  const composition = {
    instanceId: '11111111-1111-4111-8111-111111111111',
    revision: 5,
    offset: 0,
    limit: 200,
    hasMore: false,
    localFieldIds: ['22222222-2222-4222-8222-222222222222'],
    identity: { kind: 'local' as const, columnIds: ['22222222-2222-4222-8222-222222222222'], logicalTypes: ['decimal' as const] },
    rows: [],
  }

  const cellEdit: OfflineCellEdit = {
    id: 'edit-1',
    sequence: 1,
    createdAt: '2026-10-02T10:00:00.000Z',
    kind: 'cell',
    sheetInstanceId: composition.instanceId,
    rowId: '33333333-3333-4333-8333-333333333333',
    columnId: '22222222-2222-4222-8222-222222222222',
    value: 4.1,
    expectedRevision: 5,
  }

  it('raises a conflict with both sides through record_cell_conflict when the revision moved', async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === 'query_sheet_instance_rows') {
        return { ...composition, revision: 6 }
      }
      if (name === 'record_cell_conflict') {
        return { id: 'conflict-1' }
      }
      return undefined
    })
    const client = fakeClient({ rpc: rpc as DataClient['rpc'] })
    const writer = createCanonicalOfflineReplayWriter({
      client,
      userId: 'user-a',
    })

    await expect(writer.commit(cellEdit)).rejects.toBeInstanceOf(
      OfflineReplayOverlapError,
    )
    const conflictId = await writer.raiseCellConflict(cellEdit)

    expect(conflictId).toBe('conflict-1')
    const call = rpc.mock.calls.find(([name]) => name === 'record_cell_conflict')
    expect(call?.[1]).toMatchObject({
      p_instance_id: composition.instanceId,
      p_row_key: cellEdit.rowId,
      p_field_id: cellEdit.columnId,
      p_local_value: 4.1,
      p_local_author_user_id: 'user-a',
      p_local_at: cellEdit.createdAt,
      p_remote_value: null,
    })
  })

  it('refuses a draft comment with no anchor instead of inventing one', async () => {
    const client = fakeClient({})
    const writer = createCanonicalOfflineReplayWriter({
      client,
      userId: 'user-a',
    })

    await expect(
      writer.commit({
        id: 'edit-2',
        sequence: 2,
        createdAt: '2026-10-02T10:00:00.000Z',
        kind: 'comment',
        sheetInstanceId: composition.instanceId,
        body: 'looks right',
        mentions: [],
        parentId: null,
      }),
    ).rejects.toThrow(/anchor/)
    expect(client.rpc).not.toHaveBeenCalled()
  })
})

describe('replay helpers', () => {
  it('builds a rich-text payload with one paragraph per line', () => {
    expect(richTextPayloadFromText('a\n\nb')).toEqual({
      doc: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'a' }] },
          { type: 'paragraph' },
          { type: 'paragraph', content: [{ type: 'text', text: 'b' }] },
        ],
      },
    })
  })

  it('derives a stable uuid retry token from an edit id', () => {
    const token = retryTokenForEdit('edit-1')
    expect(token).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    expect(retryTokenForEdit('edit-1')).toBe(token)
    expect(retryTokenForEdit('edit-2')).not.toBe(token)
  })
})
