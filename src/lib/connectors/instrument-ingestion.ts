/**
 * INT-02 — scientific instrument ingestion over the generic framework.
 *
 * One canonical path per concept:
 *
 *   raw file → registered parser identity → mapping → validate_dataset_row_batch
 *            → commit_dataset_row_batch → connector run result provenance
 *
 * Nothing here writes rows directly; every value passes the pinned Schema
 * Version's fail-closed coercion inside the Core RPCs. The connector run is
 * started before parsing and completed after the commit receipt, so runs,
 * logs and change events record exactly what landed in the Dataset.
 */
import type { DataClient } from '../data-client'
import { describeImportRpcCode } from '../import-commit'
import {
  mapImportSheet,
  suggestImportMappings,
} from '../import-mapping'
import type { ImportColumnMapping, ImportTargetField } from '../import-mapping'
import { formatParserIdentity, getParser } from './registry'
import { ConnectorStepError, executeConnectorRun } from './run'
import { validateAndCommitDatasetRows } from './dataset-writes'

export interface InstrumentIngestionInput {
  workspaceId: string
  connectorId: string
  /** Stable parser identity registered on this connector. */
  parserId: string
  /** Raw payload text exactly as received (never transformed client-side). */
  text: string
  fileName: string
  /** sha256 of the raw bytes when known (file platform checksum). */
  checksum?: string | null
  byteSize?: number | null
  fileId?: string | null
  triggerKind?: 'manual' | 'scheduled' | 'event'
  target: {
    datasetId: string
    expectedRevision: number
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

/** sha256 hex digest over the ingestion inputs — run idempotency key input. */
export async function ingestionRequestDigest(
  parts: Array<unknown>,
): Promise<string> {
  const payload = JSON.stringify(parts)
  const buffer = new TextEncoder().encode(payload)
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

interface IngestionWork {
  rowCount: number
  metadata: Record<string, string>
  warnings: string[]
  datasetRevision?: number
}

export async function ingestInstrumentPayload(
  client: DataClient,
  input: InstrumentIngestionInput,
): Promise<InstrumentIngestionResult> {
  const parser = getParser(input.parserId)
  if (!parser) {
    throw new Error(`No parser registered for '${input.parserId}'.`)
  }

  const requestDigest = await ingestionRequestDigest([
    input.connectorId,
    input.checksum ?? null,
    input.byteSize ?? null,
    input.text.length,
    input.target.datasetId,
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
        datasetId: input.target.datasetId,
        datasetRevision: value.datasetRevision ?? null,
        schemaVersionId: input.target.schemaVersionId,
        rowCount: value.rowCount,
        fileName: input.fileName,
        fileSha256: input.checksum ?? null,
        fileId: input.fileId ?? null,
        byteSize: input.byteSize ?? null,
        parser: formatParserIdentity(parser),
        instrumentMetadata: value.metadata,
      }),
    },
    async ({ run, log }) => {
      // Stage 1 — parse with explicit version identity.
      let parsed;
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
      if (mapped.errors.length > 0) {
        throw new ConnectorStepError('mapping_failed', mapped.errors[0].message, {
          errors: mapped.errors.slice(0, 20),
        })
      }

      // Stages 3+4 — validate then commit through the Core batch RPCs only.
      const commit = await validateAndCommitDatasetRows(client, {
        datasetId: input.target.datasetId,
        expectedRevision: input.target.expectedRevision,
        schemaVersionId: input.target.schemaVersionId,
        rows: mapped.rows.map((row) => ({
          operation: 'create' as const,
          rowId: row.rowId,
          values: row.values,
        })),
        // Retry-safe: the same run re-uses the same commit receipt key.
        idempotencyKey: `connector-run-${run.id}`,
      }).catch((error) => {
        throw new ConnectorStepError('commit_failed', String(error))
      })

      if (!commit.ok) {
        const first = commit.errors?.[0]
        throw new ConnectorStepError(
          first?.code ?? 'validation_failed',
          first ? describeImportRpcCode(first.code) : 'Dataset rejected every row.',
          { errors: commit.errors?.slice(0, 20) ?? [] },
        )
      }

      await log(
        'commit',
        `Committed ${commit.rows?.length ?? mapped.rows.length} rows to Dataset ${input.target.datasetId}.`,
        { revision: commit.datasetRevision },
      )

      return {
        rowCount: commit.rows?.length ?? mapped.rows.length,
        metadata: parsed.metadata,
        warnings: parsed.warnings,
        datasetRevision: commit.datasetRevision,
      }
    },
  )

  if (report.alreadyCompleted && report.run) {
    if (report.status === 'succeeded') {
      return {
        runId: report.run.id,
        attempt: report.run.attempt,
        alreadyCompleted: true,
        parser: {
          id: parser.parserId,
          version: parser.version,
          identity: formatParserIdentity(parser),
          label: parser.label,
        },
        metadata: {},
        warnings: [],
        rowCount: 0,
        datasetId: input.target.datasetId,
      }
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
    alreadyCompleted: Boolean(report.alreadyCompleted),
    parser: {
      id: parser.parserId,
      version: parser.version,
      identity: formatParserIdentity(parser),
      label: parser.label,
    },
    metadata: report.value.metadata,
    warnings: report.value.warnings,
    rowCount: report.value.rowCount,
    datasetId: input.target.datasetId,
    datasetRevision: report.value.datasetRevision,
  }
}
