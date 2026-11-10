import { describe, expect, it } from 'vitest'
import {
  createInMemoryStorage,
  createOfflineEditStore,
} from '#/lib/offline/store'
import type { OfflineEditDraft } from '#/lib/offline/store'

const scope = { userId: 'scientist', recordId: 'notebook' }

function row(rowKey: string): OfflineEditDraft {
  return {
    kind: 'row',
    sheetInstanceId: 'sheet',
    rowKey,
    values: { observation: rowKey },
    expectedRevision: 1,
  }
}

describe('workspace offline rows require ordered store writes', () => {
  it('demonstrates that parallel scope read/assign/replace loses one edit', async () => {
    const store = createOfflineEditStore(createInMemoryStorage())

    const saved = await Promise.all([
      store.putEdit(scope, row('first')),
      store.putEdit(scope, row('second')),
    ])

    expect(saved.map((edit) => edit.sequence)).toEqual([1, 1])
    expect(await store.listEdits(scope)).toHaveLength(1)
  })

  it('keeps both rows and advances the replay sequence with serial writes', async () => {
    const store = createOfflineEditStore(createInMemoryStorage())
    const first = await store.putEdit(scope, row('first'))
    const second = await store.putEdit(scope, row('second'))

    expect(first.sequence).toBe(1)
    expect(second.sequence).toBe(2)
    expect(await store.listEdits(scope)).toEqual([first, second])
  })
})
