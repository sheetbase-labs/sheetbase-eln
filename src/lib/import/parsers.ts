/**
 * DSET-05.2 / DSET-06.1 — the built-in import parser registry.
 *
 * A parser definition is the code side of `api.parsers` / `api.parser_versions`:
 * `ensure_parser` writes these into the workspace's canonical parser registry,
 * and recognition matches a parsed file against the stored signature. Parsers
 * are pure — they never write; the canonical Dataset RPCs do that afterwards.
 *
 * Signatures are deliberately structural (required/optional header tokens and
 * an optional metadata requirement) so a file that does not match is reported
 * as unrecognised instead of being force-fitted to the nearest parser.
 */
import type { ImportFormat, ImportPreview } from '#/lib/import-parse'

export interface ImportParserSignature {
  /** Header tokens that must all be present (case-insensitive). */
  requiredHeaders: string[]
  /** Header tokens that raise confidence when present. */
  optionalHeaders?: string[]
  /** Text formats only: the file must carry a `# Key: value` metadata block. */
  requiresMetadata?: boolean
}

export interface ImportParserDefinition {
  key: string
  label: string
  format: ImportFormat
  version: number
  /** Governance: only an approved parser is auto-recognised. DSET-06.1. */
  status: 'approved' | 'draft'
  signature: ImportParserSignature
  /**
   * Source headers joined (with `/`) into a row's planned key, so an import
   * fills a matching active planned row instead of duplicating it. Empty means
   * the import creates new rows only.
   */
  plannedKeyHeaders: string[]
  /** Source header whose value marks a control row (skipped, not imported). */
  controlHeader?: string
  controlPattern: string
}

export const IMPORT_PARSERS: ImportParserDefinition[] = [
  {
    key: 'sheetbase.plate-map',
    label: 'PR-01 plate map',
    format: 'xlsx',
    version: 1,
    status: 'approved',
    signature: {
      requiredHeaders: ['sample', 'well'],
      optionalHeaders: ['dilution', 'od', 'od450', 'conc', 'raw', 'read time'],
    },
    plannedKeyHeaders: ['well'],
    controlHeader: 'sample',
    controlPattern: '^(blank|ctrl|control|nc|pc|neg|pos)$',
  },
  {
    key: 'sheetbase.plate-reader-csv',
    label: 'Plate reader CSV',
    format: 'csv',
    version: 1,
    status: 'approved',
    signature: {
      requiredHeaders: ['sample', 'well'],
      optionalHeaders: ['od', 'od450', 'raw', 'conc', 'dilution'],
      requiresMetadata: true,
    },
    plannedKeyHeaders: ['well'],
    controlHeader: 'sample',
    controlPattern: '^(blank|ctrl|control|nc|pc|neg|pos)$',
  },
  {
    key: 'sheetbase.tb02-turbidity',
    label: 'TB-02 CSV firmware 4',
    format: 'csv',
    version: 4,
    status: 'draft',
    signature: {
      requiredHeaders: ['sample', 'ntu', 'dil', 'timestamp'],
    },
    plannedKeyHeaders: ['sample'],
    controlHeader: 'sample',
    controlPattern: '^(blank|ctrl|control|nc|pc|neg|pos)$',
  },
]

export interface ParserRecognition {
  key: string
  label: string
  format: ImportFormat
  version: number
  confidence: number
  matchedHeaders: string[]
}

function headerTokens(headers: string[]): Set<string> {
  const set = new Set<string>()
  for (const header of headers) {
    const normalised = header.trim().toLowerCase()
    set.add(normalised)
    // `OD450 (AU)` also matches the token `od450`.
    const first = normalised.split(/[\s(/[]/)[0]
    if (first) set.add(first)
  }
  return set
}

/**
 * Match a parsed preview against the built-in parsers. Returns the highest
 * confidence match whose required headers are all present, or null when the
 * file does not match a registered format.
 */
export function recogniseImportParser(
  input: {
    format: ImportFormat
    headers: string[]
    rawTextHint?: string | null
  },
  parsers: ImportParserDefinition[] = IMPORT_PARSERS,
): ParserRecognition | null {
  const present = headerTokens(input.headers)
  const hasMetadata = /^#\s*[A-Za-z][\w /.-]*\s*:/m.test(
    input.rawTextHint ?? '',
  )
  let best: ParserRecognition | null = null
  for (const parser of parsers) {
    if (parser.format !== input.format) continue
    // Only an approved parser recognises a file; a draft is offered on the
    // failure page as an experiment instead. DSET-06.1.
    if (parser.status !== 'approved') continue
    if (parser.signature.requiresMetadata && !hasMetadata) continue
    const required = parser.signature.requiredHeaders.map((header) =>
      header.trim().toLowerCase(),
    )
    if (!required.every((header) => present.has(header))) continue
    const optional = (parser.signature.optionalHeaders ?? []).map((header) =>
      header.trim().toLowerCase(),
    )
    const matchedOptional = optional.filter((header) => present.has(header))
    const confidence =
      (required.length + matchedOptional.length) /
      Math.max(required.length + optional.length, 1)
    if (!best || confidence > best.confidence) {
      best = {
        key: parser.key,
        label: parser.label,
        format: parser.format,
        version: parser.version,
        confidence: Math.round(confidence * 100) / 100,
        matchedHeaders: [...required, ...matchedOptional],
      }
    }
  }
  return best
}

export function previewHeaderSample(preview: ImportPreview): {
  headers: string[]
  rowCount: number
  sheetNames: string[]
} {
  const sheet = preview.sheets.at(0)
  return {
    headers: sheet?.headers ?? [],
    rowCount: preview.sheets.reduce(
      (total, item) => total + item.rows.length,
      0,
    ),
    sheetNames: preview.sheets.map((item) => item.name),
  }
}
