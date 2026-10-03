/**
 * DATA-02 export serializers.
 *
 * Every serializer is deterministic: identical inputs produce byte-identical
 * outputs. Wall-clock timestamps are deliberately excluded from content —
 * export provenance lives in the `data_exports` receipt table instead.
 * Decimal values inherit the canonical Dataset contract's JSON number
 * encoding (IEEE double rounding applies beyond ~15 significant digits;
 * documented boundary).
 *
 * Streaming first: CSV/TSV/JSON/NDJSON render line-by-line so the HTTP
 * response never holds the whole document. XLSX and Parquet need bounded
 * materialisation (PARQUET_MAX_ROWS cap) and are documented as such.
 *
 * Formats: CSV / TSV (RFC 4180 quoting), JSON, NDJSON, XLSX (minimal OOXML,
 * inline strings, ISO date text) and Parquet via parquet-wasm.
 */
import { ZipWriter } from './zip'
import type { ExportField, ExportRow } from './delimited'

// The dependency-free delimited helpers live in `./delimited` so client code
// can build a CSV without pulling `node:zlib` (via `./zip`) into the browser.
export { delimitedHeaderLine, delimitedRowLine, formatCell } from './delimited'
export type { ExportField, ExportRow } from './delimited'

export const EXPORT_FORMATS = [
  'csv',
  'tsv',
  'json',
  'ndjson',
  'xlsx',
  'parquet',
] as const

export type ExportFormat = (typeof EXPORT_FORMATS)[number]

export function isExportFormat(value: unknown): value is ExportFormat {
  return (
    typeof value === 'string' &&
    (EXPORT_FORMATS as readonly string[]).includes(value)
  )
}

/** Hard cap for formats that materialise column arrays (Parquet). */
export const PARQUET_MAX_ROWS = 200_000

// ---------------------------------------------------------------------------
// Metadata envelope.
// ---------------------------------------------------------------------------

export interface ExportMetaInput {
  kind:
    | 'sheetbase.dataset.export'
    | 'sheetbase.dataset-version.export'
    | 'sheetbase.sheet-instance.export'
    | 'sheetbase.record.export'
  state: 'live' | 'version' | 'evidence'
  objectId: string
  workspaceId: string
  name: string
  fields?: ExportField[]
  sourceRevision?: number | string
  datasetVersion?: {
    datasetVersionId: string
    sourceDatasetRevision: number | string
    label: string
    schemaVersionId: string
  }
  notes: string[]
}

/**
 * Build the `_meta` envelope embedded in JSON exports and the XLSX Metadata
 * sheet. Key order is fixed construction order, so output is deterministic.
 */
export function buildExportMeta(
  input: ExportMetaInput,
): Record<string, unknown> {
  const meta: Record<string, unknown> = {
    kind: input.kind,
    state: input.state,
    objectId: input.objectId,
    workspaceId: input.workspaceId,
    name: input.name,
  }
  if (input.sourceRevision !== undefined)
    meta.sourceRevision = input.sourceRevision
  if (input.datasetVersion) meta.datasetVersion = input.datasetVersion
  if (input.fields) {
    meta.schema = input.fields.map((f) => ({
      key: f.key,
      label: f.label,
      logicalType: f.logicalType,
      nullable: f.nullable,
      unit: f.unit,
    }))
  }
  meta.notes = input.notes
  return meta
}

export const LIVE_STATE_NOTE =
  'Live export: reflects mutable workspace state as of the last queried page. ' +
  'This file is NOT immutable evidence.'
export const VERSION_STATE_NOTE =
  'Dataset Version export: immutable snapshot evidence pinned at snapshot time.'

// ---------------------------------------------------------------------------
// Value formatting.
// ---------------------------------------------------------------------------

/** Canonical row object used by JSON/NDJSON exports (keyed by field id). */
export function rowJsonObject(row: ExportRow): Record<string, unknown> {
  return { rowId: row.rowId, revision: row.revision, values: row.values }
}

// ---------------------------------------------------------------------------
// XLSX (minimal OOXML: two worksheets, inline strings, no shared strings).
// ---------------------------------------------------------------------------

