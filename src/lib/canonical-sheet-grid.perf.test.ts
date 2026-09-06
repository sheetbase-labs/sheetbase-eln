import { describe, expect, it } from 'vitest'

import {
  applySheetPresentation,
  canonicalSheetGridMatrix,
  hotFiltersToPresentationFilters,
  preserveHiddenColumnFilters,
  presentationFiltersToHotAdditions,
} from './canonical-sheet-grid'
import type { HotFilterConditionStack } from './canonical-sheet-grid'
import type { ComposedSheetSnapshot } from './sheet-composition-data'
import type { SheetInstance } from './sheet-instance-data'
import type { SheetPresentation } from './sheet-instance'
import { validSheetInstanceState } from './sheet-instance.test'

// GRID-05 performance budgets: a synthetic 5k-row bound projection exercises
// the matrix build and the hot filter helpers. Measured on Apple M2 Pro
// (matrix ~10ms, presentation ~1.5ms, filter round-trip ~0.25ms); budgets
// hold ~20-200x headroom for CI noise while failing a genuine algorithmic
// regression.
const ROW_COUNT = 5_000
const COLUMN_COUNT = 8

const MATRIX_BUDGET_MS = 200
const PRESENTATION_BUDGET_MS = 100
const FILTER_BUDGET_MS = 50

function columnId(index: number): string {
  return `30000000-0000-4000-8000-${String(index).padStart(12, '0')}`
}

function largeSnapshot(): ComposedSheetSnapshot {
  const columns = Array.from({ length: COLUMN_COUNT }, (_, column) => ({
    id: columnId(column),
    label: `Column ${column}`,
    presentation: { kind: 'text', inputType: 'text' },
    permission: { editability: 'editable' },
  }))
  const rows = Array.from({ length: ROW_COUNT }, (_, row) => ({
    rowKey: `sb-row-v1:row-${row}`,
    values: Object.fromEntries(
      columns.map((column, cell) => [
        column.id,
        { kind: 'present', value: `v${row}-${cell}` },
      ]),
    ),
  }))
  return {
    boundProjection: { columns, rows },
  } as unknown as ComposedSheetSnapshot
}

function largeInstance(): SheetInstance {
  return {
    id: '20000000-0000-4000-8000-000000000001',
    state: { ...validSheetInstanceState(), localValues: {} },
  } as unknown as SheetInstance
}

describe('GRID-05 canonical grid performance budgets', () => {
  it('builds the canonical matrix within budget', () => {
    const start = performance.now()
    const matrix = canonicalSheetGridMatrix({
      instance: largeInstance(),
      composition: largeSnapshot(),
    })
    const elapsed = performance.now() - start
    console.log(`canonicalSheetGridMatrix 5k x 8: ${elapsed.toFixed(1)}ms`)
    expect(matrix.rowKeys).toHaveLength(ROW_COUNT)
    expect(matrix.data).toHaveLength(ROW_COUNT)
    expect(matrix.data[0]).toHaveLength(COLUMN_COUNT + 1)
    expect(matrix.data[1234]?.[3]).toBe('v1234-3')
    expect(elapsed).toBeLessThan(MATRIX_BUDGET_MS)
  })

  it('applies the presentation projection within budget', () => {
    const matrix = canonicalSheetGridMatrix({
      instance: largeInstance(),
      composition: largeSnapshot(),
    })
    const presentation = {
      columnOrder: [columnId(7), columnId(0)],
      hiddenColumnIds: [columnId(1)],
      columnWidths: {},
      frozenColumnCount: 0,
      filters: [],
      sorts: [],
    } as unknown as SheetPresentation
    const start = performance.now()
    const projected = applySheetPresentation(matrix, presentation)
    const elapsed = performance.now() - start
    console.log(`applySheetPresentation 5k x 8: ${elapsed.toFixed(1)}ms`)
    expect(projected.columns.map((column) => column.id)).toEqual([
      columnId(7),
      columnId(0),
      columnId(2),
      columnId(3),
      columnId(4),
      columnId(5),
      columnId(6),
      '10000000-0000-4000-8000-000000000004',
    ])
    expect(projected.data).toHaveLength(ROW_COUNT)
    expect(elapsed).toBeLessThan(PRESENTATION_BUDGET_MS)
  })

  it('round-trips a full filter stack within budget', () => {
    const columns = Array.from({ length: COLUMN_COUNT }, (_, column) => ({
      id: columnId(column),
    }))
    const stack: HotFilterConditionStack[] = columns.flatMap((_, column) => [
      { column, conditions: [{ name: 'eq', args: [`v${column}`] }] },
      { column, conditions: [{ name: 'not_empty', args: [] }] },
      { column, conditions: [{ name: 'empty', args: [] }] },
      { column, conditions: [{ name: 'true', args: [] }] },
    ])
    const start = performance.now()
    const captured = hotFiltersToPresentationFilters(stack, columns)
    const additions = presentationFiltersToHotAdditions(captured, columns)
    const preserved = preserveHiddenColumnFilters(
      captured.slice(0, 8),
      captured,
      columns,
      columns.slice(0, 4),
    )
    const elapsed = performance.now() - start
    console.log(`filter capture/restore 32-stack: ${elapsed.toFixed(3)}ms`)
    expect(captured).toHaveLength(32)
    expect(additions).toHaveLength(32)
    expect(preserved).toHaveLength(24)
    expect(elapsed).toBeLessThan(FILTER_BUDGET_MS)
  })
})
