/**
 * Shared governed ingestion primitive for tabular payloads.
 *
 * One canonical path per concept, reused by every inbound connector that
 * produces a tabular sheet (instrument files, S3 objects, external database
 * tables):
 *
 *   run started → source read → dedupe → (retain) → parse
 *     → map (fail-closed) → required coverage → target Dataset
 *     → validate_dataset_row_batch → commit_dataset_row_batch
 *     → connector run result provenance
 *
 * Nothing here writes rows directly; every value passes the pinned Schema
 * Version's fail-closed coercion inside the Core RPCs.
 *
 * Two identity modes:
 *
 *  - `ingestTabularPayload` (immediate): the payload and its content hash are
 *    known before the run starts (instrument uploads). The full content-aware
 *    request digest is passed to start_connector_run and keeps the original
 *    INT-02 dedupe/replay/SB045 semantics.
 *
 *  - `ingestExternalPayload` (deferred, INT-03): the source is external, so
 *    the run MUST start before any external work — connection, download,
 *    query and limit failures are recorded as failed runs with bounded codes.
 *    The run starts with a provisional selector digest (concurrency guard +
 *    retry lineage); the running attempt reads the source, then establishes
 *    the canonical content-aware request digest via
 *    establish_connector_run_request BEFORE committing. Identical content is
 *    short-circuited as a replay — no duplicate retained files, no duplicate
 *    rows.
 */
import type { DataClient } from '../data-client'
import { describeImportRpcCode } from '../import-commit'
import { createDataset } from '../dataset-product'
import type { DatasetCommitResult } from '../dataset-product'
import { mapImportSheet, suggestImportMappings } from '../import-mapping'
import type { ImportColumnMapping, ImportTargetField } from '../import-mapping'
import { ConnectorExecutionError } from './enterprise/errors'
import { establishConnectorRunRequest } from './client'
import { t } from '#/copy'
import type { ConnectorType } from '#/lib/metrics'
import type { ConnectorRunObservability } from './run'
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
  /** PLAT-02 bounded metrics label (instrument/storage/database/...). */
  connectorType?: ConnectorType
  /** PLAT-02 server-injected metrics/logs; no-op when executed client-side. */
  observability?: ConnectorRunObservability
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
  parse?: () => ParsedTabularPayload | Promise<ParsedTabularPayload>
  /** Bounded code for a parse failure (default `parse_failed`). */
  parseErrorCode?: string
  /**
   * The workspace parser version that read the file. When given it is used as
   * is; nothing is registered. Without it the engine identity is registered as
   * a draft (the enterprise sources, which have no parser list yet).
   */
  parserVersion?: { parserId: string; parserVersionId: string }
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

/**
 * Ingestion failure carrying the run's bounded error code. The run has
 * already been recorded as failed server-side; this surfaces the bounded
 * code to the caller/product surface.
 */
export class TabularIngestionError extends Error {
  readonly code: string
  /** The failed connector run, when one was recorded. */
  readonly runId: string | null
  constructor(code: string, message: string, runId: string | null = null) {
    super(message)
    this.name = 'TabularIngestionError'
    this.code = code
    this.runId = runId
  }
}

interface IngestionWork {
  rowCount: number
  metadata: Record<string, string>
  warnings: string[]
  datasetId: string
  datasetRevision?: number
  /** Result payload recorded verbatim on completion. */
  resultPayload: Record<string, unknown>
}

/**
 * sha256 hex digest over an ingestion request identity. Same-content replays
 * deduplicate; changed sources always produce distinct runs.
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

/** Log handle passed to source-resolution stages. */
export interface StageLog {
  (
    stage: string,
    message: string,
    detail?: Record<string, unknown>,
    level?: 'info' | 'warning' | 'error',
  ): Promise<void>
}

