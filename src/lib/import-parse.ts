/**
 * DATA-01 import parsers. Files and clipboard become a tabular preview.
 * This module does not write Datasets or Records.
 */
/**
 * DSET-05.6 — import limits.
 *
 * Sized from the real exports this flow exists for, measured 2026-10-04:
 *  - a 96-well plate reader export is ~96 data rows per plate; a plate-map
 *    workbook with several plates and metadata sheets runs to a few MiB;
 *  - a 14-day bioreactor trend export sampled once a minute is
 *    14 × 24 × 60 = 20,160 rows per signal, and a wide export with several
 *    signals is ~100k rows of text.
 * The previous 10 MiB / 1,000-row cap rejected both. Parsing runs on the
 * server (never in the browser) so the larger bound does not load the file
 * into the client.
 */
export const IMPORT_LIMITS = {
  bytes: 64 * 1024 * 1024,
  rows: 100_000,
} as const

export type ImportFormat = 'csv' | 'tsv' | 'json' | 'xlsx' | 'clipboard'

export type ImportDelimiter = ',' | ';' | '\t'

export interface ImportSheet {
  name: string
  headers: string[]
  rows: Array<Record<string, string>>
}

export interface ImportPreview {
  format: ImportFormat
  sheets: ImportSheet[]
  detectedTypes: string[]
}

export class ImportParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImportParseError'
  }
}

export function sniffImportFormat(
  fileName: string,
  textHint?: string,
): ImportFormat {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.xlsx')) return 'xlsx'
  if (lower.endsWith('.json')) return 'json'
  if (lower.endsWith('.tsv') || lower.endsWith('.tab')) return 'tsv'
  if (lower.endsWith('.csv')) return 'csv'
  const trimmed = textHint?.trimStart() ?? ''
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json'
  if (trimmed.includes('\t')) return 'tsv'
  return 'csv'
}

export async function parseImportBytes(
  bytes: ArrayBuffer,
  options: {
    fileName?: string
    format?: ImportFormat
    delimiter?: ImportDelimiter
    header?: boolean
    sheetName?: string
  } = {},
): Promise<ImportPreview> {
  if (bytes.byteLength > IMPORT_LIMITS.bytes) {
    throw new ImportParseError(
      `Import file exceeds ${Math.round(IMPORT_LIMITS.bytes / (1024 * 1024))} MB.`,
    )
  }
  const format =
    options.format ?? sniffImportFormat(options.fileName ?? '', undefined)
  if (format === 'xlsx') return parseXlsx(bytes, options.header !== false)
  const text = decodeText(bytes)
  return parseImportText(text, {
    format: format === 'clipboard' ? undefined : format,
    delimiter: options.delimiter,
    header: options.header,
  })
}

export function parseImportText(
  text: string,
  options: {
    format?: ImportFormat
    delimiter?: ImportDelimiter
    header?: boolean
  } = {},
): ImportPreview {
  const trimmed = text.replace(/^\uFEFF/, '')
  if (!trimmed.trim()) throw new ImportParseError('Import contains no data.')
  const format =
    options.format && options.format !== 'clipboard'
      ? options.format
      : sniffImportFormat('', trimmed)
  if (format === 'json') return parseJsonTable(trimmed)
  if (format === 'xlsx') {
    throw new ImportParseError('XLSX must be parsed from binary bytes.')
  }
  const delimiter =
    options.delimiter ?? (format === 'tsv' ? '\t' : detectDelimiter(trimmed))
  return {
    format: format === 'clipboard' ? 'clipboard' : format,
    sheets: [
      delimitedToSheet(
        trimmed,
        delimiter,
        options.header !== false,
        format === 'tsv' ? 'Clipboard' : 'Sheet 1',
      ),
    ],
    detectedTypes: [],
  }
}

export function selectImportSheet(
  preview: ImportPreview,
  sheetName?: string,
): ImportSheet {
  if (!preview.sheets.length) throw new ImportParseError('No sheets found.')
  const first = preview.sheets.at(0)
  if (!sheetName) {
    if (!first) throw new ImportParseError('No sheets found.')
    return first
  }
  const match = preview.sheets.find((sheet) => sheet.name === sheetName)
  if (!match) throw new ImportParseError(`Sheet "${sheetName}" was not found.`)
  return match
}

function decodeText(bytes: ArrayBuffer): string {
  try {
    let text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
    return text
  } catch {
    throw new ImportParseError('File is not valid UTF-8 text.')
  }
}