function xmlEscape(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export function columnName(index: number): string {
  let name = ''
  let n = index
  while (n >= 0) {
    name = String.fromCharCode(65 + (n % 26)) + name
    n = Math.floor(n / 26) - 1
  }
  return name
}

interface XlsxCell {
  kind: 'inline' | 'number' | 'boolean'
  inline?: string
  number?: number
}

function xlsxCellFor(value: unknown): XlsxCell {
  if (value === null || value === undefined)
    return { kind: 'inline', inline: '' }
  if (typeof value === 'number' && Number.isFinite(value))
    return { kind: 'number', number: value }
  if (typeof value === 'bigint')
    return { kind: 'number', number: Number(value) }
  if (value === true || value === false)
    return { kind: 'boolean', number: value ? 1 : 0 }
  return { kind: 'inline', inline: String(value) }
}

function worksheetXml(rowsXml: string[]): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetData>${rowsXml.join('')}</sheetData>` +
    `</worksheet>`
  )
}

function inlineCell(ref: string, text: string): string {
  return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(text)}</t></is></c>`
}

function dataCell(ref: string, cell: XlsxCell): string {
  if (cell.kind === 'inline') return inlineCell(ref, cell.inline ?? '')
  if (cell.kind === 'boolean')
    return `<c r="${ref}" t="b"><v>${cell.number}</v></c>`
  return `<c r="${ref}"><v>${cell.number}</v></c>`
}

/**
 * Build an XLSX file: sheet "data" holds the tabular export; sheet
 * "Metadata" carries schema/unit/provenance information so spreadsheet users
 * see units without opening a second file.
 */
export async function xlsxDocument(
  fields: ExportField[],
  rows: Iterable<ExportRow>,
  metaLines: Array<[string, string]>,
): Promise<Uint8Array> {
  const dataRows: string[] = [
    `<row r="1">${fields
      .map((f, i) => inlineCell(`${columnName(i)}1`, f.label))
      .join('')}</row>`,
  ]
  let rowIndex = 2
  for (const row of rows) {
    const cells = fields
      .map((f, i) =>
        dataCell(`${columnName(i)}${rowIndex}`, xlsxCellFor(row.values[f.id])),
      )
      .join('')
    dataRows.push(`<row r="${rowIndex}">${cells}</row>`)
    rowIndex += 1
  }

  const metaRows: string[] = [
    `<row r="1">${inlineCell('A1', 'Key')}${inlineCell('B1', 'Value')}</row>`,
  ]
  let metaIndex = 2
  for (const [key, value] of metaLines) {
    metaRows.push(
      `<row r="${metaIndex}">` +
        inlineCell(`A${metaIndex}`, key) +
        inlineCell(`B${metaIndex}`, String(value)) +
        `</row>`,
    )
    metaIndex += 1
  }

  const parts: Array<[string, string]> = [
    ['[Content_Types].xml', contentTypesXml()],
    ['_rels/.rels', rootRelsXml()],
    ['xl/workbook.xml', workbookXml()],
    ['xl/_rels/workbook.xml.rels', workbookRelsXml()],
    ['xl/styles.xml', stylesXml()],
    ['xl/worksheets/sheet1.xml', worksheetXml(dataRows)],
    ['xl/worksheets/sheet2.xml', worksheetXml(metaRows)],
  ]

  // XLSX is a ZIP of OOXML parts; reuse the deterministic ZIP container.
  const writer = new ZipWriter()
  for (const [name, content] of parts) writer.add(name, content)
  return writer.stream()
}

function contentTypesXml(): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
    `<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    `</Types>`
  )
}

function rootRelsXml(): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`
  )
}

function workbookXml(): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets>` +
    `<sheet name="data" sheetId="1" r:id="rId1"/>` +
    `<sheet name="Metadata" sheetId="2" r:id="rId2"/>` +
    `</sheets></workbook>`
  )
}

function workbookRelsXml(): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>` +
    `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `</Relationships>`
  )
}

function stylesXml(): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006-main"/>`
  )
}
