/**
 * EXP-05.3 — offline replay engine and canonical port.
 *
 * The engine is proven against a fake port so the acceptance points are
 * deterministic: edits replay in sequence order, a clean edit commits and
 * leaves the store, an overlapping cell edit raises a conflict and stays
 * queued, a refused write is never reported as committed, and a sheet with an
 * unresolved conflict holds the edits that depend on it.
 *
 * The canonical port uses the real `DataClient` with controlled HTTP responses:
 * it detects an overlap before writing, sends a stale cell to `record_cell_conflict` with
 * both sides, and refuses a draft comment that has no anchor rather than
 * inventing one.
 */

import { describe, expect, it } from 'vitest'

import { createDataClient, DataClientError } from '#/lib/data-client'
import { rowIdentityKey } from '#/lib/row-identity'
import { composedSheetWireSchema } from '#/lib/sheet-composition-data'
import type { SheetInstanceWire } from '#/lib/sheet-instance-data'
import {
  OfflineReplayOverlapError,
  OfflineReplayRefusedError,
  createCanonicalOfflineReplayWriter,
  isOfflineReplayOverlap,
  replayOfflineEdits,
  retryTokenForEdit,
  richTextPayloadFromText,
  samePayload,
  shouldReplayOfflineEdits,
} from './replay'
import type { OfflineCellEdit, OfflineReplayPort } from './replay'
import { createInMemoryStorage, createOfflineEditStore } from './store'
import type {
  OfflineEdit,
  OfflineEditDraft,
  OfflineEditScope,
  OfflineEditStore,
} from './store'

const scope: OfflineEditScope = { userId: 'user-a', recordId: 'record-1' }

const SHEET_ID = '11111111-1111-4111-8111-111111111111'
const FIELD_ID = '22222222-2222-4222-8222-222222222222'
const ROW_ID = '33333333-3333-4333-8333-333333333333'

function cellDraft(overrides: Partial<OfflineCellEdit> = {}): OfflineEditDraft {
  return {
    kind: 'cell',
    sheetInstanceId: SHEET_ID,
    rowId: ROW_ID,
    columnId: FIELD_ID,
    value: 4.1,
    expectedRevision: 5,
    ...overrides,
  }
}