/** Registers an engine identity such as `sheetbase.delimited@1` as a draft parser version. */
async function registerDraftEngine(
  client: DataClient,
  workspaceId: string,
  parserIdentity: string,
): Promise<{ parserId: string; parserVersionId: string }> {
  const identity = /^(.*)@(\d+)$/.exec(parserIdentity)
  if (!identity)
    throw new ConnectorStepError(
      'parser_required',
      t('data.tabularIngestion.versionedParserIdentityRequired'),
    )
  return client.rpc<{ parserId: string; parserVersionId: string }>(
    'ensure_parser',
    {
      p_workspace_id: workspaceId,
      p_key: identity[1],
      p_name: identity[1],
      p_format: 'csv',
      p_version: Number(identity[2]),
      p_signature: { engine: parserIdentity },
      p_status: 'draft',
    },
  )
}

// ---------------------------------------------------------------------------
// Shared stages: map → required coverage → target → validate → commit.
// ---------------------------------------------------------------------------
async function mapValidateCommitStages(input: {
  client: DataClient
  workspaceId: string
  target: TabularIngestionTarget
  mappings?: ImportColumnMapping[]
  sheetName: string
  parserIdentity: string
  parserVersion?: { parserId: string; parserVersionId: string }
  runId: string
  sourceProvenance: Record<string, unknown>
  payload: ParsedTabularPayload
  log: StageLog
}): Promise<{ rowCount: number; datasetId: string; datasetRevision?: number }> {
  const { client, payload, log } = input
  for (const warning of payload.warnings) {
    await log('parse', warning, {}, 'warning')
  }
  await log(
    'parse',
    t('data.tabularIngestion.parsedDataRows', {
      length: payload.rows.length,
      parserIdentity: input.parserIdentity,
    }),
    { parser: input.parserIdentity, metadata: payload.metadata },
  )

  // Stage — map onto the pinned Schema Version fields (fail-closed).
  const mappings =
    input.mappings ??
    suggestImportMappings(payload.headers, input.target.fields)
  if (mappings.every((mapping) => mapping.kind === 'ignore')) {
    throw new ConnectorStepError(
      'no_mapping',
      t('data.tabularIngestion.sourceColumnsMappedDataset'),
    )
  }
  const mapped = mapImportSheet(
    { name: input.sheetName, headers: payload.headers, rows: payload.rows },
    mappings,
    input.target.schemaVersionId,
  )
  await log(
    'map',
    t('data.tabularIngestion.mappedRowsAcrossFields', {
      length: mapped.rows.length,
      length2: mappings.filter((m) => m.kind === 'field').length,
    }),
  )
  if (mapped.rows.length === 0) {
    throw new ConnectorStepError(
      'no_rows',
      t('data.tabularIngestion.sourcePayloadContainsData'),
    )
  }
  if (mapped.errors.length > 0) {
    throw new ConnectorStepError('mapping_failed', mapped.errors[0].message, {
      errors: mapped.errors.slice(0, 20),
    })
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
  // Input is now provably valid: mapping coercion and required coverage have
  // both succeeded. Only now may a new target Dataset be created, so a failed
  // run cannot leave an orphan empty Dataset.

  // Stage — resolve the target Dataset.
  let datasetId = input.target.datasetId ?? null
  let expectedRevision = input.target.expectedRevision ?? null
  if (!datasetId) {
    if (!input.target.newDatasetName?.trim()) {
      throw new ConnectorStepError(
        'no_target',
        t('data.tabularIngestion.chooseExistingDatasetName'),
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
      t('data.tabularIngestion.createdDatasetPinnedSchema', {
        id: created.id,
        name: created.name,
      }),
      { datasetId },
    )
  }

  // Stage — commit through the canonical batch RPC, atomically: the atomic
  // RPC runs every ≤1000-row chunk inside ONE database transaction, so a
  // failure in any chunk rolls back every earlier chunk (no partial imports).
  const rows = mapped.rows.map((row) => ({
    operation: 'create' as const,
    rowId: row.rowId,
    values: row.values,
  }))
  const parser = input.parserVersion
    ? {
        parserId: input.parserVersion.parserId,
        parserVersionId: input.parserVersion.parserVersionId,
      }
    : await registerDraftEngine(client, input.workspaceId, input.parserIdentity)
  const committed = await client
    .rpc<DatasetCommitResult>('commit_dataset_import', {
      p_dataset_id: datasetId,
      p_expected_dataset_revision: expectedRevision ?? 1,
      p_rows: rows,
      p_idempotency_key: `connector-run-${input.runId}`,
      p_file_id: null,
      p_mapping: mappings,
      p_outcome: { total: rows.length, added: rows.length },
      p_parser_id: parser.parserId,
      p_parser_version_id: parser.parserVersionId,
      p_connector_run_id: input.runId,
      p_source_provenance: input.sourceProvenance,
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      throw new ConnectorStepError(
        /Dataset import rejected/i.test(message)
          ? 'validation_failed'
          : 'commit_failed',
        message,
      )
    })
  if (!committed.ok) {
    const first = committed.errors?.[0]
    throw new ConnectorStepError(
      first?.code ?? 'commit_failed',
      first
        ? describeImportRpcCode(first.code)
        : t('data.tabularIngestion.datasetCommitRejected'),
      { errors: committed.errors?.slice(0, 20) ?? [] },
    )
  }
  const committedCount = committed.rows?.length ?? rows.length
  const datasetRevision = committed.datasetRevision

  await log(
    'commit',
    t('data.tabularIngestion.committedRowsDataset', {
      committedCount,
      datasetId,
    }),
    { revision: datasetRevision },
  )

  return {
    rowCount: committedCount,
    datasetId,
    datasetRevision,
  }
}

function digestParts(input: {
  connectorId: string
  source: Record<string, unknown>
  contentSha256: string
  parserIdentity: string
  target: TabularIngestionTarget
  mappings?: ImportColumnMapping[]
}): Array<unknown> {
  return [
    input.connectorId,
    input.source,
    input.contentSha256,
    input.parserIdentity,
    input.target.datasetId ?? input.target.schemaVersionId,
    input.target.newDatasetName ?? null,
    input.target.schemaVersionId,
    input.mappings ?? 'suggest',
  ]
}

// ---------------------------------------------------------------------------
// Immediate mode (instrument uploads): content known before the run.
// ---------------------------------------------------------------------------
export async function ingestTabularPayload(
  client: DataClient,
  input: TabularIngestionInput,
): Promise<TabularIngestionResult> {
  const payload = input.payload
  if (!payload && !input.parse) {
    throw new Error(t('data.tabularIngestion.tabularIngestionRequiresPayload'))
  }
  if (!payload && !input.checksum) {
    // The digest must be known before the run starts; a lazily parsed
    // source without a caller-supplied content hash cannot build one.
    throw new Error(t('data.tabularIngestion.tabularIngestionLazyParse'))
  }
  const contentSha256 = input.checksum ?? (await payloadContentSha256(payload!))
  const requestDigest = await ingestionRequestDigest(
    digestParts({
      connectorId: input.connectorId,
      source: input.source,
      contentSha256,
      parserIdentity: input.parserIdentity,
      target: input.target,
      mappings: input.mappings,
    }),
  )

  // Pre-parsed payloads (source read before the run) resolve immediately;
  // lazy parses execute inside the governed run so parse failures are
  // recorded as failed runs with a bounded error code.
  const resolvePayload = async (): Promise<ParsedTabularPayload> => {
    if (input.payload) return input.payload
    try {
      return await input.parse!()
    } catch (error) {
      // A reader that says why it refused (an unrecognised file, a webhook
      // parser's answer) keeps its own code so the reason survives.
      const ownCode =
        error instanceof Error &&
        'code' in error &&
        typeof error.code === 'string' &&
        /^[a-z][a-z0-9_]{0,59}$/.test(error.code)
          ? error.code
          : null
      throw new ConnectorStepError(
        ownCode ?? input.parseErrorCode ?? 'parse_failed',
        error instanceof Error
          ? error.message
          : t('data.tabularIngestion.sourcePayloadUnreadable'),
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
        connectorType: input.connectorType,
        triggerKind: input.triggerKind ?? 'manual',
        requestDigest,
        retryOfRunId,
        observability: input.observability,
        startedMessage: t('data.tabularIngestion.ingestingBytes', {
          sheetName: input.sheetName,
          value: input.byteSize ?? 'unknown',
        }),
        buildResult: (value) => value.resultPayload,
      },
      async ({ run, log }) => {
        const resolved = await resolvePayload()
        const stages = await mapValidateCommitStages({
          client,
          workspaceId: input.workspaceId,
          target: input.target,
          mappings: input.mappings,
          sheetName: input.sheetName,
          parserIdentity: input.parserIdentity,
          parserVersion: input.parserVersion,
          runId: run.id,
          sourceProvenance: {
            source: input.source,
            fileRecordId: input.fileRecordId ?? null,
            checksum: contentSha256,
          },
          payload: resolved,
          log,
        })
        return {
          rowCount: stages.rowCount,
          metadata: resolved.metadata,
          warnings: resolved.warnings,
          datasetId: stages.datasetId,
          datasetRevision: stages.datasetRevision,
          resultPayload: {
            kind: input.resultKind,
            datasetId: stages.datasetId,
            datasetRevision: stages.datasetRevision ?? null,
            schemaVersionId: input.target.schemaVersionId,
            rowCount: stages.rowCount,
            [input.nameResultKey ?? 'sheetName']: input.sheetName,
            fileSha256: contentSha256,
            fileRecordId: input.fileRecordId ?? null,
            byteSize: input.byteSize ?? null,
            parser: input.parserIdentity,
            source: input.source,
            [input.metadataResultKey ?? 'contentMetadata']: resolved.metadata,
          },
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
      throw new TabularIngestionError(
        report.errorCode ?? 'unknown',
        report.errorMessage ??
          t('data.tabularIngestion.connectorRunFailedCode', {
            id: report.run.id,
            value: report.errorCode ?? 'unknown',
          }),
        report.run.id,
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
    throw new TabularIngestionError(
      report.errorCode ?? 'unknown',
      report.errorMessage ??
        t('data.tabularIngestion.connectorRunFailedCode2', {
          value: report.errorCode ?? 'unknown',
        }),
      report.run?.id ?? null,
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

// ---------------------------------------------------------------------------
// Deferred mode (INT-03 enterprise sources): the run starts before external
// source work; the running attempt establishes the content-aware digest.
// ---------------------------------------------------------------------------

/** Source read executed inside the governed run. */
export interface ExternalContentResolution {
  payload?: ParsedTabularPayload
  parse?: () => ParsedTabularPayload
  parseErrorCode?: string
  /** Full source descriptor, including `contentSha256`. */
  source: Record<string, unknown>
  contentSha256: string
  byteSize?: number | null
}

export interface ExternalIngestionInput {
  workspaceId: string
  connectorId: string
  /** PLAT-02 bounded metrics label (storage/database/...). */
  connectorType?: ConnectorType
  /** PLAT-02 server-injected metrics/logs; no-op when executed client-side. */
  observability?: ConnectorRunObservability
  parserIdentity: string
  sheetName: string
  /**
   * Logical selector identity (connector + selector + parser + target +
   * mapping) — no content. Known before the run starts; guards concurrent
   * duplicate attempts and carries retry lineage.
   */
  selectorSource: Record<string, unknown>
  /** Bounded source read executed inside the run. */
  resolveContent: (log: StageLog) => Promise<ExternalContentResolution>
  /** Optional retention stage (storage connectors), after dedupe. */
  retain?: (
    log: StageLog,
    contentSha256: string,
  ) => Promise<{
    fileRecordId: string
    checksum: string
    byteSize: number | null
  }>
  triggerKind?: 'manual' | 'scheduled' | 'event'
  target: TabularIngestionTarget
  mappings?: ImportColumnMapping[]
  resultKind: string
  metadataResultKey?: 'instrumentMetadata' | 'contentMetadata'
  nameResultKey?: 'fileName' | 'sheetName'
}

/**
 * Run one governed enterprise ingestion. The connector run exists before any
 * external work: connection, authentication, download/query and limit
 * failures all become failed runs with bounded error codes. The canonical
 * content-aware digest is established inside the attempt before commit; an
 * identical prior success short-circuits the attempt as a replay of the
 * stored result (no duplicate retained files, no duplicate rows).
 */
export async function ingestExternalPayload(
  client: DataClient,
  input: ExternalIngestionInput,
): Promise<TabularIngestionResult> {
  const selectorDigest = await ingestionRequestDigest([
    'selector',
    input.connectorId,
    input.selectorSource,
    input.parserIdentity,
    input.target.datasetId ?? input.target.schemaVersionId,
    input.target.newDatasetName ?? null,
    input.target.schemaVersionId,
    input.mappings ?? 'suggest',
  ])

  // Retry lineage: a prior failed attempt under the same selector identity is
  // retried as an explicitly linked new attempt (SB045 semantics, resolved
  // up-front because the content digest is not known before the run starts).
  const failedRuns = await client.list<{ id: string; attempt: number }>(
    'connector_runs',
    `?connector_id=eq.${encodeURIComponent(input.connectorId)}&selector_digest=eq.${encodeURIComponent(selectorDigest)}&status=eq.failed&order=started_at.desc&limit=1`,
  )
  const retryOfRunId = failedRuns[0]?.id ?? null

  const report = await executeConnectorRun<IngestionWork>(
    client,
    {
      workspaceId: input.workspaceId,
      connectorId: input.connectorId,
      connectorType: input.connectorType,
      triggerKind: input.triggerKind ?? 'manual',
      selectorDigest,
      retryOfRunId,
      observability: input.observability,
      startedMessage: t('data.tabularIngestion.importing', {
        sheetName: input.sheetName,
      }),
      buildResult: (value) => value.resultPayload,
    },
    async ({ run, log }) => {
      // Stage — source read (bounded). Any external failure here becomes a
      // failed run with its bounded code (connection_failed,
      // authentication_failed, source_not_found, download_failed,
      // query_failed, row_limit_exceeded, ...).
      let content: ExternalContentResolution
      try {
        content = await input.resolveContent(log)
      } catch (error) {
        if (error instanceof ConnectorExecutionError) {
          throw new ConnectorStepError(error.code, error.message)
        }
        throw error
      }
      await log(
        'source',
        t('data.tabularIngestion.readSourceContentSha256', {
          slice: content.contentSha256.slice(0, 12),
        }),
        { source: content.source },
      )

      const requestDigest = await ingestionRequestDigest([
        'request',
        ...digestParts({
          connectorId: input.connectorId,
          source: content.source,
          contentSha256: content.contentSha256,
          parserIdentity: input.parserIdentity,
          target: input.target,
          mappings: input.mappings,
        }),
      ])

      // Stage — dedupe: establish the canonical content identity BEFORE
      // retention or commit. A prior success with the same identity means
      // the identical request was already imported: replay, never duplicate.
      let replay: {
        runId: string
        rowCount: number
        datasetId: string
        datasetRevision?: number
        metadata: Record<string, string>
      } | null = null
      try {
        await establishConnectorRunRequest(client, {
          workspaceId: input.workspaceId,
          runId: run.id,
          requestDigest,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (!/already imported|SB047/i.test(message)) {
          if (/already in progress|SB044/i.test(message)) {
            throw new ConnectorStepError(
              'conflict',
              t('data.tabularIngestion.identicalImportAlreadyRunning'),
            )
          }
          throw error
        }
        const prior = await client.list<{
          id: string
          attempt: number
          result: Record<string, unknown>
        }>(
          'connector_runs',
          `?connector_id=eq.${encodeURIComponent(input.connectorId)}&request_digest=eq.${encodeURIComponent(requestDigest)}&status=eq.succeeded&order=started_at.desc&limit=1`,
        )
        const stored = prior[0]?.result ?? {}
        replay = {
          runId: prior[0]?.id ?? '',
          rowCount: Number(stored.rowCount ?? 0),
          datasetId: String(stored.datasetId ?? input.target.datasetId ?? ''),
          datasetRevision: stored.datasetRevision
            ? Number(stored.datasetRevision)
            : undefined,
          metadata: (stored[input.metadataResultKey ?? 'contentMetadata'] ??
            {}) as Record<string, string>,
        }
        await log(
          'dedupe',
          t('data.tabularIngestion.identicalContentAlreadyImported', {
            runId: replay.runId,
          }),
          { replayOfRunId: replay.runId },
        )
      }

      if (replay) {
        return {
          rowCount: replay.rowCount,
          metadata: replay.metadata,
          warnings: [],
          datasetId: replay.datasetId,
          datasetRevision: replay.datasetRevision,
          resultPayload: {
            kind: input.resultKind,
            replayOfRunId: replay.runId,
            datasetId: replay.datasetId,
            datasetRevision: replay.datasetRevision ?? null,
            schemaVersionId: input.target.schemaVersionId,
            rowCount: replay.rowCount,
            [input.nameResultKey ?? 'sheetName']: input.sheetName,
            fileSha256: content.contentSha256,
            fileRecordId: null,
            byteSize: content.byteSize ?? null,
            parser: input.parserIdentity,
            source: content.source,
            [input.metadataResultKey ?? 'contentMetadata']: replay.metadata,
          },
        }
      }

      // Stage — retain raw source evidence through the canonical file
      // platform (storage connectors), before mapping and commit.
      let fileRecordId: string | null = null
      let retainedByteSize = content.byteSize ?? null
      if (input.retain) {
        const retained = await input.retain(log, content.contentSha256)
        fileRecordId = retained.fileRecordId
        retainedByteSize = retained.byteSize
        await log(
          'retain',
          t('data.tabularIngestion.retainedRawSourceFile', {
            fileRecordId: retained.fileRecordId,
          }),
          { fileRecordId: retained.fileRecordId },
        )
      }

      // Stages — parse → map → target → validate → commit.
      const resolved = content.payload ?? content.parse?.()
      if (!resolved) {
        throw new ConnectorStepError(
          content.parseErrorCode ?? 'parse_failed',
          t('data.tabularIngestion.payloadParseStepSupplied'),
        )
      }
      const stages = await mapValidateCommitStages({
        client,
        workspaceId: input.workspaceId,
        target: input.target,
        mappings: input.mappings,
        sheetName: input.sheetName,
        parserIdentity: input.parserIdentity,
        runId: run.id,
        sourceProvenance: {
          source: content.source,
          fileRecordId,
          checksum: content.contentSha256,
        },
        payload: resolved,
        log,
      })
      return {
        rowCount: stages.rowCount,
        metadata: resolved.metadata,
        warnings: resolved.warnings,
        datasetId: stages.datasetId,
        datasetRevision: stages.datasetRevision,
        resultPayload: {
          kind: input.resultKind,
          datasetId: stages.datasetId,
          datasetRevision: stages.datasetRevision ?? null,
          schemaVersionId: input.target.schemaVersionId,
          rowCount: stages.rowCount,
          [input.nameResultKey ?? 'sheetName']: input.sheetName,
          fileSha256: content.contentSha256,
          fileRecordId,
          byteSize: retainedByteSize,
          parser: input.parserIdentity,
          source: content.source,
          [input.metadataResultKey ?? 'contentMetadata']: resolved.metadata,
        },
      }
    },
  )

  if (!report.run || !report.value) {
    throw new TabularIngestionError(
      report.errorCode ?? 'unexpected_error',
      report.errorMessage ??
        t('data.tabularIngestion.connectorRunFailedWithout', {
          value: report.run?.id ?? '',
        }),
    )
  }

  return {
    runId: report.run.id,
    attempt: report.run.attempt,
    alreadyCompleted: report.value.resultPayload['replayOfRunId'] != null,
    rowCount: report.value.rowCount,
    datasetId: report.value.datasetId,
    datasetRevision: report.value.datasetRevision,
    metadata: report.value.metadata,
    warnings: report.value.warnings,
    contentSha256: String(report.value.resultPayload['fileSha256'] ?? ''),
  }
}
