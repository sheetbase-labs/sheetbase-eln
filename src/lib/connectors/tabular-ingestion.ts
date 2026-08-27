/**
 * INT-03 — shared governed ingestion primitive for tabular payloads.
 *
 * One canonical path per concept, reused by every inbound connector that
 * produces a tabular sheet (instrument files, S3 objects, external database
 * tables):
 *
 *   map (fail-closed) → required coverage → target Dataset
 *     → validate_dataset_row_batch → commit_dataset_row_batch
 *     → connector run result provenance
 *
 * Nothing here writes rows directly; every value passes the pinned Schema
 * Version's fail-closed coercion inside the Core RPCs. The connector run is
 * started before mapping and completed after the commit receipt, so runs,
 * logs and change events record exactly what landed in the Dataset.
 *
 * Request identity: the digest is the sha256 of the source descriptor (which
 * embeds the retained content sha256 where applicable — a changed external
 * source is always a new logical request), the parser identity, the target
 * Dataset/Schema and the mapping configuration.
 */
import type { DataClient } from '../data-client'
import { describeImportRpcCode } from '../import-commit'
import {
  createDataset,
  commitDatasetRowBatch,
  validateDatasetRowBatch,
} from '../dataset-product'
import { mapImportSheet, suggestImportMappings } from '../import-mapping'
import type { ImportColumnMapping, ImportTargetField } from '../import-mapping'
import { ConnectorStepError, executeConnectorRun } from './run'
import { sha256Hex } from './digest'

/** Parsed tabular payload handed to the shared ingestion primitive. */
export interface ParsedTabularPayload {
  headers: string[]
  rows: Array<Record<string, string>>
  metadata: Record<string, string>
  warnings: string[]
}

export interface TabularIngestionTarget {
  /** Existing target Dataset; when omitted a new one is created. */
  datasetId?: string | null
  /** Expected revision when targeting an existing Dataset. */
  expectedRevision?: number | null
  /** Required when creating a new Dataset. */
  newDatasetName?: string | null
  schemaVersionId: string
  fields: ImportTargetField[]
}

export interface TabularIngestionInput {
  workspaceId: string
  connectorId: string
  /** Stable identity recorded in provenance, e.g. `sheetbase.csv@1`. */
  parserIdentity: string
  sheetName: string
  /** Pre-parsed payload (source already read outside the run). */
  payload?: ParsedTabularPayload
  /**
   * Lazy parse executed inside the governed run so a parse failure records a
   * failed run with the bounded `parseErrorCode`. Required when `payload`
   * is omitted; an error thrown here becomes `parseErrorCode`.
   */
  parse?: () => ParsedTabularPayload
  /** Bounded code for a parse failure (default `parse_failed`). */
  parseErrorCode?: string
  /** Source descriptor (bucket/key, host/database/schema/table, ...). */
  source: Record<string, unknown>
  /**
   * Retained raw-source evidence through the canonical file platform.
   * Storage connectors always supply it; database imports have no raw file.
   */
  fileRecordId?: string | null
  /** sha256 of the retained/read source content. */
  checksum?: string | null
  byteSize?: number | null
  triggerKind?: 'manual' | 'scheduled' | 'event'
  target: TabularIngestionTarget
  mappings?: ImportColumnMapping[]
  /** Provenance `kind` recorded in the finished run result. */
  resultKind: string
  /**
   * Result key carrying the parsed metadata. Instruments keep the merged
   * INT-02 wire key; enterprise connectors use `contentMetadata`.
   */
  metadataResultKey?: 'instrumentMetadata' | 'contentMetadata'
  /**
   * Result key carrying the source sheet/file name. Instruments keep the
   * merged INT-02 wire key; enterprise connectors use `sheetName`.
   */
  nameResultKey?: 'fileName' | 'sheetName'
}

export interface TabularIngestionResult {
  runId: string
  attempt: number
  alreadyCompleted: boolean
  rowCount: number
  datasetId: string
  datasetRevision?: number
  metadata: Record<string, string>
  warnings: string[]
  /** sha256 of the ingested payload content. */
  contentSha256: string
}

