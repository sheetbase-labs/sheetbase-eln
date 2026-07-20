import { describe, expect, it } from 'vitest'
import {
  buildPersistedFormulaArtifact,
  emitFormula,
  FormulaSyntaxError,
  parseFormula,
  validatePersistedFormulaArtifact,
} from './formula-ir'
import {
  decodeScientificResult,
  encodeScientificLiteral,
} from './hyperformula-literals'
import {
  createSheetbaseHyperFormula,
  SHEETBASE_HF_CONFIG,
  SHEETBASE_PROFILE_FINGERPRINT,
} from './hyperformula-profile'
import { buildScientificWorkbook } from './scientific-workbook'

const tableId = '11111111-1111-4111-8111-111111111111'
const rowIds = [
  '21111111-1111-4111-8111-111111111111',
  '21111111-1111-4111-8111-111111111112',
  '21111111-1111-4111-8111-111111111113',
]
const columnIds = [
  '31111111-1111-4111-8111-111111111111',
  '31111111-1111-4111-8111-111111111112',
  '31111111-1111-4111-8111-111111111113',
]
const [r1, r2, r3] = rowIds
const [c1, c2, c3] = columnIds
const maps = { rowIds, columnIds }
const artifact = (source: string) => {
  const result = parseFormula(source, maps)
  if (result.status !== 'supported')
    throw new Error('expected supported formula')
  return result.artifact
}
const persisted = (source: string) => {
  const result = parseFormula(source, maps)
  return buildPersistedFormulaArtifact(result, tableId)
}

describe('restricted formula IR', () => {
  it('normalizes operators, approved calls, references, ranges, and anchors', () => {
    const parsed = artifact('=SUM($A$1:B2)+POWER(C3,2)')
    expect(parsed.source).toBe('=SUM($A$1:B2)+POWER(C3,2)')
    expect(parsed.bindings).toHaveLength(2)
    expect(parsed.bindings[0]).toMatchObject({
      kind: 'range',
      start: { columnAbsolute: true, rowAbsolute: true },
    })
    expect(parsed.engineExpression).toBe('=(SUM($A$1:B2)+POWER(C3,2))')
  })

  it.each(['=RAND()', '=NOW()', '=INDIRECT("A1")', '=ROW()'])(
    'retains unsupported %s distinctly',
    (source) => {
      const parsed = parseFormula(source, maps)
      expect(parsed.status).toBe('unsupported')
      expect(parsed.artifact).toMatchObject({ source, bindings: [] })
    },
  )

  it.each([
    '=OFFSET(A1,1,1)',
    '=VERSION()',
    '=A:A',
    '=1:2',
    '=A1:B2',
    '={1,2}',
    '=A1#',
    '=Sheet2!A1',
    '=name+1',
    '=SUM(A1,)',
    '=A0',
  ])('rejects unsafe or malformed %s', (source) => {
    expect(() => parseFormula(source, maps)).toThrow(FormulaSyntaxError)
  })

  it('keeps bindings stable rather than rebinding after reorder', () => {
    const parsed = artifact('=A1')
    expect(
      emitFormula(parsed, {
        rowIds: maps.rowIds,
        columnIds: [c2, c1, c3],
      }),
    ).toBe('=B1')
  })

  it('preserves reversed ranges and matches HyperFormula operator semantics', () => {
    expect(artifact('=SUM(B2:A1)').engineExpression).toBe('=SUM(B2:A1)')
    for (const [source, expected] of [
      ['=-2^2', 4],
      ['=2^-2', 0.25],
      ['=2^-2%', 0.98623270449],
      ['=2^+2%', 1.0139594798],
      ['=2^3^2', 64],
    ] as const) {
      const emitted = artifact(source).engineExpression
      const hf = createSheetbaseHyperFormula()
      hf.addSheet('source')
      hf.addSheet('emitted')
      const sourceSheet = hf.getSheetId('source')!
      const emittedSheet = hf.getSheetId('emitted')!
      hf.setCellContents({ sheet: sourceSheet, row: 0, col: 0 }, [[source]])
      hf.setCellContents({ sheet: emittedSheet, row: 0, col: 0 }, [[emitted]])
      expect(hf.getCellValue({ sheet: sourceSheet, row: 0, col: 0 })).toBe(
        expected,
      )
      expect(hf.getCellValue({ sheet: emittedSheet, row: 0, col: 0 })).toBe(
        expected,
      )
      hf.destroy()
    }
  })

  it('rejects repeated percent operators', () => {
    expect(() => parseFormula('=100%%', maps)).toThrow(FormulaSyntaxError)
  })

  it('validates calculated category values against active target options', () => {
    expect(
      decodeScientificResult('category', 'option-1', ['option-1']),
    ).toEqual({ ok: true, value: 'option-1' })
    expect(
      decodeScientificResult('category', 'retired-option', ['option-1']),
    ).toMatchObject({ ok: false, code: 'VALUE' })
  })

  it('validates exact recursive persisted artifacts', () => {
    const valid = persisted('=A1+SUM(B2:C3)')
    expect(validatePersistedFormulaArtifact(valid)).toBe(valid)
    expect(() =>
      validatePersistedFormulaArtifact({
        ...valid,
        bindings: [{ ...valid.bindings[0], slot: 1 }],
      }),
    ).toThrow(/binding slots/)
    expect(() =>
      validatePersistedFormulaArtifact({ ...valid, surprise: true }),
    ).toThrow(/fields/)
  })

  it('rejects formula constants that exceed the numeric precision profile', () => {
    expect(() => parseFormula('=1.234567890123456', maps)).toThrow(
      FormulaSyntaxError,
    )
  })
})

