import { describe, expect, it } from 'vitest'

import {
  actionsFor,
  boxesInScope,
  matchBoxCode,
  sortItems,
  stocktakeReference,
  summariseItems,
  toStocktakeItem,
} from './stocktake'
import type { StocktakeItem, StocktakeItemWire } from './stocktake'
import { buildStorageTree } from './storage-locations'
import type { StorageNode } from './storage-locations'

function wire(over: Partial<StocktakeItemWire>): StocktakeItemWire {
  return {
    id: over.id ?? 'i1',
    stocktake_id: 's1',
    record_id: over.record_id ?? 'r1',
    identifier: over.identifier ?? 'SMP-0001',
    title: 'Tube',
    record_kind: 'sample',
    expected: true,
    state: 'expected',
    expected_box_id: null,
    expected_path: null,
    found_box_id: null,
    found_path: null,
    scanned_at: null,
    resolution: null,
    resolution_note: null,
    resolved_at: null,
    ...over,
  }
}

const item = (over: Partial<StocktakeItemWire>): StocktakeItem =>
  toStocktakeItem(wire(over))

function node(
  level: StorageNode['level'],
  id: string,
  parentId: string | null,
  name: string,
  code: string | null = null,
): StorageNode {
  return {
    level,
    id,
    parentId,
    name,
    code,
    position: null,
    unitType: null,
    temperatureMinC: null,
    temperatureMaxC: null,
    rows: level === 'box' ? 3 : null,
    cols: level === 'box' ? 3 : null,
    archivedAt: null,
    held: 0,
  }
}

describe('stocktake helpers', () => {
  it('writes a count number the way people quote it', () => {
    expect(stocktakeReference(7)).toBe('ST-0007')
  })

  it('summarises a count and what is left to fix', () => {
    const summary = summariseItems([
      item({ id: 'a', state: 'confirmed' }),
      item({ id: 'b', state: 'confirmed' }),
      item({ id: 'c', state: 'misplaced' }),
      item({
        id: 'd',
        state: 'unexpected',
        resolved_at: '2026-11-04T10:00:00Z',
      }),
      item({ id: 'e', state: 'missing' }),
      item({ id: 'f', state: 'expected' }),
    ])

    expect(summary).toMatchObject({
      total: 6,
      confirmed: 2,
      misplaced: 1,
      unexpected: 1,
      missing: 1,
      remaining: 1,
      resolved: 1,
      toFix: 2,
    })
  })

  it('offers the fixes the database allows', () => {
    expect(actionsFor(item({ state: 'misplaced' }))).toEqual([
      'refile',
      'returned',
      'accept',
    ])
    expect(actionsFor(item({ state: 'missing' }))).toEqual([
      'mark_lost',
      'accept',
    ])
    expect(
      actionsFor(item({ state: 'missing', record_kind: 'material' })),
    ).toEqual(['clear_location', 'accept'])
    expect(actionsFor(item({ state: 'confirmed' }))).toEqual([])
    expect(
      actionsFor(
        item({ state: 'missing', resolved_at: '2026-11-04T10:00:00Z' }),
      ),
    ).toEqual([])
  })

  it('lists differences before confirmed items', () => {
    const order = sortItems([
      item({ id: 'a', identifier: 'SMP-0001', state: 'confirmed' }),
      item({ id: 'b', identifier: 'SMP-0002', state: 'missing' }),
      item({ id: 'c', identifier: 'SMP-0010', state: 'misplaced' }),
      item({ id: 'd', identifier: 'SMP-0003', state: 'misplaced' }),
    ]).map((i) => i.id)

    expect(order).toEqual(['b', 'd', 'c', 'a'])
  })

  it('finds the boxes inside a counted place and matches a box label', () => {
    const tree = buildStorageTree([
      node('site', 's', null, 'Lab'),
      node('room', 'r', 's', 'Room 1'),
      node('unit', 'u', 'r', 'Freezer F-9'),
      node('shelf', 'sh', 'u', 'Shelf 1'),
      node('rack', 'rk', 'sh', 'Rack A'),
      node('box', 'b1', 'rk', 'Box 1', 'B1'),
      node('box', 'b2', 'rk', 'Box 2', 'B2'),
      node('rack', 'rk2', 'sh', 'Rack B'),
      node('box', 'b3', 'rk2', 'Box 3', 'B3'),
    ])

    const rackA = boxesInScope(tree, { scopeId: 'rk', scopeLevel: 'rack' })
    expect(rackA.map((b) => b.id)).toEqual(['b1', 'b2'])
    expect(rackA[0].path).toBe(
      'Lab / Room 1 / Freezer F-9 / Shelf 1 / Rack A / Box 1',
    )
    expect(
      boxesInScope(tree, { scopeId: 'u', scopeLevel: 'unit' }),
    ).toHaveLength(3)
    expect(matchBoxCode(rackA, ' b2 ')?.id).toBe('b2')
    expect(matchBoxCode(rackA, 'box 1')?.id).toBe('b1')
    expect(matchBoxCode(rackA, 'B3')).toBeNull()
    expect(matchBoxCode(rackA, '')).toBeNull()
  })
})
