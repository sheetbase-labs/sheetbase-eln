import { parseDelimited } from '#/lib/import-parse'
import type { ImportDelimiter } from '#/lib/import-parse'

/**
 * Turn a pasted list (or a CSV/TSV file's text) into samples ready to register.
 *
 * A first row that names columns (Name, Type, Quantity, Unit, Location,
 * Barcode) maps them by name in any order; without one the columns are read in
 * that order. Quantity may carry its unit ("500 µL"). The parser never invents
 * values: a row it cannot read is reported with its line number and left out,
 * so the person fixes the list before anything is registered.
 */

export const SAMPLE_BULK_LIMIT = 500

export interface BulkSampleRow {
  /** 1-based line in the pasted text, for error messages. */
  line: number
  title: string
  sampleType?: string
  quantity?: number
  quantityUnit?: string
  storageLocation?: string
  barcode?: string
}

export interface BulkSampleIssue {
  line: number
  message: string
}

export interface BulkSampleParse {
  rows: BulkSampleRow[]
  issues: BulkSampleIssue[]
}

type Column =
  | 'title'
  | 'sampleType'
  | 'quantity'
  | 'quantityUnit'
  | 'storageLocation'
  | 'barcode'

const POSITIONAL: Column[] = [
  'title',
  'sampleType',
  'quantity',
  'quantityUnit',
  'storageLocation',
  'barcode',
]

const HEADER_NAMES: Record<string, Column> = {
  name: 'title',
  title: 'title',
  sample: 'title',
  'sample name': 'title',
  type: 'sampleType',
  'sample type': 'sampleType',
  quantity: 'quantity',
  qty: 'quantity',
  volume: 'quantity',
  amount: 'quantity',
  unit: 'quantityUnit',
  units: 'quantityUnit',
  location: 'storageLocation',
  'storage location': 'storageLocation',
  storage: 'storageLocation',
  position: 'storageLocation',
  barcode: 'barcode',
}

function detectDelimiter(text: string): ImportDelimiter {
  const first = text.split(/\r?\n/).find((line) => line.trim()) ?? ''
  const tabs = (first.match(/\t/g) ?? []).length
  const commas = (first.match(/,/g) ?? []).length
  const semis = (first.match(/;/g) ?? []).length
  if (tabs > 0 && tabs >= commas && tabs >= semis) return '\t'
  if (semis > commas) return ';'
  return ','
}

/** "500 µL", "2.5mg" or "12" into a number and an optional unit. */
export function splitQuantity(
  raw: string,
): { quantity: number; unit?: string } | null {
  const match = /^\s*(-?\d+(?:[.,]\d+)?)\s*([^\d\s].*)?$/.exec(raw)
  if (!match) return null
  const quantity = Number(match[1].replace(',', '.'))
  if (!Number.isFinite(quantity)) return null
  const unit = (match[2] as string | undefined)?.trim()
  return unit ? { quantity, unit } : { quantity }
}

function headerColumns(cells: string[]): Column[] | null {
  const names: Partial<Record<string, Column>> = HEADER_NAMES
  const mapped: Column[] = []
  for (const cell of cells) {
    const column = names[cell.trim().toLowerCase()]
    // Every cell must be a known column name, or the first row is data.
    if (!column) return null
    mapped.push(column)
  }
  return mapped.includes('title') ? mapped : null
}

export function parseBulkSamples(text: string): BulkSampleParse {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  if (!source.trim()) {
    return { rows: [], issues: [{ line: 1, message: 'Nothing to register.' }] }
  }
  const table = parseDelimited(source, detectDelimiter(source))
  const lineOf = (index: number) => index + 1
  const rows: BulkSampleRow[] = []
  const issues: BulkSampleIssue[] = []

  const header = table.length ? headerColumns(table[0]) : null
  const columns = header ?? POSITIONAL
  const start = header ? 1 : 0

  for (let index = start; index < table.length; index++) {
    const cells = table[index].map((cell) => cell.trim())
    if (cells.every((cell) => !cell)) continue
    const line = lineOf(index)
    const row: Partial<Record<Column, string>> = {}
    cells.forEach((cell, position) => {
      const column = columns.at(position)
      if (column && cell) row[column] = cell
    })
    if (!row.title) {
      issues.push({ line, message: 'Missing a name.' })
      continue
    }
    const parsed: BulkSampleRow = { line, title: row.title }
    if (row.sampleType) parsed.sampleType = row.sampleType
    if (row.storageLocation) parsed.storageLocation = row.storageLocation
    if (row.barcode) parsed.barcode = row.barcode
    if (row.quantityUnit) parsed.quantityUnit = row.quantityUnit
    if (row.quantity) {
      const q = splitQuantity(row.quantity)
      if (!q) {
        issues.push({
          line,
          message: `Quantity "${row.quantity}" is not a number.`,
        })
        continue
      }
      parsed.quantity = q.quantity
      if (q.unit && !parsed.quantityUnit) parsed.quantityUnit = q.unit
    }
    rows.push(parsed)
  }

  if (rows.length > SAMPLE_BULK_LIMIT) {
    issues.push({
      line: rows[SAMPLE_BULK_LIMIT].line,
      message: `Register at most ${SAMPLE_BULK_LIMIT} samples at once; split the list.`,
    })
    return { rows: rows.slice(0, SAMPLE_BULK_LIMIT), issues }
  }
  if (rows.length === 0 && issues.length === 0) {
    issues.push({ line: 1, message: 'Nothing to register.' })
  }
  return { rows, issues }
}

/** The titles that appear more than once, so the person can confirm they are intended. */
export function duplicateTitles(rows: BulkSampleRow[]): string[] {
  const seen = new Set<string>()
  const dupes = new Set<string>()
  for (const row of rows) {
    const key = row.title.toLowerCase()
    if (seen.has(key)) dupes.add(row.title)
    seen.add(key)
  }
  return [...dupes]
}
