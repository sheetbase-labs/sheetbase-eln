/**
 * Making a Sheetbase sheet from a worksheet of an attached Excel or LibreOffice
 * file.
 *
 * The reader pulls cell values and formulas out of an .xlsx (or values out of an
 * .ods) without evaluating anything. The builder then turns one worksheet into
 * the state of an ad-hoc sheet: the first row names the columns and each column
 * gets the narrowest type its values fit. A sheet made this way holds values:
 * a formula column keeps the numbers Excel last calculated (an ad-hoc sheet
 * has no definition to evaluate calculations against), and the builder names
 * those columns and their formulas so the person is told what did not stay
 * live.
 */
import { unzipSync } from 'fflate'
import { z } from 'zod'

import { columnKeyFromName, inferColumnType } from '#/lib/import-infer'
import type { SheetInstanceState } from '#/lib/sheet-instance'

export interface OfficeCell {
  /** What the cell shows: text, a number, a boolean or an ISO date. Null when empty. */
  value: string | number | boolean | null
  /** The formula as written, without the leading `=`. */
  formula?: string
}

export interface OfficeSheet {
  name: string
  /** Row-major, 0-based; `rows[r][c]` is the cell at row r+1, column c. */
  rows: Array<Array<OfficeCell | undefined> | undefined>
}

export class OfficeSheetError extends Error {}

const UNZIP_MAX_BYTES = 64 * 1024 * 1024
const MAX_CELLS = 2_000_000

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

const XML_ENTITIES = new Map([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
])

/** A regex group that took no part in the match is undefined, whatever the type says. */
function optionalGroup(
  match: RegExpMatchArray,
  index: number,
): string | undefined {
  const group: string | undefined = match[index]

  return group
}

function decodeXml(value: string): string {
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (match, entity: string) => {
      const lower = entity.toLowerCase()

      if (lower.startsWith('#x')) {
        return safeChar(Number.parseInt(lower.slice(2), 16)) ?? match
      }

      if (lower.startsWith('#')) {
        return safeChar(Number.parseInt(lower.slice(1), 10)) ?? match
      }

      return XML_ENTITIES.get(lower) ?? match
    },
  )
}

function safeChar(code: number): string | null {
  if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return null

  if (code >= 0xd800 && code <= 0xdfff) return null

  return String.fromCodePoint(code)
}

function attribute(attrs: string, name: string): string | null {
  const match = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs)

  return match ? decodeXml(match[1]) : null
}

function columnIndex(letters: string): number {
  let n = 0

  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)

  return n - 1
}

export function columnLetters(index: number): string {
  let n = index + 1
  let out = ''

  while (n > 0) {
    const rem = (n - 1) % 26
    out = String.fromCharCode(65 + rem) + out
    n = Math.floor((n - 1) / 26)
  }

  return out
}

function unzipWanted(
  bytes: Uint8Array,
  wanted: (name: string) => boolean,
): Record<string, Uint8Array> {
  let total = 0

  try {
    return unzipSync(bytes, {
      filter: (file) => {
        if (!wanted(file.name)) return false
        total += file.originalSize

        if (total > UNZIP_MAX_BYTES) throw new Error('too large')

        return true
      },
    })
  } catch {
    throw new OfficeSheetError('This file could not be opened as a workbook.')
  }
}

const text = (bytes: Uint8Array | undefined) =>
  bytes ? new TextDecoder('utf-8').decode(bytes) : ''

function sharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((si) =>
    [...si[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
      .map((t) => decodeXml(t[1]))
      .join(''),
  )
}

function isDateFormat(numFmtId: number, code: string): boolean {
  if ([14, 15, 16, 17, 22, 45, 46, 47].includes(numFmtId)) return true

  return /[ymdhs]/i.test(code) && !/[[\]]/.test(code) && !/^0|#/.test(code)
}

/** Indexes of the cell formats that show a date (cell style `s`). */
function dateStyles(xml: string): Set<number> {
  const custom = new Map<number, string>()

  for (const match of xml.matchAll(
    /<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g,
  )) {
    custom.set(Number(match[1]), decodeXml(match[2]))
  }

  const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)?.[1] ?? ''
  const dates = new Set<number>()
  let index = 0

  for (const xf of cellXfs.matchAll(/<xf\b([^>]*?)\/?>/g)) {
    const id = Number(attribute(xf[1], 'numFmtId') ?? '0')

    if (isDateFormat(id, custom.get(id) ?? '')) dates.add(index)
    index += 1
  }

  return dates
}

