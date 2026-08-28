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
import type { IngestionParser } from './registry'
import { formatParserIdentity, getParser } from './registry'
import {
  ingestTabularPayload,
  ingestionRequestDigest,
} from './tabular-ingestion'
import type { TabularIngestionResult } from './tabular-ingestion'
import { sha256Hex } from './digest'

export interface InstrumentIngestionInput {
  workspaceId: string
  connectorId: string
  /** Stable parser identity registered on this connector. */
  parserId: string
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
}

export { ingestionRequestDigest }

function parserLabel(parser: IngestionParser): string {
  return parser.label
}

export async function ingestInstrumentPayload(
  client: DataClient,
  input: InstrumentIngestionInput,
): Promise<InstrumentIngestionResult> {
  const parser = getParser(input.parserId)
  if (!parser) {
    throw new Error(`No parser registered for '${input.parserId}'.`)
  }

  const payloadHash = await sha256Hex(input.text)

  const result: TabularIngestionResult = await ingestTabularPayload(client, {
    workspaceId: input.workspaceId,
    connectorId: input.connectorId,
    connectorType: 'instrument',
    parserIdentity: formatParserIdentity(parser),
    sheetName: input.fileName,
    // Parse inside the governed run so an unreadable payload records a
    // failed run with the bounded `parse_failed` code.
    parse: () => parser.parse(input.text),
    source: { kind: 'instrument_upload', fileName: input.fileName },
    fileRecordId: input.fileRecordId ?? null,
    checksum: input.checksum ?? payloadHash,
    byteSize: input.byteSize ?? null,
    triggerKind: input.triggerKind,
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
      id: parser.parserId,
      version: parser.version,
      identity: formatParserIdentity(parser),
      label: parserLabel(parser),
    },
    metadata: result.metadata,
    warnings: result.warnings,
    rowCount: result.rowCount,
    datasetId: result.datasetId,
    datasetRevision: result.datasetRevision,
  }
}
