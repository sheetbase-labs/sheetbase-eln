/**
 * One way in for instrument files.
 *
 * The folder agent (`pickup.server.ts`), the connector page and "Try again"
 * on an intake problem all end up here with a file that is already retained:
 *
 *   file → parser version (approved, from the workspace parser list)
 *        → mapping → dataset → connector run → instrument run
 *
 * A file that can't be read is not lost and not silent: its reason is kept as
 * an intake problem next to the retained file, so someone can try it again
 * (possibly with another parser) or set it aside. Reading the same file later
 * closes the problem by itself.
 */
import type { DataClient } from '../data-client'
import { DataClientError } from '../data-client'
import { listCanonicalDatasetSchemaVersionFields } from '../dataset-schema-definition-rpc'
import type { ImportTargetField } from '../import-mapping'
import { t } from '#/copy'
import {
  ConnectorExecutionError,
  boundedErrorMessage,
} from './enterprise/errors'
import { isXlsxBytes, matrixToCsv, readXlsxMatrices } from '../import-parse'
import { sha256Hex } from './digest'
import { ingestInstrumentPayload } from './instrument-ingestion'
import { detectParserId } from './instrument-parsers'
import { ParserResolutionError } from './parser-resolution'
import type { ResolvedParser } from './parser-resolution'
import { TabularIngestionError } from './tabular-ingestion'
import type { ConnectorWire } from './types'
import { WebhookParserError } from './webhook-parser'
import type { ParsedInstrumentPayload } from './registry'

export interface IntakeRetained {
  fileRecordId: string
  fileObjectId: string | null
  byteSize: number
  checksum: string
}

export interface IntakeTarget {
  projectId: string
  schemaVersionId: string
  datasetId: string | null
  newDatasetName: string | null
}

export type IntakeSource = 'agent' | 'upload'

export interface IntakeInput {
  client: DataClient
  workspaceId: string
  connector: ConnectorWire
  fileName: string
  bytes: Uint8Array
  /** Null when the file was too large or empty to keep. */
  retained: IntakeRetained | null
  source: IntakeSource
  triggerKind: 'manual' | 'event'
  target: IntakeTarget
  /** Pick the reader from the file's content instead of the connector's parser. */
  autoDetect: boolean
  /** A parser chosen for this file, overriding the connector's. */
  parserKey?: string | null
  instrumentId: string | null
  /** Runs a webhook parser; supplied by the server (it holds the signing key). */
  readWithWebhook?: (parser: ResolvedParser) => Promise<ParsedInstrumentPayload>
  /** A failed run this one follows, when someone chose to try again. */
  retryOfRunId?: string | null
}

export interface IntakeResult {
  runId: string
  alreadyCompleted: boolean
  datasetId: string
  datasetRevision: number | null
  rowCount: number
  parser: string
  fileRecordId: string | null
  warnings: string[]
  instrumentRunId: string | null
  instrumentLink: 'linked' | 'skipped' | 'failed'
}

export class IntakeError extends Error {
  readonly status: number
  readonly code: string
  /** The recorded intake problem, when one could be written. */
  readonly failureId: string | null
  constructor(
    status: number,
    code: string,
    message: string,
    failureId: string | null = null,
  ) {
    super(message)
    this.name = 'IntakeError'
    this.status = status
    this.code = code
    this.failureId = failureId
  }
}

export interface IntakeFailureRow {
  id: string
  connector_id: string
  instrument_id: string | null
  connector_run_id: string | null
  file_record_id: string | null
  file_name: string
  checksum: string | null
  byte_size: number | string | null
  source: IntakeSource
  code: string
  message: string
  parser_key: string | null
  target: Record<string, unknown>
  status: 'open' | 'resolved' | 'dismissed'
  attempts: number
  created_at: string
  last_attempt_at: string
}

/** Codes the agent should give up on, against the ones worth trying later. */
const TRANSIENT = new Set(['webhook_unreachable', 'webhook_timeout'])