describe('literal profile', () => {
  it('forces formula-looking text/category and preserves null', () => {
    expect(encodeScientificLiteral('text', '=1+1')).toBe("'=1+1")
    expect(encodeScientificLiteral('category', 'TRUE')).toBe("'TRUE")
    expect(encodeScientificLiteral('text', null)).toBeNull()
  })
  it('rejects unsafe and over-precision numbers', () => {
    expect(() =>
      encodeScientificLiteral('integer', '9007199254740992'),
    ).toThrow()
    expect(() =>
      encodeScientificLiteral('decimal', '1.234567890123456'),
    ).toThrow()
  })
  it('round trips deterministic dates and UTC timestamps', () => {
    expect(
      decodeScientificResult(
        'date',
        encodeScientificLiteral('date', '2024-02-29') as number,
      ),
    ).toEqual({ ok: true, value: '2024-02-29' })
    expect(
      decodeScientificResult(
        'timestamp',
        encodeScientificLiteral(
          'timestamp',
          '2024-01-01T01:00:00+01:00',
        ) as number,
      ),
    ).toEqual({ ok: true, value: '2024-01-01T00:00:00.000Z' })
    expect(() =>
      encodeScientificLiteral('timestamp', '2024-01-01T00:00:00+24:00'),
    ).toThrow(/offset/)
  })
})

describe('scientific workbook', () => {
  const build = () =>
    buildScientificWorkbook([
      {
        id: tableId,
        columns: [
          { id: c1, createdAt: '2024-01-01', logicalType: 'decimal' },
          { id: c2, createdAt: '2024-01-02', logicalType: 'decimal' },
          { id: c3, createdAt: '2024-01-03', logicalType: 'text' },
        ],
        rows: [
          {
            id: r1,
            createdAt: '2024-01-01',
            cells: {
              [c1]: { literal: 2 },
              [c2]: { formula: persisted('=A1*3') },
              [c3]: { literal: '=SUM(9)' },
            },
          },
          {
            id: r2,
            createdAt: '2024-01-02',
            cells: {
              [c1]: { literal: null },
              [c2]: { formula: persisted('=1/0') },
            },
          },
          {
            id: r3,
            createdAt: '2024-01-03',
            cells: {
              [c1]: { formula: persisted('=A3') },
              [c2]: { formula: persisted('=A3') },
            },
          },
        ],
      },
    ])

  it('calculates arithmetic, preserves literal text, blanks, errors and cycles', () => {
    const workbook = build()
    expect(workbook.get({ tableId, rowId: r1, columnId: c2 })).toMatchObject({
      status: 'formula',
      value: 6,
      source: '=A1*3',
    })
    expect(workbook.get({ tableId, rowId: r1, columnId: c3 })).toMatchObject({
      value: '=SUM(9)',
    })
    expect(workbook.get({ tableId, rowId: r2, columnId: c1 })).toMatchObject({
      value: null,
    })
    expect(workbook.get({ tableId, rowId: r2, columnId: c2 })).toMatchObject({
      status: 'error',
      error: 'DIV_BY_ZERO',
    })
    expect(workbook.get({ tableId, rowId: r3, columnId: c1 })).toMatchObject({
      status: 'error',
      error: 'CYCLE',
    })
    workbook.destroy()
  })

  it('rebuilds deterministically and supports edit adapter changes', () => {
    const one = build(),
      two = build()
    expect(one.get({ tableId, rowId: r1, columnId: c2 })).toEqual(
      two.get({ tableId, rowId: r1, columnId: c2 }),
    )
    const changes = one.setLiteral({ tableId, rowId: r1, columnId: c1 }, 4)
    expect(
      one
        .getChangedResults(changes)
        .some(
          (item) =>
            item.result.status === 'formula' &&
            'value' in item.result &&
            item.result.value === 12,
        ),
    ).toBe(true)
    one.destroy()
    two.destroy()
  })

  it('keeps unsupported reloads durable without installing them', () => {
    const formula = persisted('=RAND()')
    const workbook = buildScientificWorkbook([
      {
        id: tableId,
        columns: [{ id: c1, createdAt: '2024-01-01', logicalType: 'decimal' }],
        rows: [
          {
            id: r1,
            createdAt: '2024-01-01',
            cells: { [c1]: { literal: 7, formula } },
          },
        ],
      },
    ])
    expect(workbook.get({ tableId, rowId: r1, columnId: c1 })).toMatchObject({
      status: 'formula',
      source: '=RAND()',
      engineFormula: undefined,
      value: 7,
    })
    workbook.destroy()
  })

  it('rejects malformed persisted artifacts during reload', () => {
    expect(() =>
      buildScientificWorkbook([
        {
          id: tableId,
          columns: [
            { id: c1, createdAt: '2024-01-01', logicalType: 'decimal' },
          ],
          rows: [
            {
              id: r1,
              createdAt: '2024-01-01',
              cells: { [c1]: { formula: { version: 1 } } },
            },
          ],
        },
      ]),
    ).toThrow(/Invalid persisted formula/)
  })
})

it('pins explicit profile configuration and a stable fingerprint', () => {
  expect(SHEETBASE_HF_CONFIG).toMatchObject({
    licenseKey: 'gpl-v3',
    language: 'enUS',
    maxRows: 10_000,
    maxColumns: 256,
    functionPlugins: [],
  })
  expect(Object.isFrozen(SHEETBASE_HF_CONFIG)).toBe(true)
  expect(SHEETBASE_PROFILE_FINGERPRINT).toMatch(/^fnv1a32-[0-9a-f]{8}$/)
})
