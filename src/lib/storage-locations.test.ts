import { describe, expect, it, vi } from 'vitest'

import {
  EMPTY_NODE_INPUT,
  buildStorageTree,
  createStorageNode,
  formatNodePath,
  isArchived,
  locationSuggestions,
  nodeFromRow,
  setStorageNodeArchived,
  suggestCode,
  validateNodeInput,
} from './storage-locations'
import type { DataClient } from './data-client'

function tree() {
  const nodes = [
    nodeFromRow('site', {
      id: 's1',
      name: 'Cambridge lab',
      code: 'CAM',
      archived_at: null,
    }),
    nodeFromRow('room', {
      id: 'r1',
      site_id: 's1',
      name: 'Lab 2',
      code: 'L2',
      archived_at: null,
    }),
    nodeFromRow('unit', {
      id: 'u1',
      room_id: 'r1',
      name: 'Freezer F-1',
      code: 'F-1',
      unit_type: 'freezer',
      temperature_min_c: '-85',
      temperature_max_c: '-75',
      archived_at: null,
    }),
    nodeFromRow('shelf', {
      id: 'sh1',
      unit_id: 'u1',
      name: 'Shelf 1',
      position: 1,
      archived_at: null,
    }),
    nodeFromRow('rack', {
      id: 'k1',
      shelf_id: 'sh1',
      name: 'Rack A',
      position: 1,
      archived_at: null,
    }),
    nodeFromRow('box', {
      id: 'b1',
      rack_id: 'k1',
      name: 'Box 3',
      code: 'BX-3',
      rows: 9,
      cols: 9,
      archived_at: null,
    }),
    nodeFromRow('box', {
      id: 'b2',
      rack_id: 'k1',
      name: 'Box 10',
      code: 'BX-10',
      rows: 9,
      cols: 9,
      archived_at: null,
    }),
    nodeFromRow('box', {
      id: 'b3',
      rack_id: 'k1',
      name: 'Box 4',
      code: 'BX-4',
      rows: 9,
      cols: 9,
      archived_at: '2026-10-01T00:00:00Z',
    }),
  ]
  return buildStorageTree(
    nodes,
    new Map([
      ['b1', 3],
      ['b2', 1],
    ]),
  )
}

describe('buildStorageTree', () => {
  it('rolls held samples up to every location above the box', () => {
    const t = tree()
    expect(t.byId.get('b1')?.held).toBe(3)
    expect(t.byId.get('k1')?.held).toBe(4)
    expect(t.byId.get('u1')?.held).toBe(4)
    expect(t.byId.get('s1')?.held).toBe(4)
  })

  it('orders siblings by position, then by name with numbers in order', () => {
    const t = tree()
    expect(t.childrenOf(t.byId.get('k1')!).map((n) => n.name)).toEqual([
      'Box 3',
      'Box 4',
      'Box 10',
    ])
  })

  it('writes a location the way a sample records it', () => {
    const t = tree()
    expect(formatNodePath(t, t.byId.get('b1')!)).toBe(
      'Cambridge lab / Lab 2 / Freezer F-1 / Shelf 1 / Rack A / Box 3',
    )
  })
})

describe('locationSuggestions', () => {
  it('offers boxes that are not archived, sorted', () => {
    expect(locationSuggestions(tree())).toEqual([
      'Cambridge lab / Lab 2 / Freezer F-1 / Shelf 1 / Rack A / Box 3',
      'Cambridge lab / Lab 2 / Freezer F-1 / Shelf 1 / Rack A / Box 10',
    ])
  })

  it('leaves out boxes under an archived freezer', () => {
    const nodes = tree().nodes.map((n) =>
      n.id === 'u1' ? { ...n, archivedAt: '2026-10-01T00:00:00Z' } : n,
    )
    const t = buildStorageTree(nodes)
    expect(isArchived(t, t.byId.get('b1')!)).toBe(true)
    expect(locationSuggestions(t)).toEqual([])
  })
})