/** The file's words for what went wrong, for a scientist rather than a developer. */
export function describeIntakeFailure(
  code: string,
  context: { parser?: string | null; detail?: string | null } = {},
): string {
  const parser = context.parser ?? t('data.intake.reasons.thisParser')
  const detail = (context.detail ?? '').trim()
  switch (code) {
    case 'unsupported_format':
      return t('data.intake.reasons.unsupportedFormat')
    case 'unreadable_workbook':
      return t('data.intake.reasons.unreadableWorkbook')
    case 'parser_unknown':
      return t('data.intake.reasons.parserUnknown', { parser })
    case 'parser_not_approved':
      return t('data.intake.reasons.parserNotApproved', { parser })
    case 'parser_unrecognised':
      return t('data.intake.reasons.parserUnrecognised', { parser })
    case 'parser_unsupported':
      return t('data.intake.reasons.parserUnsupported', { parser })
    case 'webhook_unreachable':
      return t('data.intake.reasons.webhookUnreachable', { parser })
    case 'webhook_timeout':
      return t('data.intake.reasons.webhookTimeout', { parser })
    case 'webhook_no_key':
      return t('data.intake.reasons.webhookNoKey', { parser })
    case 'webhook_address_refused':
      return t('data.intake.reasons.webhookAddressRefused', { parser })
    case 'webhook_bad_answer':
      return t('data.intake.reasons.webhookBadAnswer', { parser, detail })
    case 'webhook_error':
    case 'webhook_refused':
      return t('data.intake.reasons.webhookRefused', { parser, detail })
    case 'no_rows':
      return t('data.intake.reasons.noRows')
    case 'no_mapping':
      return t('data.intake.reasons.noMapping')
    case 'file_too_large':
      return t('data.intake.reasons.fileTooLarge')
    case 'empty_file':
      return t('data.intake.reasons.emptyFile')
    case 'parse_failed':
      return detail
        ? t('data.intake.reasons.parseFailed', { parser, detail })
        : t('data.intake.reasons.parseFailedPlain', { parser })
    default:
      return detail || t('data.intake.reasons.unknown')
  }
}

/**
 * The text of the file a reader works on. An Excel workbook is read as its
 * first sheet with data, written out as plain cells, so a parser sees the same
 * rows however the instrument saved them.
 */
async function readIntakeText(bytes: Uint8Array): Promise<string> {
  if (isXlsxBytes(bytes)) {
    const sheet = await readXlsxMatrices(
      bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer,
    )
      .then((sheets) => sheets.at(0))
      .catch(() => {
        throw new IntakeError(
          422,
          'unreadable_workbook',
          describeIntakeFailure('unreadable_workbook'),
        )
      })
    if (!sheet)
      throw new IntakeError(
        422,
        'empty_file',
        describeIntakeFailure('empty_file'),
      )
    return matrixToCsv(sheet.matrix)
  }
  // A NUL byte in the first block means a binary format no text parser can read.
  if (bytes.subarray(0, 4096).includes(0)) {
    throw new IntakeError(
      415,
      'unsupported_format',
      describeIntakeFailure('unsupported_format'),
    )
  }
  return new TextDecoder('utf-8').decode(bytes)
}

/** Best-effort instrument-side record of a read file. Never throws. */
async function linkToInstrument(
  client: DataClient,
  input: {
    workspaceId: string
    instrumentId: string
    fileName: string
    retained: IntakeRetained
    projectId: string
  },
): Promise<string> {
  const identifier = `pickup-${input.retained.checksum.slice(0, 16)}`
  const run = await client.rpc<{ id: string }>('create_instrument_run', {
    p_workspace_id: input.workspaceId,
    p_name: input.fileName.slice(0, 200),
    p_run_identifier: identifier,
    p_instrument_id: input.instrumentId,
    p_project_id: input.projectId,
    p_tags: ['pickup'],
  })
  await client.rpc('start_instrument_run', {
    p_workspace_id: input.workspaceId,
    p_run_id: run.id,
  })
  await client.rpc('register_raw_file', {
    p_workspace_id: input.workspaceId,
    p_run_id: run.id,
    p_filename: input.fileName,
    p_size_bytes: input.retained.byteSize,
    p_checksum: input.retained.checksum,
    p_file_id: input.retained.fileObjectId,
    p_ingestion_status: 'complete',
  })
  await client.rpc('link_run_record', {
    p_workspace_id: input.workspaceId,
    p_run_id: run.id,
    p_linked_record_id: input.retained.fileRecordId,
    p_link_type: 'file',
  })
  await client.rpc('complete_instrument_run', {
    p_workspace_id: input.workspaceId,
    p_run_id: run.id,
  })
  return run.id
}

/**
 * Writes the problem down. If even that fails (for example the person can't
 * write here) the original error still goes back to the caller.
 */
export async function recordIntakeFailure(
  input: Pick<
    IntakeInput,
    | 'client'
    | 'workspaceId'
    | 'connector'
    | 'fileName'
    | 'retained'
    | 'source'
    | 'target'
  > & {
    code: string
    message: string
    parserKey: string | null
    checksum: string | null
    byteSize: number | null
    runId: string | null
  },
): Promise<string | null> {
  try {
    const row = await input.client.rpc<IntakeFailureRow>(
      'record_intake_failure',
      {
        p_workspace_id: input.workspaceId,
        p_connector_id: input.connector.id,
        p_file_name: input.fileName,
        p_source: input.source,
        p_code: input.code,
        p_message: input.message,
        p_file_record_id: input.retained?.fileRecordId ?? null,
        p_checksum: input.checksum,
        p_byte_size: input.byteSize,
        p_parser_key: input.parserKey,
        p_target: input.target,
        p_connector_run_id: input.runId,
      },
    )
    return row.id
  } catch {
    return null
  }
}

