/**
 * What a plugin's importers, connectors, exporters and previews hand to the
 * rest of the app, and the browser side of calling them.
 *
 * An importer or a connector makes a table; the table becomes a CSV file and
 * goes through the same upload, mapping and check steps as any file the person
 * picked, so a plugin never has its own way of writing to a dataset. An
 * exporter makes a file the person saves. Browser safe: server work happens in
 * `data-route.server.ts`.
 */
import { z } from 'zod'

import { csvEscape } from '../export/delimited'
import { runFailure } from './use-extension-points'
import type {
  ExtensionExporterDeclaration,
  ExtensionInstrumentParserDeclaration,
} from './data-points'

/** A value a plugin hands over or receives: JSON, and only JSON. */
type PluginJson = z.core.util.JSONType

/** One plugin row: a column name to the JSON it holds. */
export type PluginRow = Record<string, PluginJson>

export interface PluginTable {
  columns: string[]
  rows: PluginRow[]
}

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.')

  return dot < 0 ? '' : name.slice(dot).toLowerCase()
}

/** A table as a CSV file the import flow reads like any other. */
export function tableToCsvFile(table: PluginTable, filename: string): File {
  const lines = [
    table.columns.map((column) => csvEscape(column, ',')).join(','),
    ...table.rows.map((row) =>
      table.columns
        .map((column) => {
          return csvEscape(pluginCellText(row[column]), ',')
        })
        .join(','),
    ),
  ]

  return new File([lines.join('\n') + '\n'], filename, { type: 'text/csv' })
}

/** A plugin cell as CSV text: empty for nothing, JSON for a nested value, its own text otherwise. */
function pluginCellText(value: PluginJson | undefined): string {
  if (value === null || value === undefined) return ''

  const flag = booleanValue.safeParse(value)

  if (flag.success) return flag.data ? 'true' : 'false'

  const number = numberValue.safeParse(value)

  if (number.success) return String(number.data)

  const text = stringValue.safeParse(value)

  if (text.success) return text.data

  return JSON.stringify(value)
}

/** `sequences.fasta` becomes `sequences.csv`. */
export function csvNameFor(filename: string): string {
  const dot = filename.lastIndexOf('.')

  return `${dot > 0 ? filename.slice(0, dot) : filename}.csv`
}

const stringValue = z.string()
const numberValue = z.number()
const booleanValue = z.boolean()

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- A plugin call's body is serialised straight to the plugin route; connector parameters arrive as the values the connector's own fields produced.
async function post<T>(body: unknown): Promise<T> {
  const response = await fetch('/api/plugins/data', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) throw await runFailure(response)

  // SAFETY: The caller selects T for this generic plugin transport; a failed HTTP response is rejected above and each caller's documented answer is T.
  return (await response.json()) as T
}

/** A file's bytes as text, or base64 for a format that is not text. */
export async function readFileContent(
  file: File,
  encoding: 'text' | 'base64',
): Promise<string> {
  if (encoding === 'text') return file.text()
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''

  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))

  return btoa(binary)
}

export async function readWithImporter(args: {
  extensionKey: string
  importerId: string
  encoding: 'text' | 'base64'
  file: File
}): Promise<File> {
  const table = await post<PluginTable>({
    kind: 'import',
    extensionKey: args.extensionKey,
    importerId: args.importerId,
    filename: args.file.name,
    content: await readFileContent(args.file, args.encoding),
  })

  return tableToCsvFile(table, csvNameFor(args.file.name))
}

/** The instrument parser that reads a file, if one of the installed plugins does. */
export function pickInstrumentParser<
  T extends { declaration: ExtensionInstrumentParserDeclaration },
>(parsers: readonly T[], filename: string, text: string | null): T | undefined {
  const extension = fileExtension(filename)

  return parsers.find(({ declaration }) => {
    if (!declaration.extensions.includes(extension)) return false

    // A parser that names text to look for only takes a text file that has it.
    if (!declaration.contains) return true

    if (declaration.encoding !== 'text' || text === null) return true

    return declaration.contains.some((needle) => text.includes(needle))
  })
}

/** Reads an instrument's file with a plugin parser; the table goes through the usual import steps. */
export async function readWithInstrumentParser(args: {
  extensionKey: string
  parserId: string
  encoding: 'text' | 'base64'
  file: File
}): Promise<File> {
  const table = await post<PluginTable>({
    kind: 'instrument-parse',
    extensionKey: args.extensionKey,
    parserId: args.parserId,
    filename: args.file.name,
    content: await readFileContent(args.file, args.encoding),
  })

  return tableToCsvFile(table, csvNameFor(args.file.name))
}

