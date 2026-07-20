import type {
  ScientificColumnWire,
  ScientificLogicalType,
  ScientificRowWire,
  ScientificTableWire,
} from './scientific-sheet-data'
import { decodeScientificValue } from './scientific-sheet-data'

export const CSV_LIMITS = { bytes: 10 * 1024 * 1024, rows: 5000 } as const
export type CsvEncoding = 'utf-8' | 'utf-16le' | 'windows-1252'
export type CsvDelimiter = ',' | ';' | '\t'

export interface CsvPreview {
  headers: string[]
  rows: Array<Record<string, string>>
  detectedTypes: ScientificLogicalType[]
  duplicateRows: number[]
}

export function parseScientificCsv(
  bytes: ArrayBuffer,
  options: { encoding: CsvEncoding; delimiter: CsvDelimiter; header: boolean },
): CsvPreview {
  if (bytes.byteLength > CSV_LIMITS.bytes) throw new Error('CSV exceeds 10 MB.')
  let text: string
  try {
    text = new TextDecoder(options.encoding, { fatal: true }).decode(bytes)
  } catch {
    throw new Error(`CSV is not valid ${options.encoding} text.`)
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const matrix = parseDelimited(text, options.delimiter)
  if (!matrix.length || !matrix.some((row) => row.some((cell) => cell !== '')))
    throw new Error('CSV contains no data.')
  const width = Math.max(...matrix.map((row) => row.length))
  if (!width) throw new Error('CSV contains no columns.')
  const rawHeaders = options.header
    ? matrix.shift()!
    : Array.from({ length: width }, (_, index) => `Column ${index + 1}`)
  const headers = rawHeaders.map(
    (value, index) => value.trim() || `Column ${index + 1}`,
  )
  if (new Set(headers).size !== headers.length)
    throw new Error('CSV headers must be unique.')
  if (matrix.length > CSV_LIMITS.rows)
    throw new Error(`CSV exceeds ${CSV_LIMITS.rows.toLocaleString()} rows.`)
  const rows = matrix
    .filter((row) => row.some((cell) => cell !== ''))
    .map((row) =>
      Object.fromEntries(
        headers.map((header, index) => [header, row[index] ?? '']),
      ),
    )
  const seen = new Map<string, number>()
  const duplicateRows: number[] = []
  for (const [index, row] of rows.entries()) {
    const key = JSON.stringify(headers.map((header) => row[header]))
    if (seen.has(key)) duplicateRows.push(index + 1)
    else seen.set(key, index)
  }
  return {
    headers,
    rows,
    detectedTypes: headers.map((header) =>
      detectType(rows.map((row) => row[header]).filter(Boolean)),
    ),
    duplicateRows,
  }
}

function parseDelimited(text: string, delimiter: CsvDelimiter) {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < text.length; index++) {
    const character = text[index]
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          cell += '"'
          index++
        } else quoted = false
      } else cell += character
      continue
    }
    if (character === '"') {
      if (cell) throw new Error(`Malformed CSV near character ${index + 1}.`)
      quoted = true
    } else if (character === delimiter) {
      row.push(cell)
      cell = ''
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') index++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += character
  }
  if (quoted) throw new Error('Malformed CSV: quoted field is not closed.')
  if (cell || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

function detectType(values: string[]): ScientificLogicalType {
  if (!values.length) return 'text'
  if (values.every((value) => /^[+-]?\d+$/.test(value))) return 'integer'
  if (values.every((value) => Number.isFinite(Number(value)))) return 'decimal'
  if (values.every((value) => /^(true|false|0|1)$/i.test(value)))
    return 'boolean'
  if (
    values.every(
      (value) =>
        /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        !Number.isNaN(Date.parse(`${value}T00:00:00Z`)),
    )
  )
    return 'date'
  if (
    values.every(
      (value) =>
        /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value)),
    )
  )
    return 'timestamp'
  return 'text'
}

export type CsvMapping =
  | { source: string; kind: 'ignore' }
  | { source: string; kind: 'existing'; column: ScientificColumnWire }
  | {
      source: string
      kind: 'new'
      label: string
      logicalType: ScientificLogicalType
    }

export function prepareScientificImport(
  preview: CsvPreview,
  mappings: CsvMapping[],
) {
  const errors: Array<{ row: number; source: string; message: string }> = []
  const rows = preview.rows.map((sourceRow, rowIndex) => {
    const output: Record<string, unknown> = {}
    for (const mapping of mappings) {
      if (mapping.kind === 'ignore') continue
      const input = sourceRow[mapping.source]
      const column =
        mapping.kind === 'existing'
          ? mapping.column
          : ({
              id: mapping.source,
              field_name: mapping.source,
              label: mapping.label,
              display_order: 0,
              logical_type: mapping.logicalType,
              nullable: true,
              unit: null,
              validation: {},
              width: null,
              options: [],
            } satisfies ScientificColumnWire)
      try {
        output[mapping.source] = decodeScientificValue(column, input)
      } catch (error) {
        errors.push({
          row: rowIndex + 1,
          source: mapping.source,
          message: error instanceof Error ? error.message : 'Invalid value.',
        })
      }
    }
    return output
  })
  return { rows, errors }
}

function csvCell(value: unknown) {
  if (value === null || value === undefined) return ''
  let text: string
  if (typeof value === 'number') {
    const magnitude = Math.abs(value)
    text =
      value !== 0 && (magnitude >= 1e6 || magnitude < 1e-4)
        ? value.toExponential(15).replace(/\.?(0+)(e)/, '$2')
        : Number(value.toPrecision(15)).toString()
  } else text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function exportScientificCsv(
  table: ScientificTableWire,
  rows: ScientificRowWire[],
) {
  const headers = [
    'id',
    'version',
    ...table.columns.map((column) => column.field_name),
  ]
  return [
    headers.join(','),
    ...rows.map((row) =>
      headers.map((header) => csvCell(row[header])).join(','),
    ),
  ].join('\r\n')
}

export function exportScientificMetadata(table: ScientificTableWire) {
  return JSON.stringify(
    {
      format: 'sheetbase-scientific-table-v1',
      table: {
        id: table.id,
        name: table.name,
        resource: table.resource_name,
        schemaVersion: table.schema_version,
      },
      columns: table.columns.map((column) => ({
        id: column.id,
        field: column.field_name,
        label: column.label,
        logicalType: column.logical_type,
        unit: column.unit,
        nullable: column.nullable,
        validation: column.validation,
        options: column.options,
      })),
    },
    null,
    2,
  )
}