export async function runIntake(input: IntakeInput): Promise<IntakeResult> {
  const { client, workspaceId, connector, target } = input
  const checksum = input.retained?.checksum || (await sha256Hex(input.bytes))
  let parserKey: string | null = input.parserKey?.trim() || null
  let parserName: string | null = null
  let runId: string | null = null

  const fail = async (
    status: number,
    code: string,
    detail: string | null,
  ): Promise<never> => {
    const message = describeIntakeFailure(code, {
      parser: parserName ?? parserKey,
      detail,
    })
    const failureId = await recordIntakeFailure({
      ...input,
      code,
      message,
      parserKey,
      checksum,
      byteSize: input.retained?.byteSize ?? input.bytes.byteLength,
      runId,
    })
    throw new IntakeError(status, code, message, failureId)
  }

  try {
    const text = await readIntakeText(input.bytes)
    parserKey ??=
      input.autoDetect || !connector.parser_id
        ? detectParserId(text)
        : connector.parser_id

    const fieldRows = await listCanonicalDatasetSchemaVersionFields(
      client,
      target.schemaVersionId,
    )
    const fields: ImportTargetField[] = fieldRows
      .filter((field) => field.lifecycle === 'active')
      .map((field) => ({
        id: field.field_id,
        key: field.key,
        label: field.label,
        logicalType: field.logical_type,
        nullable: field.nullable,
        kind: 'dataset-field',
      }))
    if (fields.length === 0) {
      throw new IntakeError(
        422,
        'pickup_not_configured',
        t('data.intake.reasons.noFields'),
      )
    }

    let expectedRevision: number | null = null
    if (target.datasetId) {
      const datasets = await client.list<{
        id: string
        revision: number | string
      }>('datasets', `?id=eq.${target.datasetId}&select=id,revision&limit=1`)
      if (!datasets[0]) {
        throw new IntakeError(
          422,
          'pickup_not_configured',
          t('data.intake.reasons.datasetGone'),
        )
      }
      expectedRevision = Number(datasets[0].revision)
    }

    const result = await ingestInstrumentPayload(client, {
      workspaceId,
      connectorId: connector.id,
      parserId: parserKey,
      readWithWebhook: input.readWithWebhook,
      text,
      fileName: input.fileName,
      fileRecordId: input.retained?.fileRecordId ?? null,
      checksum,
      byteSize: input.retained?.byteSize ?? input.bytes.byteLength,
      triggerKind: input.triggerKind,
      target: {
        datasetId: target.datasetId,
        expectedRevision,
        newDatasetName: target.datasetId ? null : target.newDatasetName,
        schemaVersionId: target.schemaVersionId,
        fields,
      },
    })
    parserName = result.parser.label

    // Read: close whatever was open for this same file.
    void client
      .rpc('resolve_intake_failures_for_file', {
        p_connector_id: connector.id,
        p_checksum: checksum,
        p_run_id: result.runId,
      })
      .catch(() => undefined)

    let instrumentRunId: string | null = null
    let instrumentLink: IntakeResult['instrumentLink'] = 'skipped'
    if (input.instrumentId && input.retained) {
      try {
        instrumentRunId = await linkToInstrument(client, {
          workspaceId,
          instrumentId: input.instrumentId,
          fileName: input.fileName,
          retained: input.retained,
          projectId: target.projectId,
        })
        instrumentLink = 'linked'
      } catch {
        instrumentLink = 'failed'
      }
    }
    return {
      runId: result.runId,
      alreadyCompleted: result.alreadyCompleted,
      datasetId: result.datasetId,
      datasetRevision: result.datasetRevision ?? null,
      rowCount: result.rowCount,
      parser: result.parser.identity,
      fileRecordId: input.retained?.fileRecordId ?? null,
      warnings: result.warnings,
      instrumentRunId,
      instrumentLink,
    }
  } catch (error) {
    if (error instanceof IntakeError) {
      if (error.failureId || error.code === 'pickup_not_configured') throw error
      return fail(error.status, error.code, error.message)
    }
    if (error instanceof ParserResolutionError) {
      parserKey = error.parserKey ?? parserKey
      return fail(422, error.code, error.message)
    }
    if (error instanceof WebhookParserError) {
      return fail(
        TRANSIENT.has(error.code) ? 502 : 422,
        error.code,
        error.message,
      )
    }
    if (error instanceof TabularIngestionError) {
      runId = error.runId
      return fail(
        TRANSIENT.has(error.code) ? 502 : 422,
        error.code,
        error.message,
      )
    }
    if (error instanceof ConnectorExecutionError) {
      return fail(422, error.code, boundedErrorMessage(error))
    }
    if (
      error instanceof DataClientError &&
      (error.status === 401 || error.status === 403)
    ) {
      throw error
    }
    return fail(422, 'ingestion_failed', boundedErrorMessage(error))
  }
}
