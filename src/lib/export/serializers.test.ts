// @vitest-environment node
/**
 * Unit tests for DATA-02 export primitives: deterministic ZIP container,
 * delimited rendering, XLSX structure (round-tripped through the canonical
 * import parser) and Parquet determinism.
 */
import { describe, expect, it } from 'vitest'

import { parseImportBytes } from '../import-parse'
import {
  delimitedHeaderLine,
  delimitedRowLine,
  formatCell,
  isExportFormat,
  xlsxDocument,
} from './serializers'
import { ZipWriter } from './zip'

const fields = [
  {
    id: 'f1',
    key: 'sample',
    label: 'Sample',
    logicalType: 'text',
    nullable: false,
    unit: null,
  },
  {
    id: 'f2',
    key: 'ph',
    label: 'pH',
    logicalType: 'decimal',
    nullable: true,
    unit: 'pH',
  },
]

const rows = [
  { rowId: 'r1', revision: 3, values: { f1: 'plain', f2: 7.2 } },
  {
    rowId: 'r2',
    revision: 3,
    values: { f1: 'has,comma "and" quote\nnew', f2: null },
  },
]

describe('delimited rendering', () => {
  it('accepts only supported export formats', () => {
    expect(isExportFormat('xlsx')).toBe(true)
    expect(isExportFormat('XLSX')).toBe(false)
    expect(isExportFormat(null)).toBe(false)
  })

  it('renders RFC 4180 CSV with quoted specials', () => {
    expect(delimitedHeaderLine(fields, ',')).toBe('Sample,pH')
    expect(delimitedRowLine(fields, rows[0], ',')).toBe('plain,7.2')
    expect(delimitedRowLine(fields, rows[1], ',')).toBe(
      '"has,comma ""and"" quote\nnew",',
    )
  })

  it('formats booleans and keeps reference ids stable', () => {
    expect(formatCell({ ...fields[0], logicalType: 'boolean' }, true)).toBe(
      'true',
    )
    expect(
      formatCell(
        { ...fields[0], logicalType: 'reference' },
        '00000000-0000-4000-8000-000000000001',
      ),
    ).toBe('00000000-0000-4000-8000-000000000001')
    expect(formatCell(fields[0], null)).toBe('')
  })

  it('keeps JavaScript string conversion for non-JSON values', () => {
    expect(formatCell(fields[0], 42n)).toBe('42')
    expect(formatCell(fields[0], { toString: () => 'custom value' })).toBe(
      'custom value',
    )
  })
})

describe('ZipWriter', () => {
  it('produces deterministic archives for identical content', async () => {
    const build = () => {
      const writer = new ZipWriter()
      writer.add('a.txt', 'alpha')
      writer.add('dir/b.txt', new TextEncoder().encode('beta gamma'))

      return writer.stream()
    }

    const a = await build()
    const b = await build()
    expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).toBe(0)
    // Local file header signature present.
    expect(a[0]).toBe(0x50)
    expect(a[1]).toBe(0x4b)
  })
})

describe('xlsxDocument', () => {
  it('round-trips through the canonical import XLSX parser', async () => {
    const bytes = await xlsxDocument(fields, rows, [
      ['kind', 'sheetbase.dataset.export'],
      ['state', 'live'],
    ])

    const preview = await parseImportBytes(new Uint8Array(bytes).buffer, {
      fileName: 'export.xlsx',
    })

    const sheet = preview.sheets[0]
    expect(sheet.rows[0]).toEqual({ Sample: 'plain', pH: '7.2' })
    expect(sheet.rows[1].Sample).toBe('has,comma "and" quote\nnew')
  })

  it('preserves custom string conversion and bigint numeric cells', async () => {
    const bytes = await xlsxDocument(
      fields,
      [
        {
          rowId: 'custom',
          revision: 1,
          values: { f1: { toString: () => 'custom value' }, f2: 42n },
        },
      ],
      [],
    )

    const preview = await parseImportBytes(new Uint8Array(bytes).buffer, {
      fileName: 'export.xlsx',
    })

    expect(preview.sheets[0].rows[0]).toEqual({
      Sample: 'custom value',
      pH: '42',
    })
  })
})

describe('parquetDocument', () => {
  it('writes deterministic Parquet for identical rows', async () => {
    const { parquetDocument } = await import('./parquet')
    const bytes = await parquetDocument(fields, rows)
    const again = await parquetDocument(fields, rows)
    expect(bytes.length).toBeGreaterThan(4)
    // PAR1 magic.
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([
      0x50, 0x41, 0x52, 0x31,
    ])
    expect(Buffer.compare(Buffer.from(bytes), Buffer.from(again))).toBe(0)
  })

  it('rejects row sets beyond the materialisation cap', async () => {
    const { parquetDocument, PARQUET_MAX_ROWS } = await import('./parquet')
    const huge = Array.from({ length: PARQUET_MAX_ROWS + 1 }, () => rows[0])
    await expect(parquetDocument(fields, huge)).rejects.toThrow(/csv or ndjson/)
  })
})