export type PluginBarcodeDrawing =
  { kind: 'bars'; modules: string } | { kind: 'grid'; rows: string[] }

/** The code a plugin barcode format draws for a value. */
export async function drawPluginBarcode(args: {
  extensionKey: string
  formatId: string
  value: string
}): Promise<PluginBarcodeDrawing> {
  return post<PluginBarcodeDrawing>({ kind: 'barcode', ...args })
}

/** What a scanned text stands for, by a plugin barcode format; null when it is not one of its codes. */
export async function parseWithPluginBarcode(args: {
  extensionKey: string
  formatId: string
  text: string
}): Promise<string | null> {
  const answer = await post<{ value: string | null }>({
    kind: 'barcode-parse',
    ...args,
  })

  return answer.value
}

/** The lines a plugin label layout prints for a record. */
export async function layOutPluginLabel(args: {
  extensionKey: string
  formatId: string
  recordKind: string
  record: PluginRow
  template: { widthMm: number; heightMm: number }
}): Promise<Array<{ text: string; bold: boolean }>> {
  const answer = await post<{ lines: Array<{ text: string; bold: boolean }> }>({
    kind: 'label',
    ...args,
  })

  return answer.lines
}

export async function pullWithConnector(args: {
  extensionKey: string
  connectorId: string
  name: string
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Connector parameters are the values the connector's own declared fields produced; this module only forwards them to the plugin route.
  parameters: Record<string, unknown>
  settings: Record<string, string>
}): Promise<File> {
  const table = await post<PluginTable>({
    kind: 'connector',
    extensionKey: args.extensionKey,
    connectorId: args.connectorId,
    parameters: args.parameters,
    settings: args.settings,
  })

  return tableToCsvFile(table, `${args.name}.csv`)
}

export interface PluginExportedFile {
  filename: string
  mime: string
  encoding: ExtensionExporterDeclaration['encoding']
  content: string
}

/** Runs an exporter and hands the browser the file to save. */
export async function exportWithPlugin(args: {
  extensionKey: string
  exporterId: string
  name: string
  rows: PluginRow[]
  options?: PluginRow
}): Promise<File> {
  const made = await post<PluginExportedFile>({
    kind: 'export',
    extensionKey: args.extensionKey,
    exporterId: args.exporterId,
    name: args.name,
    rows: args.rows,
    options: args.options ?? {},
  })

  if (made.encoding === 'base64') {
    const binary = atob(made.content)
    const bytes = new Uint8Array(binary.length)

    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)

    return new File([bytes], made.filename, { type: made.mime })
  }

  return new File([made.content], made.filename, { type: made.mime })
}

export type PluginFilePreview =
  | { kind: 'table'; columns: string[]; rows: PluginRow[] }
  | { kind: 'text'; text: string }

export async function previewWithPlugin(args: {
  extensionKey: string
  previewId: string
  encoding: 'text' | 'base64'
  file: File
}): Promise<PluginFilePreview> {
  return post<PluginFilePreview>({
    kind: 'preview',
    extensionKey: args.extensionKey,
    previewId: args.previewId,
    filename: args.file.name,
    content: await readFileContent(args.file, args.encoding),
  })
}

export async function runPluginCheck(args: {
  extensionKey: string
  checkId: string
  rows: PluginRow[]
}): Promise<{ status: 'pass' | 'warn' | 'fail'; message: string }> {
  return post({
    kind: 'check',
    extensionKey: args.extensionKey,
    checkId: args.checkId,
    rows: args.rows,
  })
}

/** Runs a plugin check for a gate: the app reads the table and keeps the answer. */
export async function runPluginGateCheck(args: {
  recordId: string
  blockId: string
  extensionKey: string
  checkId: string
  columns: Record<string, string>
}): Promise<{ status: 'pass' | 'warn' | 'fail'; message: string }> {
  return post({ kind: 'gate-check', ...args })
}

/** The key a plugin's same-thing rule gives for an entry's values. */
export async function runSamenessKey(args: {
  extensionKey: string
  keyId: string
  values: PluginRow
}): Promise<string> {
  const answer = await post<{ key: string }>({
    kind: 'sameness-key',
    ...args,
  })

  return answer.key
}
