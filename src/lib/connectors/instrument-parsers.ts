/**
 * INT-02 — additional instrument output parsers and format detection.
 *
 * Every parser here is pure text → `ParsedInstrumentPayload` under the
 * INT-01 parser contract: no network, no side effects, never guessing a value
 * (blank stays blank so Dataset validation stays fail-closed). Behavioural
 * changes bump the version so run provenance stays honest.
 *
 *   sheetbase.plate-grid-csv@1     plate reader matrix export (A–H × 1–12)
 *   sheetbase.qpcr-results-csv@1   qPCR `[Results]` export (Well / Ct or Cq)
 *   sheetbase.hplc-peaks-csv@1     chromatography peak table (RT / Area)
 *   sheetbase.json-records@1       JSON rows, optionally with metadata
 *
 * `detectParser` picks one of these (or the plate-reader / delimited
 * parsers) from the file content, so a folder-pickup agent can
 * drop mixed instrument output into a single connector.
 */
import { parseImportText } from '#/lib/import-parse'

import { PLATE_READER_PARSER_ID } from './plate-reader'
import { getParser, registerParser } from './registry'
import type { IngestionParser, ParsedInstrumentPayload } from './registry'

export const PLATE_GRID_PARSER_ID = 'sheetbase.plate-grid-csv'
export const QPCR_PARSER_ID = 'sheetbase.qpcr-results-csv'
export const HPLC_PARSER_ID = 'sheetbase.hplc-peaks-csv'
export const JSON_RECORDS_PARSER_ID = 'sheetbase.json-records'
export const DELIMITED_PARSER_ID = 'sheetbase.delimited'

const MAX_JSON_ROWS = 100_000

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

function splitLines(text: string): string[] {
  return stripBom(text).split(/\r?\n/)
}

function guessDelimiter(line: string): string {
  const tabs = line.split('\t').length
  const commas = line.split(',').length
  const semis = line.split(';').length
  if (tabs > 1 && tabs >= commas && tabs >= semis) return '\t'
  return semis > commas ? ';' : ','
}

export function splitDelimited(line: string, delimiter: string): string[] {
  const cells: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === delimiter && !inQuotes) {
      cells.push(current)
      current = ''
    } else {
      current += char
    }
  }
  cells.push(current)
  return cells.map((cell) => cell.trim())
}