export function detectDelimiter(text: string): ImportDelimiter {
  const first = text.split(/\r?\n/, 1)[0] ?? ''
  const tabs = (first.match(/\t/g) ?? []).length
  const semis = (first.match(/;/g) ?? []).length
  const commas = (first.match(/,/g) ?? []).length
  if (tabs > commas && tabs >= semis) return '\t'
  if (semis > commas) return ';'
  return ','
}

export function parseDelimited(text: string, delimiter: ImportDelimiter) {
  const rows: string[][] = []
  let row: string[] = []
  let parts: string[] = []
  let start = 0
  let quoted = false
  const finishCell = (end: number) => {
    const tail = text.slice(start, end)
    row.push(parts.length ? parts.join('') + tail : tail)
    parts = []
  }
  for (let index = 0; index < text.length; index++) {
    const character = text.charAt(index)
    if (quoted) {
      if (character === '"') {
        parts.push(text.slice(start, index))
        if (text[index + 1] === '"') {
          parts.push('"')
          index++
        } else quoted = false
        start = index + 1
      }
      continue
    }
    if (character === '"') {
      if (index > start || parts.some(Boolean))
        throw new ImportParseError(`Malformed CSV near character ${index + 1}.`)
      quoted = true
      start = index + 1
    } else if (character === delimiter) {
      finishCell(index)
      start = index + 1
    } else if (character === '\n' || character === '\r') {
      finishCell(index)
      if (character === '\r' && text[index + 1] === '\n') index++
      rows.push(row)
      row = []
      start = index + 1
    }
  }
  if (quoted)
    throw new ImportParseError('Malformed CSV: quoted field is not closed.')
  if (start < text.length || parts.length || row.length) {
    finishCell(text.length)
    rows.push(row)
  }
  return rows
}

function delimitedToSheet(
  text: string,
  delimiter: ImportDelimiter,
  header: boolean,
  name: string,
): ImportSheet {
  const matrix = parseDelimited(text, delimiter)
  return matrixToSheet(matrix, header, name)
}

function matrixToSheet(
  matrix: string[][],
  header: boolean,
  name: string,
): ImportSheet {
  const usable = matrix.filter((row) => row.some((cell) => cell.trim() !== ''))
  if (!usable.length) throw new ImportParseError('Import contains no data.')
  // Instrument exports prefix the table with a `# Key: value` metadata block.
  // Skip those leading comment lines so the header row is the first real row.
  if (header) {
    let firstRow = 0
    while (
      firstRow < usable.length &&
      (usable[firstRow]?.[0] ?? '').trimStart().startsWith('#')
    ) {
      firstRow += 1
    }
    usable.splice(0, firstRow)
    if (!usable.length) throw new ImportParseError('Import contains no data.')
  }
  const width = usable.reduce((max, row) => Math.max(max, row.length), 0)
  const rawHeaders = header
    ? usable.shift()!
    : Array.from({ length: width }, (_, index) => `Column ${index + 1}`)
  const headers = uniquifyHeaders(
    rawHeaders.map((value, index) => value.trim() || `Column ${index + 1}`),
  )
  if (usable.length > IMPORT_LIMITS.rows) {
    throw new ImportParseError(
      `Import exceeds ${IMPORT_LIMITS.rows.toLocaleString()} rows.`,
    )
  }
  const rows = usable.map((row) =>
    Object.fromEntries(headers.map((h, index) => [h, row[index] ?? ''])),
  )
  return { name, headers, rows }
}

export function uniquifyHeaders(headers: string[]): string[] {
  const seen = new Map<string, number>()
  return headers.map((header) => {
    const count = seen.get(header) ?? 0
    seen.set(header, count + 1)
    return count === 0 ? header : `${header} (${count + 1})`
  })
}

function parseJsonTable(text: string): ImportPreview {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new ImportParseError('JSON is not valid.')
  }
  if (Array.isArray(parsed)) {
    return {
      format: 'json',
      sheets: [recordsToSheet(parsed, 'Sheet 1')],
      detectedTypes: [],
    }
  }
  if (parsed && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>
    if (Array.isArray(record.sheets)) {
      const sheets = record.sheets.map((item, index) => {
        if (item && typeof item === 'object') {
          const sheet = item as Record<string, unknown>
          const name =
            typeof sheet.name === 'string' ? sheet.name : `Sheet ${index + 1}`
          if (Array.isArray(sheet.rows)) {
            return recordsToSheet(sheet.rows, name)
          }
        }
        throw new ImportParseError('JSON sheets must include a rows array.')
      })
      return { format: 'json', sheets, detectedTypes: [] }
    }
    if (Array.isArray(record.rows)) {
      return {
        format: 'json',
        sheets: [recordsToSheet(record.rows, 'Sheet 1')],
        detectedTypes: [],
      }
    }
  }
  throw new ImportParseError(
    'JSON must be an array of objects or { rows: [...] }.',
  )
}

