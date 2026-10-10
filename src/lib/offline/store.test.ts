import { describe, expect, it } from 'vitest'

import {
  createInMemoryStorage,
  createOfflineEditStore,
  offlineEditsKey,
} from './store'
import type { OfflineEditDraft, OfflineEditScope } from './store'

const scope: OfflineEditScope = { userId: 'user-a', recordId: 'record-1' }

type BlockTextDraft = Extract<OfflineEditDraft, { kind: 'block_text' }>

function draft(overrides: Partial<BlockTextDraft> = {}): BlockTextDraft {
  return {
    kind: 'block_text',
    blockId: 'block-1',
    text: 'measured titre',
    expectedRevision: 4,
    ...overrides,
  }
}

describe('offline edit store', () => {
  it('persists an edit and reads it back with its expected revision and timestamp', async () => {
    const store = createOfflineEditStore(createInMemoryStorage())

    const saved = await store.putEdit(scope, {
      ...draft(),
      createdAt: '2026-10-02T10:00:00.000Z',
    })

    expect(saved).toMatchObject({
      kind: 'block_text',
      blockId: 'block-1',
      text: 'measured titre',
      expectedRevision: 4,
      createdAt: '2026-10-02T10:00:00.000Z',
      sequence: 1,
    })
    expect(saved.id).toEqual(expect.any(String))

    await expect(store.listEdits(scope)).resolves.toEqual([saved])
  })

  it('stamps an id and timestamp when the caller does not supply them', async () => {
    const store = createOfflineEditStore(createInMemoryStorage())

    const saved = await store.putEdit(scope, draft())

    expect(saved.id.length).toBeGreaterThan(0)
    expect(Number.isNaN(Date.parse(saved.createdAt))).toBe(false)
  })

  it('keeps every edit kind and payload shape intact', async () => {
    const store = createOfflineEditStore(createInMemoryStorage())

    await store.putEdit(scope, draft())
    await store.putEdit(scope, {
      kind: 'cell',
      sheetInstanceId: 'instance-1',
      rowId: 'row-6',
      columnId: 'capsid-titre',
      value: 42.5,
      expectedRevision: 9,
    })
    await store.putEdit(scope, {
      kind: 'row',
      sheetInstanceId: 'instance-1',
      values: { 'capsid-titre': 42.5, notes: null },
      expectedRevision: 9,
    })
    await store.putEdit(scope, {
      kind: 'comment',
      sheetInstanceId: 'instance-1',
      body: 'Check the dilution.',
      mentions: ['user-b'],
      parentId: null,
      expectedRevision: 9,
    })

    const edits = await store.listEdits(scope)
    expect(edits.map((edit) => edit.kind)).toEqual([
      'block_text',
      'cell',
      'row',
      'comment',
    ])
    expect(edits[1]).toMatchObject({
      kind: 'cell',
      sheetInstanceId: 'instance-1',
      rowId: 'row-6',
      columnId: 'capsid-titre',
      value: 42.5,
      expectedRevision: 9,
    })
    expect(edits[3]).toMatchObject({
      kind: 'comment',
      body: 'Check the dilution.',
      mentions: ['user-b'],
      parentId: null,
    })
  })

  it('returns edits in replay order, oldest first', async () => {
    const store = createOfflineEditStore(createInMemoryStorage())

    await store.putEdit(scope, draft({ text: 'first' }))
    await store.putEdit(scope, draft({ blockId: 'block-2', text: 'second' }))
    await store.putEdit(scope, draft({ blockId: 'block-3', text: 'third' }))

    const texts = (await store.listEdits(scope)).map((edit) =>
      edit.kind === 'block_text' ? edit.text : edit.kind,
    )
    expect(texts).toEqual(['first', 'second', 'third'])
  })

  it('isolates edits per user and per record', async () => {
    const store = createOfflineEditStore(createInMemoryStorage())
    const otherUser: OfflineEditScope = { userId: 'user-b', recordId: 'record-1' }
    const otherRecord: OfflineEditScope = {
      userId: 'user-a',
      recordId: 'record-2',
    }

    await store.putEdit(scope, draft({ text: 'mine' }))
    await store.putEdit(otherUser, draft({ text: 'theirs' }))
    await store.putEdit(otherRecord, draft({ text: 'elsewhere' }))

    const mine = await store.listEdits(scope)
    expect(mine).toHaveLength(1)
    expect(mine[0]).toMatchObject({ text: 'mine' })

    const theirs = await store.listEdits(otherUser)
    expect(theirs).toHaveLength(1)
    expect(theirs[0]).toMatchObject({ text: 'theirs' })

    const elsewhere = await store.listEdits(otherRecord)
    expect(elsewhere).toHaveLength(1)
    expect(elsewhere[0]).toMatchObject({ text: 'elsewhere' })
  })

  it('never lets one scope read another scope’s edits', async () => {
    const store = createOfflineEditStore(createInMemoryStorage())
    await store.putEdit(scope, draft())

    expect(await store.listEdits({ userId: 'user-a', recordId: 'record-2' })).toEqual(
      [],
    )
    expect(await store.listEdits({ userId: 'user-b', recordId: 'record-1' })).toEqual(
      [],
    )
  })

  it('removes exactly the edits a successful replay committed', async () => {
    const store = createOfflineEditStore(createInMemoryStorage())
    const other: OfflineEditScope = { userId: 'user-a', recordId: 'record-2' }

    const first = await store.putEdit(scope, draft({ text: 'first' }))
    const second = await store.putEdit(scope, draft({ text: 'second' }))
    const third = await store.putEdit(scope, draft({ text: 'third' }))
    const kept = await store.putEdit(other, draft({ text: 'elsewhere' }))

    await expect(store.removeEdits(scope, [first.id, third.id])).resolves.toBe(2)

    const remaining = await store.listEdits(scope)
    expect(remaining.map((edit) => edit.id)).toEqual([second.id])
    // The other record's edit is untouched.
    await expect(store.listEdits(other)).resolves.toEqual([kept])
  })

  it('reports zero when nothing matched and tolerates unknown ids', async () => {
    const store = createOfflineEditStore(createInMemoryStorage())
    const saved = await store.putEdit(scope, draft())

    await expect(store.removeEdits(scope, ['missing-id'])).resolves.toBe(0)
    await expect(store.removeEdits(scope, [])).resolves.toBe(0)
    await expect(store.listEdits(scope)).resolves.toEqual([saved])
  })

  it('deletes the stored key once the last edit is removed', async () => {
    const storage = createInMemoryStorage()
    const store = createOfflineEditStore(storage)
    const saved = await store.putEdit(scope, draft())

    await store.removeEdits(scope, [saved.id])

    await expect(storage.get(offlineEditsKey(scope))).resolves.toBeUndefined()
  })

  it('clears every edit for a record without touching another record', async () => {
    const store = createOfflineEditStore(createInMemoryStorage())
    const other: OfflineEditScope = { userId: 'user-a', recordId: 'record-2' }

    await store.putEdit(scope, draft())
    await store.putEdit(scope, draft({ blockId: 'block-2' }))
    const kept = await store.putEdit(other, draft())

    await store.clear(scope)

    await expect(store.listEdits(scope)).resolves.toEqual([])
    await expect(store.listEdits(other)).resolves.toEqual([kept])
  })

  it('treats a missing or non-array value as no edits', async () => {
    const storage = createInMemoryStorage({
      [offlineEditsKey(scope)]: { not: 'an array' },
    })
    const store = createOfflineEditStore(storage)

    await expect(store.listEdits(scope)).resolves.toEqual([])
    await expect(store.listEdits({ userId: 'x', recordId: 'y' })).resolves.toEqual(
      [],
    )
  })

  it.each(['not json', 42, null, { leaks: true }])(
    'reads %j as no edits without throwing',
    async (stored) => {
      const storage = createInMemoryStorage({ [offlineEditsKey(scope)]: stored })
      const store = createOfflineEditStore(storage)

      await expect(store.listEdits(scope)).resolves.toEqual([])
    },
  )

  it('drops corrupt or unknown members and keeps the valid ones', async () => {
    const valid = {
      id: 'edit-1',
      sequence: 1,
      expectedRevision: 3,
      createdAt: '2026-10-02T10:00:00.000Z',
      kind: 'block_text',
      blockId: 'block-1',
      text: 'valid',
    }
    const storage = createInMemoryStorage({
      [offlineEditsKey(scope)]: [
        valid,
        { ...valid, id: 'edit-2', kind: 'telepathy' },
        { ...valid, id: 'edit-3', sequence: 0 },
        { ...valid, id: '', text: 'no id' },
        { ...valid, id: 'edit-4', expectedRevision: 'four' },
        'a string',
        null,
        { ...valid, id: 'edit-5', kind: 'cell', rowId: undefined },
      ],
    })
    const store = createOfflineEditStore(storage)

    const edits = await store.listEdits(scope)
    expect(edits).toHaveLength(1)
    expect(edits[0]).toMatchObject({ id: 'edit-1', text: 'valid' })
  })

  it('repairs a corrupt store by writing the sanitised set back', async () => {
    const storage = createInMemoryStorage({
      [offlineEditsKey(scope)]: ['garbage', { nonsense: true }],
    })
    const store = createOfflineEditStore(storage)

    const saved = await store.putEdit(scope, draft({ text: 'recovered' }))

    expect(saved.sequence).toBe(1)
    await expect(store.listEdits(scope)).resolves.toEqual([saved])
  })

  it('rejects a scope without a user or record rather than sharing a key', async () => {
    const store = createOfflineEditStore(createInMemoryStorage())

    await expect(
      store.listEdits({ userId: '', recordId: 'record-1' }),
    ).rejects.toThrow(TypeError)
    await expect(store.putEdit({ userId: 'user-a', recordId: '' }, draft())).rejects.toThrow(
      TypeError,
    )
    await expect(store.clear({ userId: '', recordId: '' })).rejects.toThrow(
      TypeError,
    )
    await expect(store.listScopes('')).rejects.toThrow(TypeError)
  })

  it('lists the record ids with retained drafts for one user only', async () => {
    const store = createOfflineEditStore(createInMemoryStorage())
    await store.putEdit({ userId: 'user-a', recordId: 'record-2' }, draft())
    await store.putEdit({ userId: 'user-a', recordId: 'record-1' }, draft())
    await store.putEdit({ userId: 'user-b', recordId: 'record-3' }, draft())

    await expect(store.listScopes('user-a')).resolves.toEqual([
      'record-1',
      'record-2',
    ])
    await expect(store.listScopes('user-b')).resolves.toEqual(['record-3'])
    await expect(store.listScopes('user-c')).resolves.toEqual([])
  })

  it('omits records that hold no valid draft', async () => {
    const storage = createInMemoryStorage({
      [offlineEditsKey({ userId: 'user-a', recordId: 'corrupt' })]: ['junk'],
    })
    const store = createOfflineEditStore(storage)
    const first: OfflineEditScope = { userId: 'user-a', recordId: 'record-1' }
    const saved = await store.putEdit(first, draft())

    await expect(store.listScopes('user-a')).resolves.toEqual(['record-1'])

    await store.removeEdits(first, [saved.id])
    await expect(store.listScopes('user-a')).resolves.toEqual([])
  })

  it('skips malformed scope keys instead of throwing', async () => {
    const storage = createInMemoryStorage({
      'sheetbase-offline-edits-v1:user-a:%E0%A4%A': ['junk'],
    })
    const store = createOfflineEditStore(storage)
    await store.putEdit(scope, draft())

    await expect(store.listScopes('user-a')).resolves.toEqual(['record-1'])
  })

  it('reports no scopes when the backend cannot enumerate keys', async () => {
    const backend = createInMemoryStorage()
    const store = createOfflineEditStore({
      get: backend.get,
      set: backend.set,
      delete: backend.delete,
    })
    await store.putEdit(scope, draft())

    await expect(store.listScopes('user-a')).resolves.toEqual([])
  })

  it('does not leak a backend reference to callers', async () => {
    const storage = createInMemoryStorage()
    const store = createOfflineEditStore(storage)
    await store.putEdit(scope, draft({ text: 'original' }))

    const [read] = await store.listEdits(scope)
    if (read.kind === 'block_text') read.text = 'mutated'

    const [reread] = await store.listEdits(scope)
    expect(reread).toMatchObject({ text: 'original' })
  })
})