/** A fake port recording what the engine asked for; `behaviour` decides each. */
function createFakePort(
  behaviour: (edit: OfflineEdit) => 'commit' | 'overlap' | 'refuse' | 'network',
) {
  const calls: string[] = []
  const raised: string[] = []

  const port: OfflineReplayPort = {
    async commit(edit) {
      calls.push(edit.id)

      switch (behaviour(edit)) {
        case 'overlap':
          throw new OfflineReplayOverlapError()
        case 'refuse':
          throw new DataClientError('validation_error', 'invalid value', 422)
        case 'network':
          throw new TypeError('Failed to fetch')
        default:
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
  it('replays edits in sequence order, whatever order they are stored in', async () => {
    const store = createOfflineEditStore(createInMemoryStorage())

    const saved = await seed(store, [
      {
        kind: 'block_text',
        blockId: 'block-1',
        text: 'one',
        expectedRevision: 1,
      },
      cellDraft(),
      {
        kind: 'comment',
        sheetInstanceId: SHEET_ID,
        body: 'checked',
        mentions: [],
        parentId: 'comment-9',
        expectedRevision: 5,
      },
    ])

    const { port, calls } = createFakePort(() => 'commit')

    const report = await replayOfflineEdits({ scope, store, port })

    expect(calls).toEqual(saved.map((edit) => edit.id))
    expect(report.outcomes.map((outcome) => outcome.sequence)).toEqual([
      1, 2, 3,
    ])
    expect(report.committedEditIds).toEqual(saved.map((edit) => edit.id))
  })

  it('commits a clean edit and removes it from the store', async () => {
    const store = createOfflineEditStore(createInMemoryStorage())
    await seed(store, [cellDraft()])
    const { port } = createFakePort(() => 'commit')

    const report = await replayOfflineEdits({ scope, store, port })

    expect(report.outcomes[0]).toMatchObject({
      status: 'committed',
      reason: null,
      conflictId: null,
    })
    await expect(store.listEdits(scope)).resolves.toEqual([])
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
      cellDraft({ columnId: 'viability' }),
      cellDraft({ columnId: 'titre' }),
      {
        kind: 'block_text',
        blockId: 'block-1',
        text: 'note',
        expectedRevision: 1,
      },
    ])

    const { port, calls } = createFakePort((edit) =>
      edit.kind === 'cell' && edit.columnId === 'viability'
        ? 'overlap'
        : 'commit',
    )

    const report = await replayOfflineEdits({ scope, store, port })

    expect(calls).toEqual([saved[0].id, saved[2].id])
    expect(report.held).toHaveLength(1)
    expect(report.held[0]).toMatchObject({
      status: 'held',
      reason: 'sheet_conflict_unresolved',
      sheetInstanceId: SHEET_ID,
    })
    expect(report.held[0]?.message).toMatch(/unresolved conflict/)
    expect(report.heldCalculations).toEqual([
      expect.objectContaining({
        sheetInstanceId: SHEET_ID,
        rowId: ROW_ID,
        columnId: 'viability',
        conflictId: `conflict-for-${saved[0].id}`,
      }),
    ])
    // The conflicted edit and its held dependent stay queued; the block
    // committed and left.
    const remaining = await store.listEdits(scope)
    expect(remaining.map((edit) => edit.id)).toEqual([saved[0].id, saved[1].id])
  })

  it('does not report a refused write as committed and keeps it queued', async () => {
    const store = createOfflineEditStore(createInMemoryStorage())
    await seed(store, [
      cellDraft(),
      cellDraft({ sheetInstanceId: 'sheet-2', expectedRevision: 2 }),
    ])

    const { port } = createFakePort((edit) =>
      'sheetInstanceId' in edit && edit.sheetInstanceId === SHEET_ID
        ? 'refuse'
        : 'commit',
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
      isOfflineReplayOverlap(
        new DataClientError('validation_error', 'bad', 422),
      ),
    ).toBe(false)
  })

  it('preserves native String fallback, repeated code reads and coercion errors', () => {
    expect(isOfflineReplayOverlap({ toString: () => 'stale revision' })).toBe(
      true,
    )
    expect(isOfflineReplayOverlap(Symbol('revision conflict'))).toBe(true)
    let reads = 0

    const changingCode = {
      get code() {
        reads += 1

        return reads === 1 ? 'SB001' : 73
      },
    }

    expect(isOfflineReplayOverlap(changingCode)).toBe(false)
    expect(reads).toBe(2)

    const coercionError = new Error('coercion failed')

    const uncoercible = {
      [Symbol.toPrimitive]() {
        throw coercionError
      },
    }

    expect(() => isOfflineReplayOverlap(uncoercible)).toThrow(coercionError)

    try {
      isOfflineReplayOverlap(uncoercible)
    } catch (error) {
      expect(error).toBe(coercionError)
    }
  })

  it('replays on the transition to live, not on every status update', () => {
    expect(shouldReplayOfflineEdits('offline', 'live')).toBe(true)
    expect(shouldReplayOfflineEdits('reconnecting', 'live')).toBe(true)
    expect(shouldReplayOfflineEdits('connecting', 'live')).toBe(true)
    expect(shouldReplayOfflineEdits('live', 'live')).toBe(false)
    expect(shouldReplayOfflineEdits('live', 'offline')).toBe(false)
  })
})

/** Real request construction and response parsing, without a database server. */
function controlledTransport(responses: Response[]) {
  const requests: Request[] = []

  const fetchImpl: typeof fetch = (input, init) => {
    const request = new Request(
      input instanceof Request
        ? input
        : new URL(input, 'https://sheetbase.test'),
      init,
    )

    requests.push(request)
    const response = responses.shift()

    if (!response) throw new Error(`Unexpected request: ${request.url}`)

    return Promise.resolve(response)
  }

  return { client: createDataClient(fetchImpl), requests }
}

