// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  SHEETBASE_TABLE_ENGINE_VERSION,
  SHEETBASE_PROFILE_FINGERPRINT,
} from './formula-profile'

import { buildPersistedFormulaArtifact, parseFormula } from './formula-ir'
import {
  buildScientificWorkbook,
  scientificSheetName,
} from './scientific-workbook'
import type { WorkbookTable } from './scientific-workbook'
import {
  decodeScientificResult,
  encodeScientificLiteral,
  normalizeEngineScalar,
} from './scientific-literals'

/**
 * COMP-06.4 — the server's calculation contract on the `sheetbase-table` engine
 * (ADR-0048 option (b)). These cases pin the behaviour the server and its
 * trusted writer depend on: stable-identity addressing, typed results, the
 * persisted error codes and the serial date codec.
 */

const tableId = '11111111-1111-4111-8111-111111111111'

it('records the installed engine without relabelling historical semantic profiles', () => {
  const manifest = JSON.parse(
    readFileSync(
      new URL(
        '../../node_modules/@sheetbase-labs/sheetbase-table/package.json',
        import.meta.url,
      ),
      'utf8',
    ),
  )

  expect(SHEETBASE_TABLE_ENGINE_VERSION).toBe(manifest.version)
  expect(SHEETBASE_PROFILE_FINGERPRINT).toBe('fnv1a32-dcfa915f')
})

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

const persisted = (source: string) =>
  buildPersistedFormulaArtifact(parseFormula(source, maps), tableId)

const decimal = (id: string, createdAt: string) => ({
  id,
  createdAt,
  logicalType: 'decimal' as const,
})

function table(
  cells: WorkbookTable['rows'][number]['cells'][] = [],
): WorkbookTable {
  return {
    id: tableId,
    columns: [
      decimal(c1, '2024-01-01'),
      decimal(c2, '2024-01-02'),
      { id: c3, createdAt: '2024-01-03', logicalType: 'text' },
    ],
    rows: rowIds.map((id, index) => ({
      id,
      createdAt: `2024-01-0${index + 1}`,
      cells: cells[index] ?? {},
    })),
  }
}