function normaliseKey(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

const HASH_METADATA = /^#\s*([A-Za-z][A-Za-z0-9 _/.-]*?)\s*:\s*(.+)$/

// ---------------------------------------------------------------------------
// Plate grid
// ---------------------------------------------------------------------------

const ROW_LABEL = /^[A-Za-z]{1,2}$/

function rowIndex(label: string): number {
  return label
    .toUpperCase()
    .split('')
    .reduce((acc, char) => acc * 26 + (char.charCodeAt(0) - 64), 0)
}

function isGridHeader(cells: string[]): boolean {
  // `A,1,2` is a data row of a two-column plate, not a header.
  if (ROW_LABEL.test(cells[0] ?? '')) return false
  const numeric = cells.slice(1).filter((cell) => /^\d{1,2}$/.test(cell))
  return (
    numeric.length >= 2 &&
    numeric.length === cells.slice(1).filter((c) => c !== '').length
  )
}

/**
 * Plate reader matrix: one header row of column numbers, then one row per
 * plate row letter. Several blocks (for example one per read) separated by a
 * blank line or a title line become a `Plate` column. Output is long format,
 * one row per well, so it maps onto a Dataset like any other table.
 */
export function parsePlateGridCsv(text: string): ParsedInstrumentPayload {
  const warnings: string[] = []
  const metadata: Record<string, string> = {}
  const lines = splitLines(text)

  interface Block {
    title: string
    rows: Array<{ row: string; values: string[] }>
    columns: string[]
  }
  const blocks: Block[] = []
  let current: Block | null = null
  let pendingTitle = ''

  for (const raw of lines) {
    const line = raw.trim()
    if (line === '' || /^[,;\t\s]*$/.test(line)) {
      current = null
      continue
    }
    if (line.startsWith('#')) {
      const match = HASH_METADATA.exec(line)
      if (match) metadata[normaliseKey(match[1])] = match[2].trim()
      else warnings.push(`Unrecognised metadata line: ${line}`)
      continue
    }
    const cells = splitDelimited(line, guessDelimiter(line))
    if (isGridHeader(cells)) {
      current = {
        title: pendingTitle,
        rows: [],
        columns: cells.slice(1).filter((cell) => cell !== ''),
      }
      blocks.push(current)
      pendingTitle = ''
      continue
    }
    if (current && ROW_LABEL.test(cells[0])) {
      current.rows.push({ row: cells[0].toUpperCase(), values: cells.slice(1) })
      continue
    }
    // Anything else before a grid is a block title ("Plate 1", "Read 450nm").
    const nonEmpty = cells.filter((cell) => cell !== '')
    if (nonEmpty.length === 1) {
      pendingTitle = nonEmpty[0]
    } else if (nonEmpty.length === 2 && !current) {
      metadata[normaliseKey(nonEmpty[0])] = nonEmpty[1]
    } else {
      warnings.push(`Ignored line outside the plate grid: ${line.slice(0, 80)}`)
    }
  }

  if (blocks.length === 0 || blocks.every((block) => block.rows.length === 0)) {
    throw new Error('No plate grid found in instrument output.')
  }

  const multiple = blocks.length > 1
  const headers = multiple
    ? ['Plate', 'Well', 'Row', 'Column', 'Value']
    : ['Well', 'Row', 'Column', 'Value']
  const rows: Array<Record<string, string>> = []
  blocks.forEach((block, blockIndex) => {
    const plate = block.title || `Plate ${blockIndex + 1}`
    const sorted = [...block.rows].sort(
      (a, b) => rowIndex(a.row) - rowIndex(b.row),
    )
    for (const gridRow of sorted) {
      block.columns.forEach((column, index) => {
        const value = gridRow.values[index] ?? ''
        const record: Record<string, string> = {
          Well: `${gridRow.row}${Number(column)}`,
          Row: gridRow.row,
          Column: String(Number(column)),
          Value: value,
        }
        if (multiple) record.Plate = plate
        // Unread wells in a partial plate stay out of the table.
        if (value !== '') rows.push(record)
      })
    }
  })

  metadata.plate_count = String(blocks.length)
  return { metadata, headers, rows, warnings }
}

// ---------------------------------------------------------------------------
// qPCR results
// ---------------------------------------------------------------------------

const SECTION_LINE = /^\[(.+)\]$/
const STAR_METADATA = /^\*\s*([^=]+?)\s*=\s*(.*)$/
const CT_HEADER = /^(ct|cq|cp)(\s|$|\()|\bct\b|\bcq\b/i

function looksLikeQpcrHeader(cells: string[]): boolean {
  const lower = cells.map((cell) => cell.toLowerCase())
  return (
    lower.some((cell) => cell === 'well' || cell === 'well position') &&
    cells.some((cell) => CT_HEADER.test(cell))
  )
}

/**
 * qPCR export: instrument preamble (`* Key = value` or `Key: value`), then a
 * `[Results]` section with one row per well. Without section markers a file
 * whose first table header carries Well and Ct/Cq columns is accepted.
 */
export function parseQpcrResultsCsv(text: string): ParsedInstrumentPayload {
  const warnings: string[] = []
  const metadata: Record<string, string> = {}
  const lines = splitLines(text)

  let inResults = false
  let sawSections = false
  let headers: string[] | null = null
  let delimiter = ','
  const rows: Array<Record<string, string>> = []
  let finished = false

  for (const raw of lines) {
    if (finished) break
    const line = raw.trim()
    const section = SECTION_LINE.exec(line)
    if (section) {
      sawSections = true
      if (inResults && headers) {
        finished = true
        continue
      }
      inResults = section[1].trim().toLowerCase() === 'results'
      continue
    }
    if (line === '') {
      if (headers && rows.length > 0) finished = true
      continue
    }
    if (headers === null) {
      const star = STAR_METADATA.exec(line)
      if (star) {
        metadata[normaliseKey(star[1])] = star[2].trim()
        continue
      }
      const hash = HASH_METADATA.exec(line)
      if (hash) {
        metadata[normaliseKey(hash[1])] = hash[2].trim()
        continue
      }
      if (sawSections && !inResults) {
        // Other sections (Sample Setup, Amplification Data) are skipped.
        continue
      }
      const delim = guessDelimiter(line)
      const cells = splitDelimited(line, delim)
      if (looksLikeQpcrHeader(cells)) {
        headers = cells.filter((cell) => cell !== '')
        delimiter = delim
        continue
      }
      const kv = line.split(/\s*:\s*/)
      if (kv.length === 2 && kv[0] && kv[1] && !inResults) {
        metadata[normaliseKey(kv[0])] = kv[1]
      }
      continue
    }
    const cells = splitDelimited(line, delimiter)
    const row: Record<string, string> = {}
    headers.forEach((header, index) => {
      row[header] = cells[index] ?? ''
    })
    if (Object.keys(row).some((header) => row[header] !== '')) rows.push(row)
  }

  if (!headers) {
    throw new Error('No qPCR results table (Well and Ct/Cq columns) found.')
  }
  if (rows.length === 0) {
    throw new Error('No data rows found in instrument output.')
  }
  // Undetermined amplification is a real instrument answer, not a missing one.
  if (
    rows.some((row) =>
      Object.values(row).some((value) => /^undetermined$/i.test(value)),
    )
  ) {
    warnings.push('Some wells report Undetermined; values were kept as read.')
  }
  return { metadata, headers, rows, warnings }
}

// ---------------------------------------------------------------------------
// HPLC / chromatography peak table
// ---------------------------------------------------------------------------

function looksLikePeakHeader(cells: string[]): boolean {
  const hasRt = cells.some((cell) => /retention|^rt\b|^rt\s*\(/i.test(cell))
  const hasArea = cells.some((cell) => /area/i.test(cell))
  return hasRt && hasArea
}

/**
 * Chromatography peak report: `Key,Value` preamble lines (sample name,
 * injection date, method...), then a table with retention time and area.
 * Summary lines after the table (`Total,...`) are reported as a warning and
 * kept out of the rows.
 */
export function parseHplcPeaksCsv(text: string): ParsedInstrumentPayload {
  const warnings: string[] = []
  const metadata: Record<string, string> = {}
  const lines = splitLines(text)

  let headers: string[] | null = null
  let delimiter = ','
  const rows: Array<Record<string, string>> = []

  for (const raw of lines) {
    const line = raw.trim()
    if (line === '') continue
    if (headers === null) {
      const hash = HASH_METADATA.exec(line)
      if (hash) {
        metadata[normaliseKey(hash[1])] = hash[2].trim()
        continue
      }
      const delim = guessDelimiter(line)
      const cells = splitDelimited(line, delim)
      if (looksLikePeakHeader(cells)) {
        headers = cells.filter((cell) => cell !== '')
        delimiter = delim
        continue
      }
      const nonEmpty = cells.filter((cell) => cell !== '')
      if (nonEmpty.length === 2) {
        metadata[normaliseKey(nonEmpty[0])] = nonEmpty[1]
      } else if (nonEmpty.length > 2) {
        // Preamble line with a value that itself contains the delimiter.
        metadata[normaliseKey(nonEmpty[0])] = nonEmpty.slice(1).join(' ')
      }
      continue
    }
    const cells = splitDelimited(line, delimiter)
    if (/^(total|sum|totals?)$/i.test(cells[0])) {
      warnings.push(`Summary line ignored: ${line.slice(0, 80)}`)
      continue
    }
    const row: Record<string, string> = {}
    headers.forEach((header, index) => {
      row[header] = cells[index] ?? ''
    })
    if (Object.keys(row).some((header) => row[header] !== '')) rows.push(row)
  }

  if (!headers) {
    throw new Error('No peak table (retention time and area columns) found.')
  }
  if (rows.length === 0) {
    throw new Error('No data rows found in instrument output.')
  }
  return { metadata, headers, rows, warnings }
}

// ---------------------------------------------------------------------------
// JSON records
// ---------------------------------------------------------------------------

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return JSON.stringify(value)
}

/**
 * JSON output, the format most instrument middleware and scripts emit:
 * either an array of row objects, or an object with `rows` (or `records`,
 * `data`, `results`) plus an optional flat `metadata` object.
 */
export function parseJsonRecords(text: string): ParsedInstrumentPayload {
  let doc: unknown
  try {
    doc = JSON.parse(stripBom(text))
  } catch {
    throw new Error('Instrument output is not valid JSON.')
  }
  const metadata: Record<string, string> = {}
  let records: unknown = doc
  if (doc && typeof doc === 'object' && !Array.isArray(doc)) {
    const object = doc as Record<string, unknown>
    const key = ['rows', 'records', 'data', 'results'].find((name) =>
      Array.isArray(object[name]),
    )
    if (!key) {
      throw new Error(
        'JSON output must be an array of rows or an object with a rows array.',
      )
    }
    records = object[key]
    const meta = object.metadata
    if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
      for (const [name, value] of Object.entries(meta)) {
        metadata[normaliseKey(name)] = stringifyValue(value)
      }
    }
  }
  if (!Array.isArray(records)) {
    throw new Error('JSON output must be an array of rows.')
  }
  if (records.length === 0) {
    throw new Error('No data rows found in instrument output.')
  }
  if (records.length > MAX_JSON_ROWS) {
    throw new Error(`JSON output exceeds ${MAX_JSON_ROWS} rows.`)
  }
  const headers: string[] = []
  const seen = new Set<string>()
  const rows: Array<Record<string, string>> = []
  for (const record of records) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new Error('Every JSON row must be an object.')
    }
    const row: Record<string, string> = {}
    for (const [name, value] of Object.entries(record)) {
      if (!seen.has(name)) {
        seen.add(name)
        headers.push(name)
      }
      row[name] = stringifyValue(value)
    }
    rows.push(row)
  }
  for (const row of rows) {
    for (const header of headers) row[header] ??= ''
  }
  return { metadata, headers, rows, warnings: [] }
}

