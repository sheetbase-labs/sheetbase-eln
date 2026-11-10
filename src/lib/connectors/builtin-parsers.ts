/**
 * The readers that ship with the product, as the workspace parser list holds
 * them. Migration 0033 seeds exactly these as approved versions in every
 * workspace (`internal.builtin_parser_catalogue`); a database test keeps the
 * two lists equal. A reader that changes behaviour gets a new version here and
 * in a new migration, never an edit to an approved one.
 */
import { z } from 'zod'
import type { ConnectorWire } from './types'
import {
  pipelineJsonObjectSchema,
  pipelineJsonValueSchema,
} from '../pipelines/types'

export interface BuiltinParser {
  key: string
  name: string
  format: 'csv' | 'tsv' | 'xlsx' | 'json'
  version: number
  signature: ConnectorWire['config']
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
export type ParserKind = 'builtin' | 'columns' | 'webhook' | 'converter'

const parserReferenceSchema = z.union([
  pipelineJsonObjectSchema,
  z.array(pipelineJsonValueSchema),
])

export function parserKindOf(
  key: string,
  signature: ConnectorWire['config'],
): ParserKind {
  if (isBuiltinParserKey(key)) return 'builtin'

  if (parserReferenceSchema.safeParse(signature['webhook']).success)
    return 'webhook'

  if (parserReferenceSchema.safeParse(signature['converter']).success)
    return 'converter'

  if (z.string().safeParse(signature['engine']).success) return 'builtin'

  return 'columns'
}
