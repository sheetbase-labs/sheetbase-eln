/**
 * How a parser an admin made reads a text file, without a code change.
 *
 * A layout describes the shapes instrument exports come in: a block of
 * `Key: value` lines before the table, lines to ignore, a header that does not
 * sit on the first row, units written in the header or on a row under it,
 * decimal commas, a trailing summary to stop at, and plate grids (rows A to H
 * by columns 1 to 12) that become one row per well. It is pure and runs the
 * same way in the browser preview, the Import page, the folder agent and the
 * test-file check, so a file reads the same wherever it arrives.
 */
import { z } from 'zod'

import {
  IMPORT_LIMITS,
  ImportParseError,
  detectDelimiter,
  parseDelimited,
  uniquifyHeaders,
} from '../import-parse'
import type { ImportDelimiter } from '../import-parse'
import type { ParsedInstrumentPayload } from '../connectors/registry'

const text = (max: number) => z.string().trim().min(1).max(max)

export const parserLayoutSchema = z
  .object({
    /** How cells are separated; found from the header line when left out. */
    delimiter: z.enum(['auto', 'comma', 'semicolon', 'tab']).optional(),
    /** The header is the first line that starts with this (ignoring case). */
    headerStartsWith: text(100).optional(),
    /** Or the header is this line, counting from 1 after blank and ignored lines. */
    headerLine: z.number().int().min(1).max(1000).optional(),
    /** Lines before the header that read `Key: value` become file details. */
    readDetails: z.boolean().optional(),
    /** Lines that start with any of these are left out. */
    ignoreLines: z.array(text(100)).max(20).optional(),
    /** Reading stops at the first line that starts with this. */
    stopAt: text(100).optional(),
    /** Where the units are written, if anywhere. */
    units: z.enum(['none', 'header', 'row']).optional(),
    /** Numbers written 1,5 read as 1.5. Needs a delimiter other than a comma. */
    decimalComma: z.boolean().optional(),
    /** A plate grid becomes one row per well, the readings in this column. */
    plateGrid: z
      .object({ valueName: text(60) })
      .strict()
      .optional(),
  })
  .strict()

export type ParserLayout = z.infer<typeof parserLayoutSchema>

/** The layout stored on a parser version, or null when it has none (or an invalid one). */
export function layoutOf(
  signature: Record<string, unknown>,
): ParserLayout | null {
  if (signature['layout'] === undefined) return null
  const parsed = parserLayoutSchema.safeParse(signature['layout'])
  return parsed.success ? parsed.data : null
}

const DELIMITERS: Record<string, ImportDelimiter> = {
  comma: ',',
  semicolon: ';',
  tab: '\t',
}

const startsWith = (line: string, prefix: string) =>
  line.trimStart().toLowerCase().startsWith(prefix.trim().toLowerCase())

function splitDetail(line: string): [string, string] | null {
  const match =
    /^\s*#?\s*([A-Za-z][^:=,;\t]{0,60}?)\s*[:=,;\t]\s*(.*?)\s*[,;\t]*\s*$/.exec(
      line,
    )
  return match ? [match[1], match[2]] : null
}

const DETAIL_LINE = /^\s*#?\s*[A-Za-z][^:,;\t]{0,60}:/

const UNIT = /^(.*?)\s*[([]\s*([^()[\]]{1,20})\s*[)\]]\s*$/

function plateRows(
  matrix: string[][],
  valueName: string,
): {
  headers: string[]
  rows: Array<Record<string, string>>
  warnings: string[]
} {
  const blocks: Array<{ title: string; rows: string[][]; columns: string[] }> =
    []
  let title = ''
  for (let i = 0; i < matrix.length; i++) {
    const row = matrix[i]
    const cells = row.map((cell) => cell.trim())
    const numbers = cells.slice(1)
    const isColumnRow =
      numbers.length >= 2 &&
      numbers.every((cell, index) => cell === String(index + 1)) &&
      cells[0] === ''
    if (!isColumnRow) {
      if (cells[0] && cells.slice(1).every((cell) => !cell)) title = cells[0]
      continue
    }
    const gridRows: string[][] = []
    while (
      i + 1 < matrix.length &&
      /^[A-Za-z]{1,2}$/.test(matrix[i + 1][0]?.trim() ?? '')
    ) {
      gridRows.push(matrix[++i])
    }
    if (gridRows.length)
      blocks.push({ title, rows: gridRows, columns: numbers })
  }
  if (!blocks.length) {
    throw new ImportParseError(
      'Couldn’t find a plate grid: a row of column numbers starting at 1, with rows labelled A, B, C below it.',
    )
  }
  const many = blocks.length > 1
  const headers = [
    ...(many ? ['Plate'] : []),
    'Well',
    'Row',
    'Column',
    valueName,
  ]
  const rows: Array<Record<string, string>> = []
  blocks.forEach((block, blockIndex) => {
    for (const gridRow of block.rows) {
      const letter = gridRow[0].trim().toUpperCase()
      block.columns.forEach((column, index) => {
        const value = (gridRow[index + 1] ?? '').trim()
        if (value === '') return
        rows.push({
          ...(many ? { Plate: block.title || `Plate ${blockIndex + 1}` } : {}),
          Well: `${letter}${column}`,
          Row: letter,
          Column: column,
          [valueName]: value,
        })
      })
    }
  })
  return { headers, rows, warnings: [] }
}

