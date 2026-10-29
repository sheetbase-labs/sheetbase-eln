/**
 * The readers that ship with the product, as the workspace parser list holds
 * them. Migration 0033 seeds exactly these as approved versions in every
 * workspace (`internal.builtin_parser_catalogue`); a database test keeps the
 * two lists equal. A reader that changes behaviour gets a new version here and
 * in a new migration, never an edit to an approved one.
 */
export interface BuiltinParser {
  key: string
  name: string
  format: 'csv' | 'tsv' | 'xlsx' | 'json'
  version: number
  signature: Record<string, unknown>
}

export const BUILTIN_PARSERS: readonly BuiltinParser[] = [
  {
    key: 'sheetbase.plate-grid-csv',
    name: 'Plate reader grid (CSV)',
    format: 'csv',
    version: 1,
    signature: { engine: 'sheetbase.plate-grid-csv@1' },
  },
  {
    key: 'sheetbase.qpcr-results-csv',
    name: 'qPCR results (CSV)',
    format: 'csv',
    version: 1,
    signature: { engine: 'sheetbase.qpcr-results-csv@1' },
  },
  {
    key: 'sheetbase.hplc-peaks-csv',
    name: 'HPLC peak table (CSV)',
    format: 'csv',
    version: 1,
    signature: { engine: 'sheetbase.hplc-peaks-csv@1' },
  },
  {
    key: 'sheetbase.json-records',
    name: 'JSON records',
    format: 'json',
    version: 1,
    signature: { engine: 'sheetbase.json-records@1' },
  },
  {
    key: 'sheetbase.delimited',
    name: 'Delimited text (CSV/TSV)',
    format: 'csv',
    version: 1,
    signature: { engine: 'sheetbase.delimited@1' },
  },
  {
    key: 'sheetbase.plate-reader-csv',
    name: 'Plate reader CSV',
    format: 'csv',
    version: 1,
    signature: {
      requiredHeaders: ['sample', 'well'],
      optionalHeaders: ['od', 'od450', 'raw', 'conc', 'dilution'],
      requiresMetadata: true,
    },
  },
  {
    key: 'sheetbase.plate-map',
    name: 'PR-01 plate map',
    format: 'xlsx',
    version: 1,
    signature: {
      requiredHeaders: ['sample', 'well'],
      optionalHeaders: ['dilution', 'od', 'od450', 'conc', 'raw', 'read time'],
    },
  },
]

export function isBuiltinParserKey(key: string): boolean {
  return BUILTIN_PARSERS.some((parser) => parser.key === key)
}

/** How a parser version reads a file. */
export type ParserKind = 'builtin' | 'columns' | 'webhook'

export function parserKindOf(
  key: string,
  signature: Record<string, unknown>,
): ParserKind {
  if (isBuiltinParserKey(key)) return 'builtin'
  if (signature['webhook'] && typeof signature['webhook'] === 'object')
    return 'webhook'
  if (typeof signature['engine'] === 'string') return 'builtin'
  return 'columns'
}
