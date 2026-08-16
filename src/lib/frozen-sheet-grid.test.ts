import { describe, expect, it } from 'vitest'

import {
  frozenSheetGridFromEvidence,
  frozenSheetGridFromState,
} from './frozen-sheet-grid'

const fieldId = '10000000-0000-4000-8000-000000000004'
const hiddenId = '10000000-0000-4000-8000-000000000006'
const rowId = '10000000-0000-4000-8000-000000000005'

describe('frozenSheetGridFromState', () => {
  it('builds labelled columns and cell values without exposing field UUIDs as headers', () => {
    const grid = frozenSheetGridFromState({
      localFields: [
        {
          fieldId,
          key: 'observation',
          label: 'Observation',
        },
        {
          fieldId: hiddenId,
          key: 'hidden',
          label: 'Hidden',
        },
      ],
      localValues: {
        [rowId]: { [fieldId]: 'independent value', [hiddenId]: 'secret' },
      },
      presentation: {
        columnOrder: [fieldId, hiddenId],
        hiddenColumnIds: [hiddenId],
      },
    })
    expect(grid.columns).toEqual([{ id: fieldId, label: 'Observation' }])
    expect(grid.rows).toEqual([['independent value']])
    expect(grid.columns[0]?.label).not.toContain('10000000')
  })

  it('returns an empty grid when the snapshot has no local fields', () => {
    expect(frozenSheetGridFromState({})).toEqual({ columns: [], rows: [] })
  })

  it('prefers a stored composed grid over live-local reconstruction', () => {
    const grid = frozenSheetGridFromEvidence({
      instanceState: {
        localFields: [{ fieldId, key: 'observation', label: 'Observation' }],
        localValues: { [rowId]: { [fieldId]: 'later local' } },
      },
      composedGrid: {
        columns: [{ id: fieldId, label: 'Sample' }],
        rows: [['frozen-sample']],
      },
    })
    expect(grid).toEqual({
      columns: [{ id: fieldId, label: 'Sample' }],
      rows: [['frozen-sample']],
    })
  })
})
