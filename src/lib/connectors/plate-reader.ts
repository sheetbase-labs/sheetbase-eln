/**
 * INT-02 — plate reader CSV parser.
 *
 * Representative instrument flow: metadata header lines (`# Key: value`),
 * then a data table. Handles common exports with or without the leading
 * comment block; never guesses a value — unknown/blank stays blank so the
 * canonical Dataset validation below stays fail-closed.
 *
 * Identity `sheetbase.plate-reader-csv@1` is stamped into connector run
 * results and change events for provenance.
 */
import { registerParser } from './registry'
import type { ParsedInstrumentPayload } from './registry'

function splitCsvLine(line: string): string[] {
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
    } else if ((char === ',' || char === ';') && !inQuotes) {
      cells.push(current)
      current = ''
    } else {
      current += char
    }
  }
  cells.push(current)
  return cells.map((cell) => cell.trim())
}

const METADATA_LINE = /^#\s*([A-Za-z][A-Za-z0-9 _/.-]*?)\s*:\s*(.+)$/

export const PLATE_READER_PARSER_ID = 'sheetbase.plate-reader-csv'
export const PLATE_READER_PARSER_VERSION = 1

interface PlateReaderParser {
  parserId: typeof PLATE_READER_PARSER_ID
  version: number
  label: string
  parse: (text: string) => ParsedInstrumentPayload
}

export function parsePlateReaderCsv(text: string): ParsedInstrumentPayload {
  const warnings: string[] = []
  const metadata: Record<string, string> = {}
  const lines = text.split(/\r?\n/)

  // Header lines: '# Key: value'. Without any '#' block the file is treated as
  // plain CSV and the first line becomes the data header.
  let dataIndex = 0
  while (dataIndex < lines.length) {
    const line = lines[dataIndex].trim()
    if (line === '') {
      dataIndex += 1
      continue
    }
    if (!line.startsWith('#')) break
    const match = METADATA_LINE.exec(line)
    if (match) {
      const key = match[1].trim().toLowerCase().replaceAll(' ', '_')
      metadata[key] = match[2].trim()
    } else {
      warnings.push(`Unrecognised metadata line: ${line}`)
    }
    dataIndex += 1
  }

  // Find the data table: first non-empty line from here is the header row.
  while (dataIndex < lines.length && lines[dataIndex].trim() === '') {
    dataIndex += 1
  }
  if (dataIndex >= lines.length) {
    throw new Error('No data rows found in instrument output.')
  }

  const headers = splitCsvLine(lines[dataIndex]).filter(
    (header) => header !== '',
  )
  if (headers.length === 0) {
    throw new Error('No column headers found in instrument output.')
  }

  const rows: Array<Record<string, string>> = []
  for (let i = dataIndex + 1; i < lines.length; i += 1) {
    const line = lines[i].trim()
    if (line === '' || line.startsWith('#')) {
      if (line.startsWith('#')) {
        warnings.push(`Trailing metadata line ignored: ${line}`)
      }
      continue
    }
    const cells = splitCsvLine(line)
    const row: Record<string, string> = {}
    headers.forEach((header, index) => {
      row[header] = cells[index] ?? ''
    })
    // Skip rows where every cell is empty.
    if (Object.keys(row).some((header) => row[header] !== '')) {
      rows.push(row)
    }
  }

  return { metadata, headers, rows, warnings }
}

export function createPlateReaderParser(): PlateReaderParser {
  return {
    parserId: PLATE_READER_PARSER_ID,
    version: PLATE_READER_PARSER_VERSION,
    label: 'Plate reader (CSV)',
    parse: parsePlateReaderCsv,
  }
}

registerParser(createPlateReaderParser())