// ---------------------------------------------------------------------------
// Registration and detection
// ---------------------------------------------------------------------------

const PARSERS: IngestionParser[] = [
  {
    parserId: PLATE_GRID_PARSER_ID,
    version: 1,
    label: 'Plate reader grid (CSV)',
    parse: parsePlateGridCsv,
  },
  {
    parserId: QPCR_PARSER_ID,
    version: 1,
    label: 'qPCR results (CSV)',
    parse: parseQpcrResultsCsv,
  },
  {
    parserId: HPLC_PARSER_ID,
    version: 1,
    label: 'HPLC peak table (CSV)',
    parse: parseHplcPeaksCsv,
  },
  {
    parserId: JSON_RECORDS_PARSER_ID,
    version: 1,
    label: 'JSON records',
    parse: parseJsonRecords,
  },
]

for (const parser of PARSERS) registerParser(parser)

// The delimited-text identity is also registered by the S3 adapter. Register
// it here when the S3 module has not been loaded so pickup works standalone;
// both registrations are the same plain delimited read.
if (!getParser(DELIMITED_PARSER_ID)) {
  registerParser({
    parserId: DELIMITED_PARSER_ID,
    version: 1,
    label: 'Delimited text (CSV/TSV)',
    parse: (text) => {
      const preview = parseImportText(text, { header: true })
      const sheet = preview.sheets[0]
      return {
        headers: sheet.headers,
        rows: sheet.rows,
        metadata: { format: preview.format },
        warnings: [],
      }
    },
  })
}

const SNIFF_LINES = 60

/**
 * Chooses the parser for a file from its name and content. Returns the
 * parser identity to run; callers record that identity in provenance, so a
 * wrong guess is visible, never silent. Falls back to plain delimited text.
 */
export function detectParserId(text: string): string {
  const body = stripBom(text)
  const trimmed = body.trimStart()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return JSON_RECORDS_PARSER_ID
  }
  const head = body.split(/\r?\n/).slice(0, SNIFF_LINES)
  const headCells = head.map((line) =>
    splitDelimited(line, guessDelimiter(line)),
  )
  if (head.some((line) => /^\[results\]$/i.test(line.trim()))) {
    return QPCR_PARSER_ID
  }
  if (headCells.some(isGridHeader)) return PLATE_GRID_PARSER_ID
  if (headCells.some(looksLikePeakHeader)) return HPLC_PARSER_ID
  if (head.some((line) => line.trim().startsWith('#'))) {
    return PLATE_READER_PARSER_ID
  }
  if (headCells.some(looksLikeQpcrHeader)) return QPCR_PARSER_ID
  return DELIMITED_PARSER_ID
}