function recordsToSheet(rows: unknown[], name: string): ImportSheet {
  if (!rows.length) throw new ImportParseError('JSON contains no rows.')
  if (rows.length > IMPORT_LIMITS.rows) {
    throw new ImportParseError(
      `Import exceeds ${IMPORT_LIMITS.rows.toLocaleString()} rows.`,
    )
  }
  if (rows.every((row) => Array.isArray(row))) {
    return matrixToSheet(
      rows.map((row) => (row as unknown[]).map((cell) => stringifyCell(cell))),
      true,
      name,
    )
  }
  const objects = rows.map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new ImportParseError(`JSON row ${index + 1} is not an object.`)
    }
    return row as Record<string, unknown>
  })
  const headers: string[] = []
  for (const row of objects) {
    for (const key of Object.keys(row)) {
      if (!headers.includes(key)) headers.push(key)
    }
  }
  if (!headers.length) throw new ImportParseError('JSON objects have no keys.')
  return {
    name,
    headers,
    rows: objects.map((row) =>
      Object.fromEntries(
        headers.map((header) => [header, stringifyCell(row[header])]),
      ),
    ),
  }
}

function stringifyCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'boolean' || typeof value === 'number') {
    return String(value)
  }
  return JSON.stringify(value)
}

async function parseXlsx(
  bytes: ArrayBuffer,
  header: boolean,
): Promise<ImportPreview> {
  const sheets: ImportSheet[] = []
  for (const { name, matrix } of await readXlsxMatrices(bytes)) {
    sheets.push(matrixToSheet(matrix, header, name))
  }
  if (!sheets.length) throw new ImportParseError('XLSX worksheets are empty.')
  return { format: 'xlsx', sheets, detectedTypes: [] }
}

/** Does this look like an .xlsx workbook (a ZIP archive)? */
export function isXlsxBytes(bytes: Uint8Array): boolean {
  return (
    bytes.length > 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  )
}

/** Every worksheet with data, as the rows and cells it holds (no header handling). */
export async function readXlsxMatrices(
  bytes: ArrayBuffer,
): Promise<Array<{ name: string; matrix: string[][] }>> {
  const files = await unzip(bytes)
  const workbook = textFromZip(files, 'xl/workbook.xml')
  if (!workbook) throw new ImportParseError('XLSX is missing xl/workbook.xml.')
  const rels = textFromZip(files, 'xl/_rels/workbook.xml.rels') ?? ''
  const shared = parseSharedStrings(
    textFromZip(files, 'xl/sharedStrings.xml') ?? '',
  )
  const dateStyles = parseDateStyles(textFromZip(files, 'xl/styles.xml') ?? '')
  const sheets: Array<{ name: string; matrix: string[][] }> = []
  const sheetTags = [...workbook.matchAll(/<sheet\b([^>]*)\/>/g)]
  if (!sheetTags.length) throw new ImportParseError('XLSX has no worksheets.')
  for (const tag of sheetTags) {
    const attrs = tag[1] || ''
    const name = xmlAttr(attrs, 'name') ?? `Sheet ${sheets.length + 1}`
    const rId = xmlAttr(attrs, 'r:id') ?? xmlAttr(attrs, 'id')
    const target = rId
      ? relTarget(rels, rId)
      : `worksheets/sheet${sheets.length + 1}.xml`
    const path = target.startsWith('/')
      ? target.slice(1)
      : `xl/${target.replace(/^\.\//, '')}`
    const xml = textFromZip(files, path)
    if (!xml) continue
    const matrix = parseWorksheet(xml, shared, dateStyles)
    if (!matrix.length) continue
    sheets.push({ name, matrix })
  }
  return sheets
}

/** Rows and cells as comma-separated text, quoting what needs it. */
export function matrixToCsv(matrix: string[][]): string {
  const cell = (value: string) =>
    /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
  return `${matrix.map((row) => row.map(cell).join(',')).join('\n')}\n`
}