interface IngestionWork {
  rowCount: number
  metadata: Record<string, string>
  warnings: string[]
  datasetId: string
  datasetRevision?: number
}

/**
 * sha256 hex digest over the ingestion request identity: the source
 * descriptor (which embeds the retained content hash — actual content, never
 * byte length), parser identity, target Dataset/Schema and mapping
 * configuration. Same-content replays deduplicate; changed sources always
 * produce distinct runs.
 */
export async function ingestionRequestDigest(
  parts: Array<unknown>,
): Promise<string> {
  return sha256Hex(JSON.stringify(parts))
}

async function payloadContentSha256(
  payload: ParsedTabularPayload,
): Promise<string> {
  return sha256Hex(
    JSON.stringify({ headers: payload.headers, rows: payload.rows }),
  )
}

/**
 * Run one governed tabular ingestion. Any failure leaves the target Dataset
 * untouched: a new Dataset is created only after parse-time mapping coercion
 * and the required-field coverage check have both succeeded, and rows land
 * only through the Core batch RPCs inside the run.
 */
export async function ingestTabularPayload(
  client: DataClient,
  input: TabularIngestionInput,
): Promise<TabularIngestionResult> {
  const payload = input.payload
  if (!payload && !input.parse) {
    throw new Error('Tabular ingestion requires a payload or a parse step.')
  }
  if (!payload && !input.checksum) {
    // The digest must be known before the run starts; a lazily parsed
    // source without a caller-supplied content hash cannot build one.
    throw new Error(
      'Tabular ingestion with a lazy parse requires a source checksum.',
    )
  }
  const contentSha256 = input.checksum ?? (await payloadContentSha256(payload!))
  const requestDigest = await ingestionRequestDigest([
    input.connectorId,
    input.source,
    contentSha256,
    input.parserIdentity,
    input.target.datasetId ?? input.target.schemaVersionId,
    input.target.newDatasetName ?? null,
    input.target.schemaVersionId,
    input.mappings ?? 'suggest',
  ])

  // Pre-parsed payloads (source read before the run) resolve immediately;
  // lazy parses execute inside the governed run so parse failures are
  // recorded as failed runs with a bounded error code.
  const resolvePayload = (): ParsedTabularPayload => {
    if (input.payload) return input.payload
    try {
      return input.parse!()
    } catch (error) {
      throw new ConnectorStepError(
        input.parseErrorCode ?? 'parse_failed',
        error instanceof Error ? error.message : 'Source payload unreadable.',
        { parserIdentity: input.parserIdentity },
      )
    }
  }

  const runOnce = (retryOfRunId?: string | null) =>
    executeConnectorRun<IngestionWork>(
      client,
      {
        workspaceId: input.workspaceId,
        connectorId: input.connectorId,
        triggerKind: input.triggerKind ?? 'manual',
        requestDigest,
        retryOfRunId,
        startedMessage: `Ingesting ${input.sheetName} (${input.byteSize ?? 'unknown'} bytes).`,
        buildResult: (value) => ({
          kind: input.resultKind,
          datasetId: value.datasetId,
          datasetRevision: value.datasetRevision ?? null,
          schemaVersionId: input.target.schemaVersionId,
          rowCount: value.rowCount,
          [input.nameResultKey ?? 'sheetName']: input.sheetName,
          fileSha256: contentSha256,
          fileRecordId: input.fileRecordId ?? null,
          byteSize: input.byteSize ?? null,
          parser: input.parserIdentity,
          source: input.source,
          [input.metadataResultKey ?? 'contentMetadata']: value.metadata,
        }),
      },
      async ({ run, log }) => {
        const payload = await resolvePayload()
        for (const warning of payload.warnings) {
          await log('parse', warning, {}, 'warning')
        }
        await log(
          'parse',
          `Parsed ${payload.rows.length} data rows with ${input.parserIdentity}.`,
          { parser: input.parserIdentity, metadata: payload.metadata },
        )

        // Stage — map onto the pinned Schema Version fields (fail-closed).
        const mappings =
          input.mappings ??
          suggestImportMappings(payload.headers, input.target.fields)
        if (mappings.every((mapping) => mapping.kind === 'ignore')) {
          throw new ConnectorStepError(
            'no_mapping',
            'No source columns mapped to Dataset fields.',
          )
        }
        const sheet = {
          name: input.sheetName,
          headers: payload.headers,
          rows: payload.rows,
        }
        const mapped = mapImportSheet(
          sheet,
          mappings,
          input.target.schemaVersionId,
        )
        await log(
          'map',
          `Mapped ${mapped.rows.length} rows across ${mappings.filter((m) => m.kind === 'field').length} fields.`,
        )
        if (mapped.rows.length === 0) {
          throw new ConnectorStepError(
            'no_rows',
            'The source payload contains no data rows.',
          )
        }
        if (mapped.errors.length > 0) {
          throw new ConnectorStepError(
            'mapping_failed',
            mapped.errors[0].message,
            {
              errors: mapped.errors.slice(0, 20),
            },
          )
        }

        // Pre-create required-coverage check, mirroring the Core RPC's
        // required_value rule over the same pinned Schema field metadata: a
        // required field with no mapped source column would deterministically
        // fail validation, so fail here — before any Dataset is created.
        const mappedFieldIds = new Set(
          mappings
            .filter((mapping) => mapping.kind === 'field')
            .map((mapping) => mapping.field.id),
        )
        const missingRequired = input.target.fields.filter(
          (field) =>
            field.kind === 'dataset-field' &&
            !field.nullable &&
            !mappedFieldIds.has(field.id),
        )
        if (missingRequired.length > 0) {
          throw new ConnectorStepError(
            'required_mapping',
            `${missingRequired[0].label} is required by the Schema Version but no source column is mapped.`,
            { missing: missingRequired.map((field) => field.id) },
          )
        }
        // Input is now provably valid: mapping coercion and required
        // coverage have all succeeded. Only now may a new target Dataset be
        // created, so a failed run cannot leave an orphan empty Dataset.

        // Stage — resolve the target Dataset.
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

        // Stages — validate then commit through the Core batch RPCs only.
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
            first
              ? describeImportRpcCode(first.code)
              : 'Dataset rejected every row.',
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
            first
              ? describeImportRpcCode(first.code)
              : 'Dataset commit rejected.',
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
          metadata: payload.metadata,
          warnings: payload.warnings,
          datasetId,
          datasetRevision: committed.datasetRevision,
        }
      },
    )

  // Product-accessible retry: a failed prior attempt under the same request
  // identity refuses an unlinked re-run (SB045). Instead of dead-ending the
  // user, resolve the failed run and explicitly retry against it — one new
  // linked attempt with the same digest.
  let report = await runOnce()
  if (
    report.status === 'failed' &&
    /retry with retry_of_run_id/i.test(report.errorMessage ?? '')
  ) {
    const failedRuns = await client.list<{ id: string; attempt: number }>(
      'connector_runs',
      `?connector_id=eq.${encodeURIComponent(input.connectorId)}&request_digest=eq.${encodeURIComponent(requestDigest)}&status=eq.failed&order=started_at.desc&limit=1`,
    )
    if (failedRuns.length > 0) {
      report = await runOnce(failedRuns[0].id)
    }
  }

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
      rowCount: Number(stored.rowCount ?? 0),
      datasetId: String(stored.datasetId ?? input.target.datasetId ?? ''),
      datasetRevision: stored.datasetRevision
        ? Number(stored.datasetRevision)
        : undefined,
      metadata: (stored[input.metadataResultKey ?? 'contentMetadata'] ??
        {}) as Record<string, string>,
      warnings: [],
      contentSha256,
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
    rowCount: report.value.rowCount,
    datasetId: report.value.datasetId,
    datasetRevision: report.value.datasetRevision,
    metadata: report.value.metadata,
    warnings: report.value.warnings,
    contentSha256,
  }
}
