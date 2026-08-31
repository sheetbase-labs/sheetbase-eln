import { describe, expect, it } from 'vitest'

import {
  hasSavedSheetView,
  loadSheetView,
  sanitizeSheetPresentation,
  saveSheetView,
  sheetViewStorageKey,
} from './sheet-presentation-view'

const columnIds = new Set([
  '10000000-0000-4000-8000-000000000004',
  '10000000-0000-4000-8000-000000000005',
])

function fullPresentation() {
  return {
    columnOrder: [],
    hiddenColumnIds: [],
    columnWidths: {},
    frozenColumnCount: 0,
    density: 'standard' as const,
    filters: [],
    sorts: [],
  }
}

describe('sheet presentation saved views (GRID-04)', () => {
  it('saves and loads the presentation snapshot per instance', () => {
    const storage = memoryStorage()
    const presentation = {
      ...fullPresentation(),
      frozenColumnCount: 2,
      sorts: [
        {
          columnId: '10000000-0000-4000-8000-000000000004',
          direction: 'asc' as const,
        },
      ],
    }
    saveSheetView('instance-1', presentation, storage)
    expect(hasSavedSheetView('instance-1', storage)).toBe(true)
    expect(hasSavedSheetView('instance-2', storage)).toBe(false)
    expect(loadSheetView('instance-1', storage)).toMatchObject({
      frozenColumnCount: 2,
    })
  })

  it('keys storage by instance so views never leak across Sheets', () => {
    expect(sheetViewStorageKey('a')).toBe('sheetbase-sheet-view-v1:a')
  })

  it('returns null for corrupt or absent storage payloads', () => {
    const storage = memoryStorage()
    expect(loadSheetView('instance-1', storage)).toBeNull()
    storage.setItem(sheetViewStorageKey('instance-1'), '{not json')
    expect(loadSheetView('instance-1', storage)).toBeNull()
    storage.setItem(sheetViewStorageKey('instance-1'), '[]')
    expect(loadSheetView('instance-1', storage)).toBeNull()
  })

  it('tolerates unavailable storage on save and read', () => {
    const throwing = {
      ...memoryStorage(),
      setItem: () => {
        throw new Error('quota')
      },
      getItem: () => {
        throw new Error('blocked')
      },
    } as Storage
    expect(() =>
      saveSheetView('instance-1', fullPresentation(), throwing),
    ).not.toThrow()
    expect(loadSheetView('instance-1', throwing)).toBeNull()
  })
})

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => void map.set(key, String(value)),
  }
}

describe('sanitizeSheetPresentation (GRID-04)', () => {
  it('returns null for non-object payloads', () => {
    expect(sanitizeSheetPresentation(null, columnIds)).toBeNull()
    expect(sanitizeSheetPresentation('view', columnIds)).toBeNull()
    expect(sanitizeSheetPresentation([1], columnIds)).toBeNull()
  })

  it('drops persisted state that references unknown columns', () => {
    const unknown = '99999999-0000-4000-8000-000000000009'
    const sanitized = sanitizeSheetPresentation(
      {
        columnOrder: [
          '10000000-0000-4000-8000-000000000005',
          unknown,
          '10000000-0000-4000-8000-000000000004',
        ],
        hiddenColumnIds: [unknown],
        columnWidths: {
          '10000000-0000-4000-8000-000000000004': 240,
          [unknown]: 500,
        },
        frozenColumnCount: 3,
        density: 'compact',
        filters: [
          {
            columnId: unknown,
            operator: 'equals',
            value: 'kept-out',
          },
          {
            columnId: '10000000-0000-4000-8000-000000000004',
            operator: 'equals',
            value: 5,
          },
        ],
        sorts: [{ columnId: unknown, direction: 'desc' }],
      },
      columnIds,
    )
    expect(sanitized).toEqual({
      columnOrder: [
        '10000000-0000-4000-8000-000000000005',
        '10000000-0000-4000-8000-000000000004',
      ],
      hiddenColumnIds: [],
      columnWidths: { '10000000-0000-4000-8000-000000000004': 240 },
      frozenColumnCount: 3,
      density: 'compact',
      filters: [
        {
          columnId: '10000000-0000-4000-8000-000000000004',
          operator: 'equals',
          value: 5,
        },
      ],
      sorts: [],
    })
  })

  it('clamps widths and freeze counts to the canonical limits', () => {
    const sanitized = sanitizeSheetPresentation(
      {
        columnWidths: {
          '10000000-0000-4000-8000-000000000004': 99_999,
          '10000000-0000-4000-8000-000000000005': 12.5,
        },
        frozenColumnCount: 100_000,
      },
      columnIds,
    )
    expect(sanitized?.columnWidths).toEqual({
      '10000000-0000-4000-8000-000000000004': 2_000,
      '10000000-0000-4000-8000-000000000005': 40,
    })
    expect(sanitized?.frozenColumnCount).toBe(512)
  })

  it('drops malformed filters and sorts and deduplicates sorts', () => {
    const kept = '10000000-0000-4000-8000-000000000004'
    const sanitized = sanitizeSheetPresentation(
      {
        filters: [
          { columnId: kept, operator: 'equals' },
          { columnId: kept, operator: 'between', value: 1 },
          { columnId: kept, operator: 'is-empty' },
          { columnId: kept, operator: 'not-equals', value: 'x' },
        ],
        sorts: [
          { columnId: kept, direction: 'asc' },
          { columnId: kept, direction: 'desc' },
        ],
      },
      columnIds,
    )
    expect(sanitized?.filters).toEqual([
      { columnId: kept, operator: 'is-empty' },
      { columnId: kept, operator: 'not-equals', value: 'x' },
    ])
    expect(sanitized?.sorts).toEqual([{ columnId: kept, direction: 'asc' }])
  })

  it('falls back to standard density and empty bounded state', () => {
    const sanitized = sanitizeSheetPresentation(
      {
        columnOrder: 'nope',
        hiddenColumnIds: { bad: true },
        columnWidths: [],
        frozenColumnCount: 'two',
        density: 'gigantic',
      },
      columnIds,
    )
    expect(sanitized).toEqual({
      columnOrder: [],
      hiddenColumnIds: [],
      columnWidths: {},
      frozenColumnCount: 0,
      density: 'standard',
      filters: [],
      sorts: [],
    })
  })
})