function textFromZip(
  files: Map<string, Uint8Array>,
  path: string,
): string | null {
  const bytes = files.get(path) ?? files.get(path.replace(/^\//, ''))
  if (!bytes) return null
  return new TextDecoder('utf-8').decode(bytes)
}

function capture(match: RegExpMatchArray, index: number): string {
  return match[index] || ''
}

function xmlAttr(attrs: string, name: string): string | null {
  const match = attrs.match(new RegExp(`${name}="([^"]*)"`))
  return match ? xmlDecode(capture(match, 1)) : null
}

function relTarget(rels: string, rId: string): string {
  const match = rels.match(
    new RegExp(`<Relationship\\b[^>]*Id="${rId}"[^>]*Target="([^"]+)"`),
  )
  return match?.[1] ?? `worksheets/sheet1.xml`
}

function parseSharedStrings(xml: string): string[] {
  if (!xml) return []
  const items: string[] = []
  for (const block of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    const texts = [
      ...capture(block, 1).matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g),
    ].map((match) => xmlDecode(capture(match, 1)))
    items.push(texts.join(''))
  }
  return items
}

function parseDateStyles(xml: string): Set<number> {
  const dates = new Set<number>()
  if (!xml) return dates
  const custom = new Map<number, string>()
  for (const match of xml.matchAll(
    /<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g,
  )) {
    custom.set(Number(capture(match, 1)), xmlDecode(capture(match, 2)))
  }
  const cellXfs = xml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? ''
  let index = 0
  for (const xf of cellXfs.matchAll(/<xf\b([^>]*)\/?>/g)) {
    const numFmtId = Number(xmlAttr(capture(xf, 1), 'numFmtId') ?? '0')
    const code = custom.get(numFmtId) ?? ''
    if (isExcelDateFormat(numFmtId, code)) dates.add(index)
    index += 1
  }
  return dates
}

function isExcelDateFormat(numFmtId: number, code: string): boolean {
  if ([14, 15, 16, 17, 22, 45, 46, 47].includes(numFmtId)) return true
  return /[ymdhs]/i.test(code) && !/[[\]]/.test(code)
}

function parseWorksheet(
  xml: string,
  shared: string[],
  dateStyles: Set<number>,
): string[][] {
  const rows: string[][] = []
  for (const rowXml of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = new Map<number, string>()
    let maxCol = -1
    for (const cell of capture(rowXml, 1).matchAll(
      /<c\b([^>]*)>([\s\S]*?)<\/c>/g,
    )) {
      const attrs = capture(cell, 1)
      const ref = xmlAttr(attrs, 'r')
      const type = xmlAttr(attrs, 't')
      const style = Number(xmlAttr(attrs, 's') ?? 'NaN')
      const col = ref ? colFromA1(ref) : maxCol + 1
      maxCol = Math.max(maxCol, col)
      const inner = capture(cell, 2)
      const inline = inner.match(/<is\b[^>]*>[\s\S]*?<t\b[^>]*>([\s\S]*?)<\/t>/)
      const value = inner.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)
      let text = ''
      if (type === 's' && value) {
        text = shared[Number(xmlDecode(capture(value, 1)))] ?? ''
      } else if (type === 'inlineStr' && inline) {
        text = xmlDecode(capture(inline, 1))
      } else if (type === 'b' && value) {
        text = xmlDecode(capture(value, 1)) === '1' ? 'true' : 'false'
      } else if (value) {
        const raw = xmlDecode(capture(value, 1))
        if (
          type !== 's' &&
          dateStyles.has(style) &&
          /^-?\d+(\.\d+)?$/.test(raw)
        ) {
          text = excelSerialToIso(Number(raw))
        } else {
          text = raw
        }
      }
      cells.set(col, text)
    }
    if (maxCol < 0) continue
    const row = Array.from(
      { length: maxCol + 1 },
      (_, index) => cells.get(index) ?? '',
    )
    rows.push(row)
  }
  return rows
}

