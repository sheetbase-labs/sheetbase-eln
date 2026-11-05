import {
  createInMemoryStorage,
  createOfflineEditStore,
  offlineEditsKey,
} from '#/lib/offline/store'
import type { OfflineEdit, OfflineEditScope } from '#/lib/offline/store'

/**
 * Static device-store fixtures the offline stories share. The store is the
 * in-memory backend, so no story reaches IndexedDB, a database or the network.
 */
export const SCOPE: OfflineEditScope = {
  userId: 'user-1',
  recordId: 'rec-1',
}

export const EDITS: OfflineEdit[] = [
  {
    kind: 'block_text',
    id: 'edit-1',
    sequence: 1,
    expectedRevision: 4,
    createdAt: '2026-11-05T09:42:00.000Z',
    blockId: 'block-1',
    text: 'Cells were seeded at 2e5 per well and left to settle for an hour.',
  },
  {
    kind: 'cell',
    id: 'edit-2',
    sequence: 2,
    expectedRevision: 7,
    createdAt: '2026-11-05T09:44:00.000Z',
    sheetInstanceId: 'sheet-1',
    rowId: 'row 6',
    columnId: 'Load (L/m²)',
    value: 4.1,
  },
  {
    kind: 'row',
    id: 'edit-3',
    sequence: 3,
    expectedRevision: 7,
    createdAt: '2026-11-05T09:46:00.000Z',
    sheetInstanceId: 'sheet-1',
    values: { Sample: 'S-0042', 'Load (L/m²)': 3.8, Operator: 'A. Rao' },
  },
  {
    kind: 'comment',
    id: 'edit-4',
    sequence: 4,
    expectedRevision: 0,
    createdAt: '2026-11-05T09:48:00.000Z',
    sheetInstanceId: 'sheet-1',
    body: 'Row 6 looks high compared with the last run.',
    mentions: [],
    parentId: null,
  },
]

/** A device store holding `edits` for `SCOPE`. */
export function seededStore(edits: readonly OfflineEdit[] = EDITS) {
  return createOfflineEditStore(
    createInMemoryStorage({ [offlineEditsKey(SCOPE)]: edits }),
  )
}
