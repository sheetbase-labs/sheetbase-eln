import { describe, expect, it } from 'vitest'

import {
  buildFlagIndex,
  excludeFlaggedValues,
  flagKey,
  isValueFlagged,
  toDatasetValueFlag,
} from './dataset-flags'
import type { DatasetValueFlag } from './dataset-flags'

function flag(overrides: Partial<DatasetValueFlag> = {}): DatasetValueFlag {
  return {
    id: 'f1',
    datasetId: 'd1',
    rowId: 'r1',
    fieldId: 'titre',
    kind: 'out_of_range',
    reason: 'Above top standard',
    comment: null,
    setAt: '2026-09-25T09:40:00Z',
    ...overrides,
  }
}

describe('toDatasetValueFlag', () => {
  it('maps the wire row', () => {
    const mapped = toDatasetValueFlag({
      id: 'f1',
      dataset_id: 'd1',
      row_id: 'r1',
      field_id: 'titre',
      kind: 'high_cv',
      reason: 'CV 24%',
      comment: 'repeat queued',
      set_at: '2026-09-25T09:40:00Z',
      cleared_at: null,
    })
    expect(mapped).toMatchObject({
      id: 'f1',
      datasetId: 'd1',
      rowId: 'r1',
      fieldId: 'titre',
      kind: 'high_cv',
      comment: 'repeat queued',
    })
  })
})

describe('excluding flagged values', () => {
  const index = buildFlagIndex([
    flag({ rowId: 'r2', fieldId: 'titre' }),
    flag({ id: 'f2', rowId: 'r3', fieldId: 'viability', kind: 'missing_unit' }),
  ])

  it('reports whether a value is flagged', () => {
    expect(isValueFlagged(index, 'r2', 'titre')).toBe(true)
    expect(isValueFlagged(index, 'r1', 'titre')).toBe(false)
    expect(flagKey('r1', 'titre')).toBe('r1:titre')
  })

  it('drops rows with a flagged value and reports them', () => {
    const rows = [
      { id: 'r1', titre: 1 },
      { id: 'r2', titre: 2 },
      { id: 'r3', titre: 3 },
    ]
    const { rows: kept, excluded } = excludeFlaggedValues(
      rows,
      index,
      (row) => row.id,
      'titre',
    )
    expect(kept.map((row) => row.id)).toEqual(['r1', 'r3'])
    expect(excluded).toEqual([
      { rowId: 'r2', fieldId: 'titre', flag: index.get('r2:titre') },
    ])
  })
})
