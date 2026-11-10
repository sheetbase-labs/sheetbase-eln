import { afterEach, describe, expect, it } from 'vitest'
import { validatePersistedFormulaArtifact } from '#/lib/formula-ir'
import {
  scientificRowSchema,
  scientificTableSchema,
} from '#/lib/scientific-sheet-data'
import { buildScientificWorkbook } from '#/lib/scientific-workbook'
import {
  cachePersistedFormula,
  persistedFormula,
} from './scientific-sheet-formulas'
import {
  formulaErrorDisplay,
  readColumnOrder,
  readColumnWidths,
  safeWorkbookGet,
  writeColumnPreferences,
} from './scientific-sheet-presentation'

const table = scientificTableSchema.parse({
  id: '10000000-0000-4000-8000-000000000001',
  name: 'Results',
  resource_name: 'sheet_results',
  schema_version: 1,
  lifecycle: 'active',
  columns: [
    '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000003',
  ].map((id, index) => ({
    id,
    field_name: `value${index}`,
    label: `Value ${index}`,
    display_order: index,
    logical_type: 'decimal',
    nullable: true,
    unit: null,
    validation: {},
    width: 120,
    options: [],
  })),
})

const rows = [
  scientificRowSchema.parse({
    id: '10000000-0000-4000-8000-000000000004',
    version: 1,
    value0: 3,
  }),
]

const target = {
  tableId: table.id,
  rowId: rows[0].id,
  columnId: table.columns[1].id,
}

afterEach(() => localStorage.clear())

describe('scientific sheet formula cache', () => {
  it('constructs a real stable-identity artifact instead of a null template', () => {
    const next = cachePersistedFormula({
      previous: [],
      target,
      source: '=A1**2',
      table,
      rows,
      workbook: null,
    })

    expect(next).toHaveLength(1)
    const artifact = validatePersistedFormulaArtifact(persistedFormula(next[0]))
    expect(artifact.source).toBe('=A1^2')
    expect(artifact.dependencies).toEqual([
      { tableId: table.id, rowId: rows[0].id, columnId: table.columns[0].id },
    ])

    const workbook = buildScientificWorkbook([
      {
        id: table.id,
        name: table.name,
        columns: table.columns.map((column) => ({
          id: column.id,
          createdAt: '2026-01-01',
          logicalType: column.logical_type,
        })),
        rows: [
          {
            id: rows[0].id,
            createdAt: '2026-01-01',
            cells: {
              [table.columns[0].id]: { literal: 3 },
              [target.columnId]: { formula: artifact },
            },
          },
        ],
      },
    ])

    try {
      expect(safeWorkbookGet(workbook, target)).toMatchObject({
        status: 'formula',
        value: 9,
      })
      expect(
        safeWorkbookGet(workbook, { ...target, rowId: 'not-yet-rebuilt' }),
      ).toBeNull()
    } finally {
      workbook.destroy()
    }
  })

  it('does not turn an unavailable local cross-sheet map into a failed durable write', () => {
    const previous = cachePersistedFormula({
      previous: [],
      target,
      source: '=A1',
      table,
      rows,
      workbook: null,
    })

    expect(
      cachePersistedFormula({
        previous,
        target,
        source: "='Other sheet'!A1",
        table,
        rows,
        workbook: null,
      }),
    ).toBe(previous)
    expect(
      cachePersistedFormula({
        previous,
        target,
        source: null,
        table,
        rows,
        workbook: null,
      }),
    ).toEqual([])
  })

  it('keeps captured range membership and error display codes', () => {
    const next = cachePersistedFormula({
      previous: [],
      target,
      source: '=SUM(A1:A1)',
      table,
      rows,
      workbook: null,
    })

    const artifact = validatePersistedFormulaArtifact(persistedFormula(next[0]))
    expect(artifact.bindings[0]).toMatchObject({
      kind: 'range',
      members: [[{ rowId: rows[0].id, columnId: table.columns[0].id }]],
    })
    expect(formulaErrorDisplay('DIV_BY_ZERO')).toBe('#DIV/0!')
    expect(formulaErrorDisplay('unrecognized')).toBe('#ERROR!')
  })
})

describe('scientific sheet storage boundary', () => {
  it('rejects malformed widths, non-finite JSON and non-string order entries', () => {
    localStorage.setItem('widths', '{"column":"wide"}')
    expect(readColumnWidths('widths')).toEqual({})
    localStorage.setItem('widths', '{"column":1e400}')
    expect(readColumnWidths('widths')).toEqual({})
    localStorage.setItem('order', '["column", 12]')
    expect(readColumnOrder('order')).toEqual([])
    localStorage.setItem('order', '{')
    expect(readColumnOrder('order')).toEqual([])
  })

  it('preserves an own __proto__ scientific key through read and write', () => {
    localStorage.setItem('widths', '{"__proto__":180,"column":120}')
    const widths = readColumnWidths('widths')
    expect(Object.hasOwn(widths, '__proto__')).toBe(true)
    expect(widths.__proto__).toBe(180)
    writeColumnPreferences('roundtrip', widths)
    expect(readColumnWidths('roundtrip')).toEqual(widths)
    writeColumnPreferences('order', ['__proto__', 'column'])
    expect(readColumnOrder('order')).toEqual(['__proto__', 'column'])
  })
})
