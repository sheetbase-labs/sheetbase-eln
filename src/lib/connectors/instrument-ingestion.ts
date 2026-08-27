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
 * Nothing here writes rows directly; every value passes the pinned Schema
 * Version's fail-closed coercion inside the Core RPCs. The connector run is
 * started before parsing and completed after the commit receipt, so runs,
 * logs and change events record exactly what landed in the Dataset.
 */
import type { DataClient } from '../data-client'
import { describeImportRpcCode } from '../import-commit'
import {
  createDataset,
  commitDatasetRowBatch,
  validateDatasetRowBatch,
} from '../dataset-product'
import {
  mapImportSheet,
  suggestImportMappings,
} from '../import-mapping'
import type { ImportColumnMapping, ImportTargetField } from '../import-mapping'
import type { IngestionParser } from './registry'
import { formatParserIdentity, getParser } from './registry'
import { ConnectorStepError, executeConnectorRun } from './run'

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
  fileId?: string | null
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

async function sha256Hex(text: string): Promise<string> {
  const buffer = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * sha256 hex digest over the ingestion request identity: actual content
 * (payload hash, never byte length), parser identity, target Dataset/Schema
 * and mapping configuration. Same-content replays deduplicate; different
 * payloads always produce distinct runs.
 */
export async function ingestionRequestDigest(
  parts: Array<unknown>,
): Promise<string> {
  const payload = JSON.stringify(parts)
  return sha256Hex(payload)
}

interface IngestionWork {
  rowCount: number
  metadata: Record<string, string>
  warnings: string[]
  datasetId: string
  datasetRevision?: number
}

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
  const requestDigest = await ingestionRequestDigest([
    input.connectorId,
    payloadHash,
    formatParserIdentity(parser),
    input.target.datasetId ?? input.target.schemaVersionId,
    input.target.newDatasetName ?? null,
    input.target.schemaVersionId,
    input.mappings ?? 'suggest',
  ])

  const report = await executeConnectorRun<IngestionWork>(
    client,
    {
      workspaceId: input.workspaceId,
      connectorId: input.connectorId,
      triggerKind: input.triggerKind ?? 'manual',
      requestDigest,
      startedMessage: `Ingesting ${input.fileName} (${input.byteSize ?? 'unknown'} bytes).`,
      buildResult: (value) => ({
        kind: 'instrument_ingestion',
        datasetId: value.datasetId,
        datasetRevision: value.datasetRevision ?? null,
        schemaVersionId: input.target.schemaVersionId,
        rowCount: value.rowCount,
        fileName: input.fileName,
        fileSha256: input.checksum ?? payloadHash,
        fileId: input.fileId ?? null,
        byteSize: input.byteSize ?? null,
        parser: formatParserIdentity(parser),
        instrumentMetadata: value.metadata,
      }),
    },
    async ({ run, log }) => {
      // Stage 1 — parse with explicit version identity.
      let parsed
      try {
        parsed = parser.parse(input.text)
      } catch (error) {
        throw new ConnectorStepError(
          'parse_failed',
          error instanceof Error ? error.message : 'Instrument payload unreadable.',
          { parserId: parser.parserId },
        )
      }
      for (const warning of parsed.warnings) {
        await log('parse', warning, {}, 'warning')
      }
      await log(
        'parse',
        `Parsed ${parsed.rows.length} data rows with ${formatParserIdentity(parser)}.`,
        { parser: formatParserIdentity(parser), metadata: parsed.metadata },
      )

      // Stage 2 — map onto the pinned Schema Version fields (fail-closed).
      const mappings =
        input.mappings ??
        suggestImportMappings(parsed.headers, input.target.fields)
      if (mappings.every((mapping) => mapping.kind === 'ignore')) {
        throw new ConnectorStepError(
          'no_mapping',
          'No source columns mapped to Dataset fields.',
        )
      }
      const sheet = {
        name: input.fileName,
        headers: parsed.headers,
        rows: parsed.rows,
      }
      const mapped = mapImportSheet(sheet, mappings, input.target.schemaVersionId)
      await log(
        'map',
        `Mapped ${mapped.rows.length} rows across ${mappings.filter((m) => m.kind === 'field').length} fields.`,
      )
      if (mapped.rows.length === 0) {
        throw new ConnectorStepError(
          'no_rows',
          'The instrument output contains no data rows.',
        )
      }
      if (mapped.errors.length > 0) {
        throw new ConnectorStepError('mapping_failed', mapped.errors[0].message, {
          errors: mapped.errors.slice(0, 20),
        })
      }
      // Input is now provably valid: parse and mapping both succeeded. Only
      // now may a new target Dataset be created, so a failed run cannot leave
      // an orphan empty Dataset behind.

      // Stage 3 — resolve the target Dataset.
      let datasetId = input.target.datasetId ?? null
      let expectedRevision = input.target.expectedRevision ?? null
      if (!datasetId) {
        if (!input.target.newDatasetName?.trim()) {
          throw new ConnectorStepError(
            'no_target',
            'Choose an existing Dataset or name a new one.',
          )
        }
        const created = await createDataset(client, {
          workspaceId: input.workspaceId,
          schemaVersionId: input.target.schemaVersionId,
          name: input.target.newDatasetName.trim(),
        })
        datasetId = created.id
        expectedRevision = created.revision
        await log(
          'target',
          `Created Dataset ${created.id} (${created.name}) on the pinned Schema Version.`,
          { datasetId },
        )
      }

      // Stages 4+5 — validate then commit through the Core batch RPCs only.
      const rows = mapped.rows.map((row) => ({
        operation: 'create' as const,
        rowId: row.rowId,
        values: row.values,
      }))
      const validated = await validateDatasetRowBatch(client, {
        datasetId,
        expectedRevision: expectedRevision ?? 1,
        rows,
      }).catch((error) => {
        throw new ConnectorStepError('validation_failed', String(error))
      })
      if (!validated.ok) {
        const first = validated.errors?.[0]
        throw new ConnectorStepError(
          first?.code ?? 'validation_failed',
          first ? describeImportRpcCode(first.code) : 'Dataset rejected every row.',
          { errors: validated.errors?.slice(0, 20) ?? [] },
        )
      }
      const committed = await commitDatasetRowBatch(client, {
        datasetId,
        expectedRevision: expectedRevision ?? 1,
        rows,
        // Retry-safe: the same run re-uses the same commit receipt key.
        idempotencyKey: `connector-run-${run.id}`,
      }).catch((error) => {
        throw new ConnectorStepError('commit_failed', String(error))
      })
      if (!committed.ok) {
        const first = committed.errors?.[0]
        throw new ConnectorStepError(
          first?.code ?? 'commit_failed',
          first ? describeImportRpcCode(first.code) : 'Dataset commit rejected.',
          { errors: committed.errors?.slice(0, 20) ?? [] },
        )
      }

      await log(
        'commit',
        `Committed ${committed.rows?.length ?? rows.length} rows to Dataset ${datasetId}.`,
        { revision: committed.datasetRevision },
      )

      return {
        rowCount: committed.rows?.length ?? rows.length,
        metadata: parsed.metadata,
        warnings: parsed.warnings,
        datasetId,
        datasetRevision: committed.datasetRevision,
      }
    },
  )

  // Replay of a prior successful run with the same request identity:
  // reconstruct the result from the stored run payload instead of reporting
  // an empty ingest.
  if (report.alreadyCompleted && report.run) {
    if (report.status !== 'succeeded') {
      throw new Error(
        report.errorMessage ??
          `Connector run ${report.run.id} failed with code ${report.errorCode ?? 'unknown'}.`,
      )
    }
    const stored = report.run.result
    return {
      runId: report.run.id,
      attempt: report.run.attempt,
      alreadyCompleted: true,
      parser: {
        id: parser.parserId,
        version: parser.version,
        identity: formatParserIdentity(parser),
        label: parserLabel(parser),
      },
      metadata: (stored.instrumentMetadata ?? {}) as Record<string, string>,
      warnings: [],
      rowCount: Number(stored.rowCount ?? 0),
      datasetId: String(stored.datasetId ?? input.target.datasetId ?? ''),
      datasetRevision: stored.datasetRevision
        ? Number(stored.datasetRevision)
        : undefined,
    }
  }

  if (!report.run || !report.value) {
    throw new Error(
      report.errorMessage ??
        `Connector run failed with code ${report.errorCode ?? 'unknown'}.`,
    )
  }

  return {
    runId: report.run.id,
    attempt: report.run.attempt,
    alreadyCompleted: false,
    parser: {
      id: parser.parserId,
      version: parser.version,
      identity: formatParserIdentity(parser),
      label: parserLabel(parser),
    },
    metadata: report.value.metadata,
    warnings: report.value.warnings,
    rowCount: report.value.rowCount,
    datasetId: report.value.datasetId,
    datasetRevision: report.value.datasetRevision,
  }
}
