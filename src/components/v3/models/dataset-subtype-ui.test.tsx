import { describe, expect, it } from 'vitest'

import { tableAncestors, tableParentChoices } from './dataset-subtype-ui'

const tables = [
  { id: 'vicell', name: 'ViCell', parentId: null },
  { id: 'blu', name: 'ViCell BLU', parentId: 'vicell' },
  { id: 'blu_fast', name: 'ViCell BLU fast', parentId: 'blu' },
  { id: 'hplc', name: 'HPLC', parentId: null },
]

describe('measurement table subtypes', () => {
  it('walks up the chain, nearest first', () => {
    expect(tableAncestors(tables, 'blu_fast').map((t) => t.id)).toEqual([
      'blu',
      'vicell',
    ])
    expect(tableAncestors(tables, 'hplc')).toEqual([])
  })

  it('never offers a table or its own subtypes as its parent', () => {
    expect(tableParentChoices(tables, 'vicell').map((t) => t.id)).toEqual([
      'hplc',
    ])
    expect(tableParentChoices(tables, 'blu_fast').map((t) => t.id)).toEqual([
      'vicell',
      'blu',
      'hplc',
    ])
  })
})