describe('validateNodeInput', () => {
  const valid = { ...EMPTY_NODE_INPUT, name: 'Lab 2', code: 'L2' }
  it('accepts a named, coded room', () => {
    expect(validateNodeInput('room', valid, false)).toBeNull()
  })
  it('asks for a name and a code', () => {
    expect(validateNodeInput('room', { ...valid, name: ' ' }, false)).toMatch(
      /name/,
    )
    expect(validateNodeInput('room', { ...valid, code: '' }, false)).toMatch(
      /code/,
    )
  })
  it('checks the temperature range', () => {
    expect(
      validateNodeInput(
        'unit',
        { ...valid, temperatureMinC: '8', temperatureMaxC: '2' },
        false,
      ),
    ).toMatch(/above the highest/)
    expect(
      validateNodeInput('unit', { ...valid, temperatureMinC: 'cold' }, false),
    ).toMatch(/numbers/)
  })
  it('limits a new box to 26 rows and columns, but not an existing one', () => {
    expect(
      validateNodeInput('box', { ...valid, rows: '30', cols: '9' }, false),
    ).toMatch(/rows/)
    expect(
      validateNodeInput('box', { ...valid, rows: '30', cols: '9' }, true),
    ).toBeNull()
  })
  it('does not ask a shelf for a code', () => {
    expect(
      validateNodeInput(
        'shelf',
        { ...EMPTY_NODE_INPUT, name: 'Shelf 1' },
        false,
      ),
    ).toBeNull()
  })
})

describe('suggestCode', () => {
  it('upper-cases and dashes a name', () => {
    expect(suggestCode('Cold room 1')).toBe('COLD-ROOM-1')
    expect(suggestCode('  -80 °C freezer ')).toBe('80-C-FREEZER')
  })
})

describe('writes', () => {
  function client() {
    return {
      insert: vi.fn().mockResolvedValue({}),
      rpc: vi.fn().mockResolvedValue({}),
      patch: vi.fn().mockResolvedValue([]),
    } as unknown as DataClient & {
      insert: ReturnType<typeof vi.fn>
      rpc: ReturnType<typeof vi.fn>
      patch: ReturnType<typeof vi.fn>
    }
  }
  const t = tree()

  it('makes a box through the function that also makes its positions', async () => {
    const c = client()
    await createStorageNode(
      c,
      'ws',
      'box',
      t.byId.get('k1')!,
      {
        ...EMPTY_NODE_INPUT,
        name: 'Box 5',
        code: 'BX-5',
        rows: '8',
        cols: '12',
      },
      1,
    )
    expect(c.rpc).toHaveBeenCalledWith('create_storage_box', {
      p_workspace_id: 'ws',
      p_rack_id: 'k1',
      p_name: 'Box 5',
      p_code: 'BX-5',
      p_rows: 8,
      p_cols: 12,
    })
    expect(c.insert).not.toHaveBeenCalled()
  })

  it('adds a freezer under its room with its type and temperatures', async () => {
    const c = client()
    await createStorageNode(
      c,
      'ws',
      'unit',
      t.byId.get('r1')!,
      {
        ...EMPTY_NODE_INPUT,
        name: 'Freezer F-2',
        code: 'F-2',
        unitType: 'cryo',
        temperatureMinC: '-196',
        temperatureMaxC: '-150',
      },
      1,
    )
    expect(c.insert).toHaveBeenCalledWith('storage_units', {
      workspace_id: 'ws',
      room_id: 'r1',
      name: 'Freezer F-2',
      code: 'F-2',
      unit_type: 'cryo',
      temperature_min_c: -196,
      temperature_max_c: -150,
    })
  })

  it('numbers a new shelf after its siblings', async () => {
    const c = client()
    await createStorageNode(
      c,
      'ws',
      'shelf',
      t.byId.get('u1')!,
      { ...EMPTY_NODE_INPUT, name: 'Shelf 2' },
      2,
    )
    expect(c.insert).toHaveBeenCalledWith('storage_shelves', {
      workspace_id: 'ws',
      unit_id: 'u1',
      name: 'Shelf 2',
      position: 2,
    })
  })

  it('archives by stamping archived_at, never by deleting', async () => {
    const c = client()
    await setStorageNodeArchived(c, t.byId.get('b1')!, true)
    expect(c.patch).toHaveBeenCalledWith(
      'storage_boxes',
      '?id=eq.b1',
      expect.objectContaining({ archived_at: expect.any(String) }),
    )
    await setStorageNodeArchived(c, t.byId.get('b1')!, false)
    expect(c.patch).toHaveBeenLastCalledWith('storage_boxes', '?id=eq.b1', {
      archived_at: null,
    })
  })
})