function colFromA1(ref: string): number {
  const letters = /^[A-Z]+/i.exec(ref)?.[0] ?? 'A'
  let n = 0
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

function excelSerialToIso(serial: number): string {
  const epoch = Date.UTC(1899, 11, 30)
  const ms = epoch + Math.round(serial * 86400000)
  return new Date(ms).toISOString().slice(0, 10)
}

function xmlDecode(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&')
}

const SIG_CENTRAL = 0x02014b50
const SIG_EOCD = 0x06054b50

async function unzip(buffer: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)
  const eocd = findEocd(view, bytes.length)
  const count = view.getUint16(eocd + 10, true)
  let offset = view.getUint32(eocd + 16, true)
  const files = new Map<string, Uint8Array>()
  for (let index = 0; index < count; index++) {
    if (view.getUint32(offset, true) !== SIG_CENTRAL) {
      throw new ImportParseError('XLSX ZIP directory is corrupt.')
    }
    const method = view.getUint16(offset + 10, true)
    const compact = view.getUint32(offset + 20, true)
    const nameLen = view.getUint16(offset + 28, true)
    const extraLen = view.getUint16(offset + 30, true)
    const commentLen = view.getUint16(offset + 32, true)
    const localOffset = view.getUint32(offset + 42, true)
    const name = new TextDecoder().decode(
      bytes.subarray(offset + 46, offset + 46 + nameLen),
    )
    const localNameLen = view.getUint16(localOffset + 26, true)
    const localExtraLen = view.getUint16(localOffset + 28, true)
    const dataStart = localOffset + 30 + localNameLen + localExtraLen
    const compressed = bytes.subarray(dataStart, dataStart + compact)
    let raw: Uint8Array
    if (method === 0) raw = compressed.slice()
    else if (method === 8) raw = await inflateRaw(compressed)
    else throw new ImportParseError(`Unsupported ZIP compression (${method}).`)
    if (!name.endsWith('/')) files.set(name, raw)
    offset += 46 + nameLen + extraLen + commentLen
  }
  return files
}

function findEocd(view: DataView, length: number): number {
  const min = Math.max(0, length - 65557)
  for (let index = length - 22; index >= min; index--) {
    if (view.getUint32(index, true) === SIG_EOCD) return index
  }
  throw new ImportParseError('Not a valid XLSX file.')
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'function') {
    throw new ImportParseError('Cannot inflate XLSX in this environment.')
  }
  const copy = data.slice()
  const buffer = copy.buffer
  if (!(buffer instanceof ArrayBuffer)) {
    throw new ImportParseError('Cannot inflate XLSX in this environment.')
  }
  const stream = new Blob([buffer])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** Test helper: build an uncompressed ZIP (store method) from path → bytes. */
export function zipStore(
  files: Record<string, string | Uint8Array>,
): ArrayBuffer {
  const encoded = Object.entries(files).map(([name, content]) => {
    const data =
      typeof content === 'string' ? new TextEncoder().encode(content) : content
    return { name, data, crc: crc32(data) }
  })
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let offset = 0
  for (const file of encoded) {
    const nameBytes = new TextEncoder().encode(file.name)
    const local = new Uint8Array(30 + nameBytes.length + file.data.length)
    const localView = new DataView(local.buffer)
    localView.setUint32(0, 0x04034b50, true)
    localView.setUint16(4, 20, true)
    localView.setUint16(8, 0, true)
    localView.setUint32(14, file.crc, true)
    localView.setUint32(18, file.data.length, true)
    localView.setUint32(22, file.data.length, true)
    localView.setUint16(26, nameBytes.length, true)
    local.set(nameBytes, 30)
    local.set(file.data, 30 + nameBytes.length)
    localParts.push(local)
    const central = new Uint8Array(46 + nameBytes.length)
    const centralView = new DataView(central.buffer)
    centralView.setUint32(0, SIG_CENTRAL, true)
    centralView.setUint16(4, 20, true)
    centralView.setUint16(6, 20, true)
    centralView.setUint32(16, file.crc, true)
    centralView.setUint32(20, file.data.length, true)
    centralView.setUint32(24, file.data.length, true)
    centralView.setUint16(28, nameBytes.length, true)
    centralView.setUint32(42, offset, true)
    central.set(nameBytes, 46)
    centralParts.push(central)
    offset += local.length
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)
  const eocd = new Uint8Array(22)
  const eocdView = new DataView(eocd.buffer)
  eocdView.setUint32(0, SIG_EOCD, true)
  eocdView.setUint16(8, encoded.length, true)
  eocdView.setUint16(10, encoded.length, true)
  eocdView.setUint32(12, centralSize, true)
  eocdView.setUint32(16, offset, true)
  const total = offset + centralSize + 22
  const out = new Uint8Array(total)
  let cursor = 0
  for (const part of localParts) {
    out.set(part, cursor)
    cursor += part.length
  }
  for (const part of centralParts) {
    out.set(part, cursor)
    cursor += part.length
  }
  out.set(eocd, cursor)
  return out.buffer
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let i = 0; i < 8; i++) {
      const mask = -(crc & 1)
      crc = (crc >>> 1) ^ (0xedb88320 & mask)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}