describe('canonical replay writer', () => {
  const composition = composedSheetWireSchema.parse({
    instanceId: SHEET_ID,
    revision: 5,
    offset: 0,
    limit: 200,
    hasMore: false,
    localFieldIds: [FIELD_ID],
    identity: {
      kind: 'local',
      columnIds: [FIELD_ID],
      logicalTypes: ['reference'],
    },
    rows: [],
  })

  const instance = (revision: number): SheetInstanceWire => ({
    id: SHEET_ID,
    workspace_id: SHEET_ID,
    project_id: null,
    notebook_record_id: null,
    source_definition_version_id: null,
    name: 'Replay fixture',
    description: null,
    lifecycle: 'active',
    revision,
    state: {
      bindings: [],
      localFields: [],
      localValues: {},
      calculationOverrides: {},
      presentation: {
        columnOrder: [],
        hiddenColumnIds: [],
        columnWidths: {},
        frozenColumnCount: 0,
        density: 'standard',
      },
      provenance: { createdFrom: 'ad_hoc' },
    },
    duplicated_from_instance_id: null,
    created_at: '2026-10-02T10:00:00.000Z',
    updated_at: '2026-10-02T10:00:00.000Z',
    created_by_user_id: 'user-a',
    updated_by_user_id: 'user-a',
  })

  const cellEdit: OfflineCellEdit = {
    id: 'edit-1',
    sequence: 1,
    createdAt: '2026-10-02T10:00:00.000Z',
    kind: 'cell',
    sheetInstanceId: SHEET_ID,
    rowId: ROW_ID,
    columnId: FIELD_ID,
    value: 4.1,
    expectedRevision: 5,
  }

  it('raises a conflict with both sides through record_cell_conflict when the revision moved', async () => {
    const { client, requests } = controlledTransport([
      Response.json({ ...composition, revision: 6 }),
      Response.json({ ...composition, revision: 6 }),
      Response.json([instance(6)]),
      Response.json({ id: 'conflict-1' }),
    ])

    const writer = createCanonicalOfflineReplayWriter({
      client,
      userId: 'user-a',
    })

    await expect(writer.commit(cellEdit)).rejects.toBeInstanceOf(
      OfflineReplayOverlapError,
    )
    await expect(writer.raiseCellConflict(cellEdit)).resolves.toBe('conflict-1')

    expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
      '/api/db/rpc/query_sheet_instance_rows',
      '/api/db/rpc/query_sheet_instance_rows',
      '/api/db/sheet_instances',
      '/api/db/rpc/record_cell_conflict',
    ])
    const record = requests.at(-1)
    expect(record?.method).toBe('POST')
    await expect(record?.json()).resolves.toEqual({
      p_instance_id: SHEET_ID,
      p_row_key: ROW_ID,
      p_field_id: FIELD_ID,
      p_local_value: 4.1,
      p_local_author_user_id: 'user-a',
      p_local_at: cellEdit.createdAt,
      p_remote_value: null,
      p_remote_author_user_id: null,
      p_remote_at: null,
    })
  })

  it('refuses a cell whose row no longer resolves instead of writing blind', async () => {
    const { client, requests } = controlledTransport([
      Response.json(composition),
    ])

    const writer = createCanonicalOfflineReplayWriter({
      client,
      userId: 'user-a',
    })

    await expect(writer.commit(cellEdit)).rejects.toBeInstanceOf(
      OfflineReplayRefusedError,
    )
    expect(requests).toHaveLength(1)
    expect(new URL(requests[0].url).pathname).toBe(
      '/api/db/rpc/query_sheet_instance_rows',
    )
  })

  it('advances revisions after two local cell writes and propagates a later rejection without further requests', async () => {
    const populated = composedSheetWireSchema.parse({
      ...composition,
      identity: {
        kind: 'source',
        columnIds: [SHEET_ID],
        logicalTypes: ['reference'],
      },
      rows: [
        {
          identityValues: [ROW_ID],
          sources: [
            {
              sourceKind: 'dataset',
              bindingId: SHEET_ID,
              datasetId: SHEET_ID,
              datasetRevision: 1,
              rowId: ROW_ID,
              revision: 1,
              matched: true,
              values: { [SHEET_ID]: ROW_ID },
            },
          ],
        },
      ],
    })

    const rowKey = rowIdentityKey(populated.identity, [ROW_ID])

    const { client, requests } = controlledTransport([
      Response.json(populated),
      Response.json(instance(6)),
      Response.json({ ...populated, revision: 6 }),
      Response.json(instance(7)),
      Response.json({ ...populated, revision: 7 }),
      Response.json(
        { error: { code: 'permission_denied', message: 'not allowed' } },
        { status: 403 },
      ),
    ])

    const writer = createCanonicalOfflineReplayWriter({
      client,
      userId: 'user-a',
    })

    await expect(
      writer.commit({ ...cellEdit, rowId: rowKey }),
    ).resolves.toBeUndefined()
    await expect(
      writer.commit({ ...cellEdit, id: 'edit-2', rowId: rowKey, value: 4.2 }),
    ).resolves.toBeUndefined()
    await expect(
      writer.commit({ ...cellEdit, id: 'edit-3', rowId: rowKey, value: 4.3 }),
    ).rejects.toMatchObject({
      code: 'permission_denied',
      status: 403,
    })
    expect(requests).toHaveLength(6)

    for (const [index, request] of requests.entries()) {
      expect(request.method).toBe('POST')
      expect(new URL(request.url).pathname).toBe(
        index % 2 === 0
          ? '/api/db/rpc/query_sheet_instance_rows'
          : '/api/db/rpc/mutate_sheet_instance_local_state',
      )
    }

    for (const [index, value] of [4.1, 4.2, 4.3].entries()) {
      await expect(requests[index * 2 + 1].json()).resolves.toMatchObject({
        p_instance_id: SHEET_ID,
        p_expected_revision: 5 + index,
        p_rows: [
          {
            kind: 'composed',
            rowKey,
            identityValues: [ROW_ID],
            compositionOffset: 0,
          },
        ],
        p_cells: [{ rowKey, fieldId: FIELD_ID, value }],
      })
    }
  })

  it('refuses a draft comment with no anchor instead of inventing one', async () => {
    const { client, requests } = controlledTransport([])

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
        sheetInstanceId: SHEET_ID,
        body: 'looks right',
        mentions: [],
        parentId: null,
        expectedRevision: 5,
      }),
    ).rejects.toThrow(/anchor/)
    expect(requests).toHaveLength(0)
  })
})

describe('replay helpers', () => {
  it('compares native objects with inherited keys, ordered getters and sparse arrays', () => {
    const reads: string[] = []

    const left = {
      get first() {
        reads.push('left.first')

        return 1
      },
      get second() {
        reads.push('left.second')

        return 2
      },
    }

    class InheritedFirst {
      get first() {
        reads.push('right.first')

        return 1
      }
    }

    const right = Object.assign(new InheritedFirst(), {
      unrelated: 3,
      second: 2,
    })

    Object.defineProperty(right, 'second', {
      enumerable: true,
      get() {
        reads.push('right.second')

        return 2
      },
    })
    expect(samePayload(left, right)).toBe(true)
    expect(reads).toEqual([
      'left.first',
      'right.first',
      'left.second',
      'right.second',
    ])

    const sparse: number[] = []
    sparse.length = 2
    expect(samePayload(sparse, [1, 2])).toBe(true)
    expect(samePayload([1, 2], sparse)).toBe(false)
    expect(samePayload(new Date(0), new Date(1))).toBe(true)
  })

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
