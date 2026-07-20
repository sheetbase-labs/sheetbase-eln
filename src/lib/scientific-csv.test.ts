import { describe, expect, it } from 'vitest'

import {
  CSV_LIMITS,
  exportScientificCsv,
  exportScientificMetadata,
  parseScientificCsv,
  prepareScientificImport,
} from './scientific-csv'
import type { ScientificTableWire } from './scientific-sheet-data'

const encode = (value: string) => new TextEncoder().encode(value).buffer
const options = { encoding: 'utf-8', delimiter: ',', header: true } as const
const table: ScientificTableWire = {
  id: 'table',
  resource_name: 'sheet_aaaaaaaaaaaaaaaaaaaaaaaaaa',
  name: 'Measurements',
  schema_version: 2,
  lifecycle: 'active',
  columns: [
    {
      id: 'number',
      field_name: 'col_number',
      label: 'Concentration',
      display_order: 1,
      logical_type: 'decimal',
      nullable: false,
      unit: { code: 'mg/L', symbol: 'mg/L' },
      validation: { min: 0 },
      width: null,
      options: [],
    },
  ],
}

describe('scientific CSV interchange', () => {
  it('parses quoted CSV, previews headers, types and duplicates', () => {
    const preview = parseScientificCsv(
      encode('Sample,Result\r\n"A, 1",1.5\r\n"A, 1",1.5'),
      options,
    )
    expect(preview.headers).toEqual(['Sample', 'Result'])
    expect(preview.rows[0]).toEqual({ Sample: 'A, 1', Result: '1.5' })
    expect(preview.detectedTypes).toEqual(['text', 'decimal'])
    expect(preview.duplicateRows).toEqual([2])
  })

  it('rejects malformed and oversized files without partial parsing', () => {
    expect(() => parseScientificCsv(encode('A\n"open'), options)).toThrow(
      /not closed/,
    )
    expect(() =>
      parseScientificCsv(new ArrayBuffer(CSV_LIMITS.bytes + 1), options),
    ).toThrow(/10 MB/)
    const rows = `A\n${Array.from({ length: CSV_LIMITS.rows + 1 }, () => 'x').join('\n')}`
    expect(() => parseScientificCsv(encode(rows), options)).toThrow(/5,000/)
  })

  it('reports every invalid mapped row and retains the preview data', () => {
    const preview = parseScientificCsv(encode('Result\n1.5\nbad\n-1'), options)
    const prepared = prepareScientificImport(preview, [
      { source: 'Result', kind: 'existing', column: table.columns[0] },
    ])
    expect(prepared.rows).toHaveLength(3)
    expect(prepared.errors.map((error) => error.row)).toEqual([2, 3])
  })

  it('exports deterministic numeric values and stable metadata with units', () => {
    const csv = exportScientificCsv(table, [
      { id: 'row', version: 1, col_number: 0.000000123 },
    ])
    expect(csv).toContain('1.23e-7')
    const metadata = JSON.parse(exportScientificMetadata(table))
    expect(metadata.columns[0]).toMatchObject({
      id: 'number',
      field: 'col_number',
      unit: { code: 'mg/L', symbol: 'mg/L' },
    })
  })
})
