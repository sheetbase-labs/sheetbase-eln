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
})