/** Reads a text file the way a layout says to. Throws an ImportParseError in plain words. */
export function readWithLayout(
  fileText: string,
  layout: ParserLayout,
): ParsedInstrumentPayload {
  const warnings: string[] = []
  const all = (fileText.charCodeAt(0) === 0xfeff ? fileText.slice(1) : fileText)
    .split(/\r?\n|\r/)
    .filter((line) => line.trim() !== '')
  let lines = all
  if (layout.stopAt) {
    const stop = lines.findIndex((line) => startsWith(line, layout.stopAt!))
    if (stop >= 0) {
      warnings.push(`Stopped reading at “${lines[stop].trim().slice(0, 40)}”.`)
      lines = lines.slice(0, stop)
    }
  }
  if (layout.ignoreLines?.length) {
    const before = lines.length
    lines = lines.filter(
      (line) => !layout.ignoreLines!.some((prefix) => startsWith(line, prefix)),
    )
    if (before > lines.length)
      warnings.push(`Left out ${before - lines.length} lines.`)
  }
  if (!lines.length) throw new ImportParseError('The file has no data.')

  const metadata: Record<string, string> = {}
  let headerIndex = 0
  if (layout.plateGrid) {
    headerIndex = 0
  } else if (layout.headerStartsWith) {
    headerIndex = lines.findIndex((line) =>
      startsWith(line, layout.headerStartsWith!),
    )
    if (headerIndex < 0)
      throw new ImportParseError(
        `Couldn’t find a header line starting with “${layout.headerStartsWith}”.`,
      )
  } else if (layout.headerLine) {
    headerIndex = layout.headerLine - 1
    if (headerIndex >= lines.length)
      throw new ImportParseError(
        `The file has only ${lines.length} lines, so there is no line ${layout.headerLine}.`,
      )
  } else if (layout.readDetails) {
    // Details first, then the table: the header is the first line that isn't
    // a `Key: value` line.
    headerIndex = lines.findIndex((line) => !DETAIL_LINE.test(line))
    if (headerIndex < 0) headerIndex = lines.length
  }
  if (layout.readDetails) {
    for (const line of lines.slice(0, headerIndex)) {
      const detail = splitDetail(line)
      if (detail) metadata[detail[0].trim()] = detail[1]
    }
  }

  const sample = lines[layout.plateGrid ? 0 : headerIndex] ?? ''
  const delimiter =
    layout.delimiter && layout.delimiter !== 'auto'
      ? DELIMITERS[layout.delimiter]
      : detectDelimiter(sample)

  if (layout.plateGrid) {
    const matrix = parseDelimited(lines.join('\n'), delimiter)
    const plate = plateRows(matrix, layout.plateGrid.valueName)
    if (plate.rows.length > IMPORT_LIMITS.rows)
      throw new ImportParseError(
        `The file has more than ${IMPORT_LIMITS.rows.toLocaleString()} rows.`,
      )
    return { metadata, headers: plate.headers, rows: plate.rows, warnings }
  }

  const matrix = parseDelimited(lines.slice(headerIndex).join('\n'), delimiter)
  const headerCells = matrix.shift()
  if (!headerCells) throw new ImportParseError('The file has no header line.')
  let headers = headerCells.map(
    (value, index) => value.trim() || `Column ${index + 1}`,
  )
  if (layout.units === 'header') {
    headers = headers.map((header) => {
      const match = UNIT.exec(header)
      if (!match || !match[1].trim()) return header
      metadata[`${match[1].trim()} unit`] = match[2].trim()
      return match[1].trim()
    })
  } else if (layout.units === 'row') {
    const unitRow = matrix.shift()
    if (!unitRow)
      throw new ImportParseError('Expected a row of units under the header.')
    headers.forEach((header, index) => {
      const unit = (unitRow[index] ?? '').trim()
      if (unit) metadata[`${header} unit`] = unit
    })
  }
  headers = uniquifyHeaders(headers)
  if (matrix.length > IMPORT_LIMITS.rows)
    throw new ImportParseError(
      `The file has more than ${IMPORT_LIMITS.rows.toLocaleString()} rows.`,
    )
  const commaIgnored = Boolean(layout.decimalComma) && delimiter === ','
  const rows = matrix.map((cells) =>
    Object.fromEntries(
      headers.map((header, index) => {
        let value = (cells[index] ?? '').trim()
        if (layout.decimalComma) {
          if (!commaIgnored && /^-?\d+,\d+$/.test(value))
            value = value.replace(',', '.')
        }
        return [header, value]
      }),
    ),
  )
  if (commaIgnored)
    warnings.push(
      'Decimal commas can’t be read when cells are separated by commas, so numbers were left as written.',
    )
  if (!rows.length) throw new ImportParseError('The file has no data rows.')
  return { metadata, headers, rows, warnings }
}
