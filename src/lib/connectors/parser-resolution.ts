/**
 * Finds the parser version that reads a file.
 *
 * The workspace parser list (`api.parsers` and `api.parser_versions`) is the
 * only source. A built-in reader, a parser that lists the columns a file must
 * have, and a webhook parser are all rows there; this module picks the newest
 * approved version of one and says how to run it. The Import page, the folder
 * agent and the connector page all come through here, so approval means the
 * same thing on every route.
 */
import type { DataClient } from '../data-client'
import { ImportParseError, parseImportText } from '../import-parse'
import { recogniseImportParser } from '../import/parsers'
import type { ImportParserSignature } from '../import/parsers'
import { parserKindOf } from './builtin-parsers'
import type { ParserKind } from './builtin-parsers'
import { getParser } from './registry'
import type { ParsedInstrumentPayload } from './registry'
// Register the built-in readers before anything resolves against them.
import './plate-reader'
import './instrument-parsers'

export type ParserVersionStatus = 'draft' | 'validated' | 'approved' | 'retired'

export interface ResolvedParser {
  parserId: string
  parserVersionId: string
  key: string
  name: string
  format: string
  version: number
  status: ParserVersionStatus
  signature: Record<string, unknown>
  kind: ParserKind
}

/** A reason a file can't be read, with a stable code the app words for people. */
export class ParserResolutionError extends Error {
  readonly code: string
  readonly parserKey: string | null
  constructor(code: string, message: string, parserKey: string | null = null) {
    super(message)
    this.name = 'ParserResolutionError'
    this.code = code
    this.parserKey = parserKey
  }
}

interface ParserRow {
  id: string
  key: string
  name: string
  format: string
  parser_versions: Array<{
    id: string
    version: number
    status: ParserVersionStatus
    signature: Record<string, unknown>
  }>
}

/** `identity` of a resolved parser, as recorded in a run: `key@version`. */
export function parserIdentity(parser: {
  key: string
  version: number
}): string {
  return `${parser.key}@${parser.version}`
}

/** Makes sure the workspace has the built-in readers (new workspaces start without). */
export async function ensureBuiltinParsers(
  client: DataClient,
  workspaceId: string,
): Promise<void> {
  await client.rpc('ensure_builtin_parsers', { p_workspace_id: workspaceId })
}

/**
 * The newest approved version of the parser with this key. A parser that
 * exists but has no approved version is refused with its own code, so the
 * person is told to approve it rather than that it is missing.
 */
export async function resolveParserVersion(
  client: DataClient,
  workspaceId: string,
  key: string,
): Promise<ResolvedParser> {
  const rows = await client.list<ParserRow>(
    'parsers',
    `?workspace_id=eq.${encodeURIComponent(workspaceId)}&key=eq.${encodeURIComponent(key)}&select=id,key,name,format,parser_versions(id,version,status,signature)&limit=1`,
  )
  const parser = rows.at(0)
  if (!parser) {
    throw new ParserResolutionError(
      'parser_unknown',
      `There is no parser called ${key}.`,
      key,
    )
  }
  const approved = parser.parser_versions
    .filter((version) => version.status === 'approved')
    .sort((a, b) => b.version - a.version)
    .at(0)
  if (!approved) {
    throw new ParserResolutionError(
      'parser_not_approved',
      `${parser.name} has no approved version yet.`,
      key,
    )
  }
  return {
    parserId: parser.id,
    parserVersionId: approved.id,
    key: parser.key,
    name: parser.name,
    format: parser.format,
    version: approved.version,
    status: approved.status,
    signature: approved.signature,
    kind: parserKindOf(parser.key, approved.signature),
  }
}

/** The code reader behind a version, when there is one. */
export function builtinReader(parser: ResolvedParser) {
  const engine =
    typeof parser.signature['engine'] === 'string'
      ? parser.signature['engine']
      : null
  const reader = getParser(engine ? engine.split('@')[0] : parser.key)
  if (!reader) return null
  // An engine reference names its version; a built-in key means the reader's
  // own. Either way a reader that has moved on is never run as the old version.
  if (engine && `${reader.parserId}@${reader.version}` !== engine) return null
  if (!engine && reader.version !== parser.version) return null
  return reader
}

/** Reads text through a parser that lists the columns a file must have. */
export function readWithColumns(
  parser: ResolvedParser,
  text: string,
): ParsedInstrumentPayload {
  let preview
  try {
    preview = parseImportText(text, { header: true })
  } catch (error) {
    if (error instanceof ImportParseError) {
      throw new ParserResolutionError('parse_failed', error.message, parser.key)
    }
    throw error
  }
  const sheet = preview.sheets[0]
  const signature = parser.signature as Partial<ImportParserSignature>
  if (!Array.isArray(signature.requiredHeaders)) {
    throw new ParserResolutionError(
      'parser_unsupported',
      `${parser.name} can’t read files from an instrument yet.`,
      parser.key,
    )
  }
  const recognised = recogniseImportParser(
    { format: preview.format, headers: sheet.headers, rawTextHint: text },
    [
      {
        key: parser.key,
        label: parser.name,
        format: preview.format,
        version: parser.version,
        status: 'approved',
        signature: signature as ImportParserSignature,
        plannedKeyHeaders: [],
        controlPattern: '',
      },
    ],
  )
  if (!recognised) {
    throw new ParserResolutionError(
      'parser_unrecognised',
      `The file doesn’t have the columns ${parser.name} needs (${signature.requiredHeaders.join(', ')}).`,
      parser.key,
    )
  }
  return {
    headers: sheet.headers,
    rows: sheet.rows,
    metadata: { format: preview.format },
    warnings: [],
  }
}
