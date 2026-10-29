/**
 * INT-02 — scientific instrument ingestion over the generic framework.
 *
 * One canonical path per concept:
 *
 *   raw file (retained via file platform) → registered parser identity
 *     → mapping → target Dataset (created only after input validates)
 *     → validate_dataset_row_batch → commit_dataset_row_batch
 *     → connector run result provenance
 *
 * The governed run semantics (digest idempotency, linked retries, bounded
 * errors, provenance) live in the shared tabular ingestion primitive; this
 * module adds the instrument-specific parser registry step. Enterprise
 * connectors (INT-03) reuse the same primitive with their own source
 * descriptors.
 */
import type { DataClient } from '../data-client'
import type { ImportColumnMapping, ImportTargetField } from '../import-mapping'
import type { ParsedInstrumentPayload } from './registry'
import {
  ParserResolutionError,
  builtinReader,
  ensureBuiltinParsers,
  parserIdentity,
  readWithColumns,
  resolveParserVersion,
} from './parser-resolution'
import type { ResolvedParser } from './parser-resolution'
import {
  ingestTabularPayload,
  ingestionRequestDigest,
} from './tabular-ingestion'
import type { TabularIngestionResult } from './tabular-ingestion'
import { sha256Hex } from './digest'

export interface InstrumentIngestionInput {
  workspaceId: string
  connectorId: string
  /** Key of the workspace parser that reads the file; its newest approved version is used. */
  parserId: string
  /**
   * Runs a webhook parser. Only the server can (it holds the signing key), so
   * a caller that can't passes nothing and a webhook parser is refused.
   */
  readWithWebhook?: (parser: ResolvedParser) => Promise<ParsedInstrumentPayload>
  /** Raw payload text exactly as received (never transformed client-side). */
  text: string
  fileName: string
  /**
   * Canonical file-platform identity of the retained raw file. The product
   * upload path always supplies this; retention is a first-class guarantee.
   */
  fileRecordId?: string | null
  /** sha256 of the retained bytes, from the file platform upload receipt. */
  checksum?: string | null
  byteSize?: number | null
  triggerKind?: 'manual' | 'scheduled' | 'event'
  /** The instrument that produced the file, recorded on the import receipt. */
  instrumentId?: string | null
  target: {
    /** Existing target Dataset; when omitted a new one is created. */
    datasetId?: string | null
    /** Expected revision when targeting an existing Dataset. */
    expectedRevision?: number | null
    /** Required when creating a new Dataset. */
    newDatasetName?: string | null
    schemaVersionId: string
    fields: ImportTargetField[]
  }
  mappings?: ImportColumnMapping[]
}

export interface InstrumentIngestionResult {
  runId: string
  attempt: number
  alreadyCompleted: boolean
  parser: { id: string; version: number; identity: string; label: string }
  metadata: Record<string, string>
  warnings: string[]
  rowCount: number
  datasetId: string
  datasetRevision?: number
  /** What the parser read, when this call read the file (not on a replay). */
  parsed: ParsedInstrumentPayload | null
}

export { ingestionRequestDigest }

/** How a resolved version reads the file, or why it can't. */
function readerFor(
  parser: ResolvedParser,
  input: InstrumentIngestionInput,
): () => ParsedInstrumentPayload | Promise<ParsedInstrumentPayload> {
  if (parser.kind === 'webhook') {
    const readWithWebhook = input.readWithWebhook
    if (!readWithWebhook) {
      throw new ParserResolutionError(
        'parser_unsupported',
        `${parser.name} runs on another service and can’t be used from here.`,
        parser.key,
      )
    }
    return () => readWithWebhook(parser)
  }
  const reader = builtinReader(parser)
  if (reader) return () => reader.parse(input.text)
  if (parser.kind === 'columns')
    return () => readWithColumns(parser, input.text)
  throw new ParserResolutionError(
    'parser_unsupported',
    `${parser.name} can’t read instrument files yet.`,
    parser.key,
  )
}

export async function ingestInstrumentPayload(
  client: DataClient,
  input: InstrumentIngestionInput,
): Promise<InstrumentIngestionResult> {
  await ensureBuiltinParsers(client, input.workspaceId)
  const parser = await resolveParserVersion(
    client,
    input.workspaceId,
    input.parserId,
  )
  const read = readerFor(parser, input)
  const identity = parserIdentity(parser)

  const payloadHash = await sha256Hex(input.text)
  let parsed: ParsedInstrumentPayload | null = null

  const result: TabularIngestionResult = await ingestTabularPayload(client, {
    workspaceId: input.workspaceId,
    connectorId: input.connectorId,
    connectorType: 'instrument',
    parserIdentity: identity,
    parserVersion: {
      parserId: parser.parserId,
      parserVersionId: parser.parserVersionId,
    },
    sheetName: input.fileName,
    // Parse inside the governed run so an unreadable payload records a
    // failed run with the bounded `parse_failed` code.
    parse: async () => {
      parsed = await read()
      return parsed
    },
    source: { kind: 'instrument_upload', fileName: input.fileName },
    fileRecordId: input.fileRecordId ?? null,
    checksum: input.checksum ?? payloadHash,
    byteSize: input.byteSize ?? null,
    triggerKind: input.triggerKind,
    instrumentId: input.instrumentId ?? null,
    target: input.target,
    mappings: input.mappings,
    resultKind: 'instrument_ingestion',
    // Preserve the merged INT-01/INT-02 run-result wire keys.
    metadataResultKey: 'instrumentMetadata',
    nameResultKey: 'fileName',
  })

  // Replay of a prior successful run: the stored payload already carries the
  // parsed metadata; nothing else needs reconstruction for instruments.
  return {
    runId: result.runId,
    attempt: result.attempt,
    alreadyCompleted: result.alreadyCompleted,
    parser: {
      id: parser.key,
      version: parser.version,
      identity,
      label: parser.name,
    },
    metadata: result.metadata,
    warnings: result.warnings,
    rowCount: result.rowCount,
    datasetId: result.datasetId,
    datasetRevision: result.datasetRevision,
    parsed,
  }
}