function serialToIso(serial: number): string {
  const ms = Date.UTC(1899, 11, 30) + Math.round(serial * 86_400_000)

  return new Date(ms).toISOString().slice(0, 10)
}

/** Move the relative references of a formula by whole rows and columns. */
export function shiftFormula(
  formula: string,
  rowDelta: number,
  colDelta: number,
): string {
  return mapReferences(formula, (ref) => {
    const col = ref.absCol ? ref.col : ref.col + colDelta
    const row = ref.absRow ? ref.row : ref.row + rowDelta

    if (col < 0 || row < 1) return null

    return `${ref.absCol ? '$' : ''}${columnLetters(col)}${ref.absRow ? '$' : ''}${row}`
  })
}

interface Reference {
  absCol: boolean
  col: number
  absRow: boolean
  row: number
  /** The reference sits after `!`: it names another worksheet. */
  foreign: boolean
}

const REFERENCE =
  /(?<![A-Za-z0-9_.])(\$?)([A-Z]{1,3})(\$?)(\d+)(?![A-Za-z0-9_(.])/g

/**
 * Rewrite every cell reference of a formula, leaving string literals, function
 * names and quoted sheet names alone. A rewrite that returns null leaves the
 * reference as written.
 */
function mapReferences(
  formula: string,
  rewrite: (ref: Reference) => string | null,
): string {
  let out = ''
  let i = 0

  while (i < formula.length) {
    const ch = formula[i]

    if (ch === '"' || ch === "'") {
      let j = i + 1

      while (j < formula.length) {
        if (formula[j] === ch) {
          if (formula[j + 1] === ch) j += 2
          else break
        } else j += 1
      }

      out += formula.slice(i, j + 1)
      i = j + 1
      continue
    }

    REFERENCE.lastIndex = i
    const match = REFERENCE.exec(formula)
    const upto = match ? match.index : formula.length
    // Copy plain text up to the next reference or quote.
    const nextQuote = formula.slice(i).search(/["']/)
    const stop = nextQuote === -1 ? upto : Math.min(upto, i + nextQuote)

    if (stop > i) {
      out += formula.slice(i, stop)
      i = stop
      continue
    }

    if (!match) break
    const foreign = formula[match.index - 1] === '!'

    const rewritten = rewrite({
      absCol: match[1] === '$',
      col: columnIndex(match[2]),
      absRow: match[3] === '$',
      row: Number(match[4]),
      foreign,
    })

    out += rewritten ?? match[0]
    i = match.index + match[0].length
  }

  return out
}

function hasReference(formula: string): boolean {
  let found = false
  mapReferences(formula, () => {
    found = true

    return null
  })

  return found
}

interface RawCell {
  row: number
  col: number
  cell: OfficeCell
}

function parseWorksheet(
  xml: string,
  strings: string[],
  dates: Set<number>,
): OfficeSheet['rows'] {
  const cells: RawCell[] = []

  const sharedMasters = new Map<
    string,
    { formula: string; row: number; col: number }
  >()

  let count = 0

  for (const rowMatch of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const rowNumber = Number(attribute(rowMatch[1], 'r') ?? NaN)
    let nextCol = 0

    for (const c of rowMatch[2].matchAll(
      /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g,
    )) {
      if (++count > MAX_CELLS) {
        throw new OfficeSheetError('This worksheet is too large to read.')
      }

      const attrs = c[1]
      const inner = optionalGroup(c, 2) ?? ''
      const ref = /^([A-Z]+)(\d+)$/i.exec(attribute(attrs, 'r') ?? '')
      const col = ref ? columnIndex(ref[1]) : nextCol

      const row = ref
        ? Number(ref[2])
        : Number.isFinite(rowNumber)
          ? rowNumber
          : 0

      nextCol = col + 1
      const type = attribute(attrs, 't') ?? 'n'
      const style = Number(attribute(attrs, 's') ?? NaN)
      const rawValue = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner)?.[1]
      const inline = /<is\b[^>]*>([\s\S]*?)<\/is>/.exec(inner)?.[1]
      let value: OfficeCell['value'] = null

      if (type === 's' && rawValue !== undefined) {
        value = strings[Number(rawValue)] ?? null
      } else if (type === 'inlineStr' && inline !== undefined) {
        value = [...inline.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
          .map((t) => decodeXml(t[1]))
          .join('')
      } else if (type === 'str' && rawValue !== undefined) {
        value = decodeXml(rawValue)
      } else if (type === 'b' && rawValue !== undefined) {
        value = rawValue.trim() === '1'
      } else if (type === 'e') {
        value = null
      } else if (rawValue !== undefined && rawValue.trim() !== '') {
        const n = Number(rawValue)
        value = Number.isFinite(n)
          ? dates.has(style)
            ? serialToIso(n)
            : n
          : decodeXml(rawValue)
      }

      let formula: string | undefined
      const f = /<f\b([^>]*?)(?:\/>|>([\s\S]*?)<\/f>)/.exec(inner)

      if (f) {
        const fAttrs = f[1]
        const fBody = optionalGroup(f, 2)
        const body = fBody === undefined ? '' : decodeXml(fBody).trim()

        if (attribute(fAttrs, 't') === 'shared') {
          const si = attribute(fAttrs, 'si') ?? ''

          if (body) {
            sharedMasters.set(si, { formula: body, row, col })
            formula = body
          } else {
            const master = sharedMasters.get(si)

            if (master) {
              formula = shiftFormula(
                master.formula,
                row - master.row,
                col - master.col,
              )
            }
          }
        } else if (body) {
          formula = body
        }
      }

      // A formula that points at no cell (`TRUE()`, `2*3`) is just a value.
      if (formula !== undefined && !hasReference(formula)) formula = undefined

      if (value === null && formula === undefined) continue
      cells.push({ row, col, cell: formula ? { value, formula } : { value } })
    }
  }

  const rows: OfficeSheet['rows'] = []

  for (const { row, col, cell } of cells) {
    if (row < 1) continue
    const line = (rows[row - 1] ??= [])
    line[col] = cell
  }

  return rows
}

function readXlsx(bytes: Uint8Array): OfficeSheet[] {
  const files = unzipWanted(
    bytes,
    (name) =>
      name === 'xl/workbook.xml' ||
      name === 'xl/_rels/workbook.xml.rels' ||
      name === 'xl/sharedStrings.xml' ||
      name === 'xl/styles.xml' ||
      /^xl\/worksheets\/[^/]+\.xml$/.test(name),
  )

  const workbook = text(files['xl/workbook.xml'])

  if (!workbook) throw new OfficeSheetError('This is not an Excel workbook.')
  const rels = text(files['xl/_rels/workbook.xml.rels'])
  const strings = sharedStrings(text(files['xl/sharedStrings.xml']))
  const dates = dateStyles(text(files['xl/styles.xml']))
  const sheets: OfficeSheet[] = []

  for (const tag of workbook.matchAll(/<sheet\b([^>]*?)\/?>/g)) {
    const name = attribute(tag[1], 'name') ?? `Sheet ${sheets.length + 1}`
    const state = attribute(tag[1], 'state')

    if (state === 'hidden' || state === 'veryHidden') continue
    const rId = attribute(tag[1], 'r:id') ?? attribute(tag[1], 'id')

    const target = rId
      ? new RegExp(`<Relationship\\b[^>]*\\bId="${rId}"[^>]*>`).exec(rels)
      : null

    const targetPath = target
      ? (attribute(target[0], 'Target') ?? '')
      : `worksheets/sheet${sheets.length + 1}.xml`

    const path = targetPath.startsWith('/')
      ? targetPath.slice(1)
      : `xl/${targetPath.replace(/^\.\//, '')}`

    const xml = text(files[path])

    if (!xml) continue
    const rows = parseWorksheet(xml, strings, dates)

    if (rows.some((row) => row?.some(Boolean))) sheets.push({ name, rows })
  }

  return sheets
}

function readOds(bytes: Uint8Array): OfficeSheet[] {
  const files = unzipWanted(bytes, (name) => name === 'content.xml')
  const xml = text(files['content.xml'])

  if (!xml) throw new OfficeSheetError('This is not an OpenDocument sheet.')
  const sheets: OfficeSheet[] = []

  for (const table of xml.matchAll(
    /<table:table\b([^>]*)>([\s\S]*?)<\/table:table>/g,
  )) {
    const name =
      attribute(table[1], 'table:name') ?? `Sheet ${sheets.length + 1}`

    const rows: OfficeSheet['rows'] = []
    let rowIndex = 0
    let count = 0

    for (const row of table[2].matchAll(
      /<table:table-row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/table:table-row>)/g,
    )) {
      const rowRepeat = Math.min(
        Number(attribute(row[1], 'table:number-rows-repeated') ?? 1),
        1000,
      )

      const line: Array<OfficeCell | undefined> = []
      let col = 0

      for (const cell of (optionalGroup(row, 2) ?? '').matchAll(
        /<table:(?:covered-)?table-cell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/table:(?:covered-)?table-cell>)/g,
      )) {
        const colRepeat = Math.min(
          Number(attribute(cell[1], 'table:number-columns-repeated') ?? 1),
          1000,
        )

        const kind = attribute(cell[1], 'office:value-type')
        let value: OfficeCell['value'] = null

        if (kind === 'float' || kind === 'percentage' || kind === 'currency') {
          const n = Number(attribute(cell[1], 'office:value'))
          value = Number.isFinite(n) ? n : null
        } else if (kind === 'boolean') {
          value = attribute(cell[1], 'office:boolean-value') === 'true'
        } else if (kind === 'date') {
          value =
            (attribute(cell[1], 'office:date-value') ?? '').slice(0, 10) || null
        } else if (kind === 'string') {
          value =
            attribute(cell[1], 'office:string-value') ??
            [
              ...(optionalGroup(cell, 2) ?? '').matchAll(
                /<text:p\b[^>]*>([\s\S]*?)<\/text:p>/g,
              ),
            ]
              .map((p) => decodeXml(p[1].replace(/<[^>]*>/g, '')))
              .join('\n')
        }

        if (value !== null) {
          for (let k = 0; k < colRepeat; k++) line[col + k] = { value }
        }

        col += colRepeat
      }

      const filled = line.some(Boolean)

      for (let k = 0; k < rowRepeat; k++) {
        if (filled) {
          if (++count > MAX_CELLS) {
            throw new OfficeSheetError('This worksheet is too large to read.')
          }

          rows[rowIndex] = line.map((cell) => (cell ? { ...cell } : cell))
        }

        rowIndex += 1
      }
    }

    if (rows.some((row) => row?.some(Boolean))) sheets.push({ name, rows })
  }

  return sheets
}

export const XLSX_MEDIA_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export const ODS_MEDIA_TYPE = 'application/vnd.oasis.opendocument.spreadsheet'

/** Whether a file can be made into a sheet. */
export function canMakeSheet(mediaType: string): boolean {
  const type = mediaType.trim().toLowerCase()

  return type === XLSX_MEDIA_TYPE || type === ODS_MEDIA_TYPE
}

/** The worksheets of an .xlsx or .ods file that hold anything. */
export function readOfficeSheets(
  bytes: Uint8Array,
  mediaType: string,
): OfficeSheet[] {
  const type = mediaType.trim().toLowerCase()

  if (type === XLSX_MEDIA_TYPE) return readXlsx(bytes)

  if (type === ODS_MEDIA_TYPE) return readOds(bytes)
  throw new OfficeSheetError(
    'Only .xlsx and .ods files can be made into sheets.',
  )
}

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

export interface MadeSheet {
  state: SheetInstanceState
  /**
   * Columns that held formulas in the file. Their last calculated values were
   * kept; `example` is the formula of the first filled cell.
   */
  formulaColumns: Array<{ label: string; example: string }>
  rowCount: number
  columnCount: number
  /** Data rows left out because the sheet holds at most this many. */
  skippedRows: number
  skippedColumns: number
}

export const SHEET_MAX_ROWS = 10_000
export const SHEET_MAX_COLUMNS = 128
const SHEET_STATE_MAX_BYTES = 1_000_000

const display = (value: OfficeCell['value'] | undefined): string =>
  value === null || value === undefined ? '' : String(value)

const emptyCell = (cell: OfficeCell | undefined) =>
  !cell || (cell.value === null && cell.formula === undefined)

/** The field definition this builder writes into a sheet's state. */
type SheetFieldDefinition = SheetInstanceState['localFields'][number]

function field(input: {
  id: string
  key: string
  label: string
  type: SheetFieldDefinition['logicalType']
  computed?: boolean
}): SheetFieldDefinition {
  return {
    fieldId: input.id,
    key: input.key,
    label: input.label,
    description: null,
    logicalType: input.type,
    nullable: true,
    defaultValue: null,
    cardinality: 'one' as const,
    quantity: null,
    validation: {},
    category: null,
    relationship: null,
    computation: input.computed
      ? { mode: 'computed' as const, expressionId: input.id }
      : { mode: 'stored' as const },
    lifecycle: 'active' as const,
  }
}

/** One worksheet as the state of a new ad-hoc sheet. */
export function buildSheetState(
  sheet: OfficeSheet,
  options: { newId?: () => string } = {},
): MadeSheet {
  const newId = options.newId ?? (() => crypto.randomUUID())
  const rowNumbers: number[] = []
  sheet.rows.forEach((row, index) => {
    if (row?.some((cell) => !emptyCell(cell))) rowNumbers.push(index + 1)
  })

  if (rowNumbers.length === 0) {
    throw new OfficeSheetError('This worksheet is empty.')
  }

  const headerRow = rowNumbers[0]
  const header = sheet.rows[headerRow - 1] ?? []

  const widest = Math.max(
    ...rowNumbers.map((n) => (sheet.rows[n - 1] ?? []).length),
  )

  const allColumns = Array.from({ length: widest }, (_, i) => i)

  const columns = allColumns
    .filter((c) => rowNumbers.some((n) => !emptyCell(sheet.rows[n - 1]?.[c])))
    .slice(0, SHEET_MAX_COLUMNS)

  const skippedColumns =
    allColumns.filter((c) =>
      rowNumbers.some((n) => !emptyCell(sheet.rows[n - 1]?.[c])),
    ).length - columns.length

  let dataRows = rowNumbers.slice(1)
  const skippedRows = Math.max(0, dataRows.length - SHEET_MAX_ROWS)
  dataRows = dataRows.slice(0, SHEET_MAX_ROWS)

  // Headers become labels and keys.
  const taken = new Set<string>()

  const meta = columns.map((c) => {
    const raw = display(header[c]?.value).replace(/\s+/g, ' ').trim()
    const label = (raw || `Column ${columnLetters(c)}`).slice(0, 200)
    const key = columnKeyFromName(label, taken)
    taken.add(key)

    return { c, label, key, id: newId() }
  })

  const fields: SheetInstanceState['localFields'] = []
  const values: SheetInstanceState['localValues'] = {}
  const rowIds = dataRows.map(() => newId())
  const formulaColumns: MadeSheet['formulaColumns'] = []

  for (const m of meta) {
    const cells = dataRows.map((n) => sheet.rows[n - 1]?.[m.c])
    const withFormula = cells.find((cell) => cell?.formula)

    if (withFormula?.formula) {
      formulaColumns.push({
        label: m.label,
        example: `=${withFormula.formula}`,
      })
    }

    const present = cells.filter((cell) => !emptyCell(cell))

    const allNumbers = present.every(
      (cell) => z.number().safeParse(cell?.value).success,
    )

    const allBooleans = present.every(
      (cell) => z.boolean().safeParse(cell?.value).success,
    )

    const type = allBooleans
      ? 'boolean'
      : inferColumnType(present.map((cell) => display(cell?.value).trim()))

    const logical = allNumbers
      ? type === 'integer'
        ? 'integer'
        : 'decimal'
      : ['integer', 'decimal', 'boolean'].includes(type) && !allBooleans
        ? 'text'
        : type === 'timestamp'
          ? 'text'
          : type

    fields.push(field({ id: m.id, key: m.key, label: m.label, type: logical }))
    cells.forEach((cell, i) => {
      if (emptyCell(cell)) return
      const raw = cell?.value

      if (raw === null || raw === undefined) return

      const value =
        logical === 'text'
          ? String(raw).slice(0, 100_000)
          : logical === 'boolean'
            ? raw === true
            : raw

      ;(values[rowIds[i]] ??= {})[m.id] = value
    })
  }

  // Rows with nothing in them still count as rows of the sheet.
  for (const id of rowIds) values[id] ??= {}

  const order = meta.map((m) => m.id)

  const state: SheetInstanceState = {
    bindings: [],
    localFields: fields,
    localValues: values,
    calculationOverrides: {},
    presentation: {
      columnOrder: order,
      hiddenColumnIds: [],
      columnWidths: {},
      frozenColumnCount: 0,
      density: 'standard',
      filters: [],
      sorts: [],
    },
    provenance: { createdFrom: 'ad_hoc' },
  }

  // A sheet's state may not pass 1 MB: drop rows from the end until it fits.
  let kept = rowIds.length
  let extraSkipped = 0

  while (
    kept > 0 &&
    new TextEncoder().encode(JSON.stringify(state)).byteLength >
      SHEET_STATE_MAX_BYTES
  ) {
    const drop = Math.max(1, Math.floor(kept * 0.1))

    for (const id of rowIds.slice(kept - drop, kept))
      delete state.localValues[id]
    kept -= drop
    extraSkipped += drop
  }

  return {
    state,
    formulaColumns,
    rowCount: kept,
    columnCount: meta.length,
    skippedRows: skippedRows + extraSkipped,
    skippedColumns,
  }
}