describe('scientific workbook on the sheetbase-table engine', () => {
  it('calculates arithmetic and preserves literal text, blanks and errors', () => {
    const workbook = buildScientificWorkbook([
      table([
        { [c1]: { literal: 3 }, [c2]: { formula: persisted('=A1*2') } },
        { [c1]: { literal: null }, [c2]: { formula: persisted('=1/0') } },
        { [c1]: { formula: persisted('=A3') }, [c3]: { literal: '=SUM(9)' } },
      ]),
    ])

    expect(workbook.get({ tableId, rowId: r1, columnId: c2 })).toMatchObject({
      status: 'formula',
      value: 6,
      source: '=A1*2',
    })
    // A text literal that looks like a formula stays inert text.
    expect(workbook.get({ tableId, rowId: r3, columnId: c3 })).toMatchObject({
      status: 'literal',
      value: '=SUM(9)',
      logical: { ok: true, value: '=SUM(9)' },
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

  it('maps the engine error surface to the persisted codes', () => {
    const workbook = buildScientificWorkbook([
      table([
        { [c1]: { literal: 1 } },
        { [c1]: { formula: persisted('=A1&"x"*2') } },
      ]),
    ])

    expect(workbook.get({ tableId, rowId: r2, columnId: c1 })).toMatchObject({
      status: 'error',
      error: 'VALUE',
      message: '#VALUE!',
    })
    workbook.destroy()
  })

  it('keeps unsupported reloads durable without installing them', () => {
    const workbook = buildScientificWorkbook([
      table([{ [c1]: { literal: 7, formula: persisted('=RAND()') } }]),
    ])

    expect(workbook.get({ tableId, rowId: r1, columnId: c1 })).toMatchObject({
      status: 'formula',
      source: '=RAND()',
      engineFormula: undefined,
      value: 7,
    })
    workbook.destroy()
  })

  it('carries dates as serials and decodes them back to ISO', () => {
    const dateTable: WorkbookTable = {
      id: tableId,
      columns: [
        { id: c1, createdAt: '2024-01-01', logicalType: 'date' },
        { id: c2, createdAt: '2024-01-02', logicalType: 'date' },
      ],
      rows: [
        {
          id: r1,
          createdAt: '2024-01-01',
          cells: {
            [c1]: { literal: '2024-02-29' },
            [c2]: { formula: persisted('=DATE(2024,1,31)') },
          },
        },
      ],
    }

    const workbook = buildScientificWorkbook([dateTable])
    expect(workbook.get({ tableId, rowId: r1, columnId: c1 })).toMatchObject({
      value: 45351,
      logical: { ok: true, value: '2024-02-29' },
    })
    expect(workbook.get({ tableId, rowId: r1, columnId: c2 })).toMatchObject({
      logical: { ok: true, value: '2024-01-31' },
    })
    workbook.destroy()
  })

  it('evaluates postfix percent through the emitted engine dialect', () => {
    const workbook = buildScientificWorkbook([
      table([
        { [c1]: { literal: 50 } },
        { [c2]: { formula: persisted('=A1%') } },
      ]),
    ])

    expect(workbook.get({ tableId, rowId: r2, columnId: c2 })).toMatchObject({
      status: 'formula',
      value: 0.5,
    })
    workbook.destroy()
  })

  it('resolves cross-sheet references and detects workbook cycles', () => {
    const betaTableId = '11111111-1111-4111-8111-111111111112'
    const betaRow = '21111111-1111-4111-8111-111111111114'
    const betaColumn = '31111111-1111-4111-8111-111111111114'

    const tableMaps = [
      { tableId, name: 'Alpha', rowIds: [r1], columnIds: [c1] },
      {
        tableId: betaTableId,
        name: 'Beta source',
        rowIds: [betaRow],
        columnIds: [betaColumn],
      },
    ]

    const cross = buildPersistedFormulaArtifact(
      parseFormula("='Beta source'!A1*2", {
        ...tableMaps[0],
        tables: tableMaps,
      }),
      tableId,
    )

    const workbook = buildScientificWorkbook([
      {
        id: tableId,
        name: 'Alpha',
        columns: [decimal(c1, '2024-01-01')],
        rows: [
          {
            id: r1,
            createdAt: '2024-01-01',
            cells: { [c1]: { formula: cross } },
          },
        ],
      },
      {
        id: betaTableId,
        name: 'Beta source',
        columns: [decimal(betaColumn, '2024-01-01')],
        rows: [
          {
            id: betaRow,
            createdAt: '2024-01-01',
            cells: { [betaColumn]: { literal: 4 } },
          },
        ],
      },
    ])

    expect(workbook.get({ tableId, rowId: r1, columnId: c1 })).toMatchObject({
      status: 'formula',
      value: 8,
    })
    expect(workbook.engineSheetNames()).toEqual([
      scientificSheetName(tableId),
      scientificSheetName(betaTableId),
    ])
    workbook.destroy()
  })

  it('recomputes dependents after a literal write', () => {
    const workbook = buildScientificWorkbook([
      table([{ [c1]: { literal: 3 }, [c2]: { formula: persisted('=A1*3') } }]),
    ])

    const changes = workbook.setLiteral({ tableId, rowId: r1, columnId: c1 }, 4)
    expect(changes.map((change) => change.address.columnId)).toEqual([c1, c2])
    expect(
      workbook
        .getChangedResults(changes)
        .some(
          (item) =>
            item.result.status === 'formula' &&
            'value' in item.result &&
            item.result.value === 12,
        ),
    ).toBe(true)
    workbook.destroy()
  })

  it('rejects malformed persisted artifacts during reload', () => {
    expect(() =>
      buildScientificWorkbook([table([{ [c1]: { formula: { version: 1 } } }])]),
    ).toThrow(/Invalid persisted formula/)
  })

  it('retains arithmetic evaluation order for asymmetric cancellation', () => {
    const workbook = buildScientificWorkbook([
      table([
        {
          [c1]: { literal: 999999999999999 },
          [c2]: { formula: persisted('=(A1+A2)+A3') },
        },
        {
          [c1]: { literal: -999999999999999 },
          [c2]: { formula: persisted('=A1+(A2+A3)') },
        },
        { [c1]: { literal: 0.1 } },
      ]),
    ])

    expect(workbook.get({ tableId, rowId: r1, columnId: c2 })).toMatchObject({
      value: 0.1,
    })
    expect(workbook.get({ tableId, rowId: r2, columnId: c2 })).toMatchObject({
      value: 0.125,
    })
    workbook.destroy()
  })

  it('looks up identity before coercion and retains formula-removal ordering on a failed literal write', () => {
    const workbook = buildScientificWorkbook([
      table([{ [c1]: { literal: 3 }, [c2]: { formula: persisted('=A1*3') } }]),
    ])

    let coercions = 0

    const invalidLiteral = {
      toString() {
        coercions += 1

        return 'not numeric'
      },
    }

    expect(() =>
      workbook.setLiteral(
        { tableId: 'missing', rowId: r1, columnId: c2 },
        invalidLiteral,
      ),
    ).toThrow('Unknown table.')
    expect(coercions).toBe(0)
    expect(() =>
      workbook.setLiteral({ tableId, rowId: r1, columnId: c2 }, invalidLiteral),
    ).toThrow('Decimal input is not numeric.')
    expect(coercions).toBe(1)
    expect(workbook.get({ tableId, rowId: r1, columnId: c2 })).toEqual({
      status: 'literal',
      source: undefined,
      engineFormula: '=(A1*3)',
      value: 9,
      logical: { ok: true, value: 9 },
    })
    workbook.destroy()
  })

  it('formats real binding-resolver failures without replacing native messages or conversion failures', () => {
    const workbook = buildScientificWorkbook([
      table([{ [c1]: { literal: 3 } }]),
    ])

    const worksheet = workbook.engine.sheet(scientificSheetName(tableId))
    const address = { tableId, rowId: r1, columnId: c1 }

    worksheet.set('A1', {
      kind: 'record-field',
      datasetId: 'dataset',
      recordId: r1,
      fieldId: c1,
    })
    worksheet.setBindingResolver(() => {
      throw { toString: () => '#DIV/0!' }
    })
    expect(workbook.get(address)).toMatchObject({
      status: 'error',
      error: 'DIV_BY_ZERO',
      message: '#DIV/0!',
    })

    worksheet.setBindingResolver(() => {
      throw new Error('Circular reference at A1')
    })
    expect(workbook.get(address)).toMatchObject({
      status: 'error',
      error: 'CYCLE',
      message: 'Circular reference at A1',
    })

    const failure = new Error('native coercion failed')
    worksheet.setBindingResolver(() => {
      throw {
        toString() {
          throw failure
        },
      }
    })
    expect(() => workbook.get(address)).toThrow(failure)
    workbook.destroy()
  })
})

describe('scientific literal and result codecs', () => {
  it('preserves native String coercion and strict Boolean input without pre-normalizing objects', () => {
    let coercions = 0

    const decimalInput = {
      [Symbol.toPrimitive](hint: string) {
        expect(hint).toBe('string')
        coercions += 1

        return '2.75'
      },
    }

    expect(encodeScientificLiteral('decimal', decimalInput)).toBe(2.75)
    expect(coercions).toBe(1)
    expect(encodeScientificLiteral('text', Symbol('dose'))).toBe('Symbol(dose)')
    expect(
      encodeScientificLiteral('reference', { toString: () => 'raw-reference' }),
    ).toBe('raw-reference')
    expect(encodeScientificLiteral('integer', 17n)).toBe(17)
    expect(encodeScientificLiteral('boolean', false)).toBe(false)
    expect(encodeScientificLiteral('boolean', undefined)).toBeNull()
    expect(() => encodeScientificLiteral('boolean', 'false')).toThrow(
      'Boolean input must be a Boolean.',
    )
    expect(() =>
      encodeScientificLiteral('boolean', { valueOf: () => true }),
    ).toThrow('Boolean input must be a Boolean.')
  })

  it('keeps precision limits, grammar and numeric-error precedence', () => {
    expect(encodeScientificLiteral('decimal', '123456789012345')).toBe(
      123456789012345,
    )
    expect(encodeScientificLiteral('decimal', '000.0012300e+2')).toBe(0.123)
    expect(() =>
      encodeScientificLiteral('decimal', '1234567890123456'),
    ).toThrow('Numeric input has more than 15 significant digits.')
    expect(() => encodeScientificLiteral('integer', '1e3')).toThrow(
      'Integer input is not an integer.',
    )
    expect(() => encodeScientificLiteral('decimal', ' 2.5 ')).toThrow(
      'Decimal input is not numeric.',
    )
    expect(() => encodeScientificLiteral('decimal', '1e309')).toThrow(
      'Numeric input is outside the safe range.',
    )
    expect(() =>
      encodeScientificLiteral('integer', '9007199254740992'),
    ).toThrow('Numeric input has more than 15 significant digits.')
  })

  it('preserves serial epoch, fractional milliseconds, offsets and exact date failures', () => {
    expect(encodeScientificLiteral('date', '1899-12-30')).toBe(0)
    expect(encodeScientificLiteral('date', '1900-03-01')).toBe(61)
    expect(
      encodeScientificLiteral('timestamp', '1899-12-31T00:30:00.125+01:00'),
    ).toBe((86_400_000 - 30 * 60_000 + 125) / 86_400_000)
    expect(encodeScientificLiteral('timestamp', '1899-12-30T00:00:00.7Z')).toBe(
      700 / 86_400_000,
    )
    expect(
      encodeScientificLiteral('timestamp', '1899-12-30T00:00:00.070Z'),
    ).toBe(70 / 86_400_000)
    expect(() => encodeScientificLiteral('date', '1900-02-29')).toThrow(
      'Invalid ISO date/time components.',
    )
    expect(() =>
      encodeScientificLiteral('timestamp', '2024-02-29T00:00:00+24:00'),
    ).toThrow('Timestamp has an invalid UTC offset.')
    expect(() =>
      encodeScientificLiteral('timestamp', '2024-02-29T00:00:00'),
    ).toThrow('Timestamp must be RFC 3339 with an explicit offset.')
  })

  it('converts Date values only and retains native non-Date result identity', () => {
    const metadata = new Map([['dose', 2]])
    const matrix = [[2, 7]]

    expect(normalizeEngineScalar(new Date('1900-01-01T12:00:00Z'))).toBe(2.5)
    expect(normalizeEngineScalar(new Date(NaN))).toBeNaN()
    expect(normalizeEngineScalar(metadata)).toBe(metadata)
    expect(normalizeEngineScalar(matrix)).toBe(matrix)
    expect(normalizeEngineScalar(undefined)).toBeUndefined()
    expect(normalizeEngineScalar(Infinity)).toBe(Infinity)
  })

  it('retains target-specific diagnostics without coercing derived scientific values', () => {
    expect(decodeScientificResult('text', null)).toEqual({
      ok: true,
      value: null,
    })
    expect(decodeScientificResult('text', undefined)).toEqual({
      ok: false,
      code: 'VALUE',
      message: 'Expected text result.',
    })
    expect(decodeScientificResult('category', false, ['active'])).toEqual({
      ok: false,
      code: 'VALUE',
      message: 'Expected category UUID result.',
    })
    expect(decodeScientificResult('category', 'retired', ['active'])).toEqual({
      ok: false,
      code: 'VALUE',
      message: 'Expected an active option of the target category.',
    })
    expect(decodeScientificResult('category', 'active', ['active'])).toEqual({
      ok: true,
      value: 'active',
    })
    expect(decodeScientificResult('decimal', '2.75')).toEqual({
      ok: false,
      code: 'VALUE',
      message: 'Expected a safe decimal result.',
    })
    expect(decodeScientificResult('decimal', Infinity)).toEqual({
      ok: false,
      code: 'VALUE',
      message: 'Expected a safe decimal result.',
    })
    expect(decodeScientificResult('date', 2.5)).toEqual({
      ok: false,
      code: 'VALUE',
      message: 'Expected an integral date serial.',
    })
    expect(decodeScientificResult('timestamp', 2.5)).toEqual({
      ok: true,
      value: '1900-01-01T12:00:00.000Z',
    })
  })
})
