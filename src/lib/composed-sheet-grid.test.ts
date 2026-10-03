import { describe, expect, it } from 'vitest'

import { composedSheetGridMatrix } from './composed-sheet-grid'
import type { ComposedSheetSnapshot } from './sheet-composition-data'

describe('composed Sheet grid matrix', () => {
  it('projects bound columns for a grid surface', () => {
    const snapshot = {
      instanceId: '30000000-0000-4000-8000-000000000010',
      revision: 1,
      offset: 0,
      limit: 50,
      hasMore: false,
      localFieldIds: [],
      identity: {
        kind: 'source' as const,
        columnIds: ['10000000-0000-4000-8000-000000000001'],
        logicalTypes: ['reference' as const],
      },
      rows: [],
      boundProjection: {
        columns: [
          {
            id: '10000000-0000-4000-8000-000000000001',
            key: 'sample',
            label: 'Sample',
            presentation: {
              kind: 'record-picker' as const,
              inputType: 'text' as const,
            },
            permission: { editability: 'editable' as const },
          },
        ],
        rows: [
          {
            rowKey: 'sb-row-v1:abc',
            values: {
              '10000000-0000-4000-8000-000000000001': {
                kind: 'present',
                value: '11111111-1111-4111-8111-111111111111',
              },
            },
          },
        ],
      },
    } as unknown as ComposedSheetSnapshot
    const matrix = composedSheetGridMatrix(snapshot)
    expect(matrix.columns[0]).toMatchObject({
      label: 'Sample',
      presentation: { kind: 'record-picker' },
      editable: true,
    })
    expect(matrix.data).toEqual([['11111111-1111-4111-8111-111111111111']])
  })
})
