/**
 * A list's rows as a file a person can open in a spreadsheet: CSV, or a plain
 * Excel workbook. Browser-safe (no node modules), because the table the person
 * is looking at is what they are exporting.
 */
import { zipSync, strToU8 } from 'fflate'

import { csvEscape } from './delimited'

export type ExportValue = string | number | boolean | null | undefined

export interface ExportTable {
  headers: string[]
  rows: ExportValue[][]
}

function text(value: ExportValue): string {
  return value === null || value === undefined ? '' : String(value)
}

const BOM = String.fromCharCode(0xfeff)

/** CSV with a byte-order mark so Excel reads accented names correctly. */
export function tableCsv({ headers, rows }: ExportTable): string {
  const line = (cells: ExportValue[]) =>
    cells.map((cell) => csvEscape(text(cell), ',')).join(',')
  return `${BOM}${[line(headers), ...rows.map(line)].join('\r\n')}\r\n`
}

function xmlEscape(value: string): string {
  // Control characters (other than tab, newline and return) are not allowed
  // in XML 1.0 text.
  let clean = ''
  for (const char of value) {
    const code = char.charCodeAt(0)
    if (code >= 0x20 || code === 0x09 || code === 0x0a || code === 0x0d)
      clean += char
  }
  return clean
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/** A1-style column letters: 0 → A, 26 → AA. */
export function columnLetters(index: number): string {
  let name = ''
  let n = index
  while (n >= 0) {
    name = String.fromCharCode(65 + (n % 26)) + name
    n = Math.floor(n / 26) - 1
  }
  return name
}

function cellXml(ref: string, value: ExportValue): string {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'number' && Number.isFinite(value))
    return `<c r="${ref}"><v>${value}</v></c>`
  if (typeof value === 'boolean')
    return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(String(value))}</t></is></c>`
}

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

/** The sheet name Excel accepts: no \ / ? * [ ] :, at most 31 characters. */
export function sheetName(name: string): string {
  const clean = name
    .replace(/[\\/?*[\]:]/g, ' ')
    .trim()
    .slice(0, 31)
  return xmlEscape(clean || 'Sheet1')
}

/** A one-sheet .xlsx workbook; the header row is bold-free plain text. */
export function tableXlsx(table: ExportTable, name = 'Sheet1'): Uint8Array {
  const all = [table.headers, ...table.rows]
  const sheetRows = all
    .map(
      (cells, r) =>
        `<row r="${r + 1}">${cells
          .map((value, c) => cellXml(`${columnLetters(c)}${r + 1}`, value))
          .join('')}</row>`,
    )
    .join('')
  return zipSync({
    '[Content_Types].xml': strToU8(
      `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
        `</Types>`,
    ),
    '_rels/.rels': strToU8(
      `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    'xl/workbook.xml': strToU8(
      `${XML}<workbook xmlns="${MAIN}" xmlns:r="${REL}"><sheets>` +
        `<sheet name="${sheetName(name)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    ),
    'xl/worksheets/sheet1.xml': strToU8(
      `${XML}<worksheet xmlns="${MAIN}"><sheetData>${sheetRows}</sheetData></worksheet>`,
    ),
  })
}

export const XLSX_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
