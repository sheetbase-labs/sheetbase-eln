/**
 * INT-02 — instrument file pickup.
 *
 * `POST /api/connectors/pickup` is the machine entry for result files that
 * sit on a computer attached to an instrument (see scripts/instrument-agent.mjs
 * for the watched-folder agent). One request carries one file and runs the
 * same governed path as the manual ingest panel:
 *
 *   bearer token → connector (instrument, active) → raw bytes retained via the
 *   file platform → parser (connector's, or detected) → mapping → Dataset
 *   (new or existing) → connector run provenance → instrument run + raw file
 *
 * Auth is a personal API token (`files:write` + `datasets:write`). It carries
 * the creating member's identity, so RLS, viewer read-only and attribution are
 * the same as that person working in the app, and revoking the token or the
 * membership stops the agent immediately. The write RPCs are granted to
 * `authenticated` only, so service (api_client) tokens are refused up front
 * with a clear code rather than failing half way.
 *
 * The connector's `config.pickup` names where files go:
 *   { projectId, schemaVersionId, datasetId?, datasetNamePattern?,
 *     autoDetect?, instrumentId? }
 */
import { DataClientError } from '../data-client'
import type { DataClient } from '../data-client'
import { listCanonicalDatasetSchemaVersionFields } from '../dataset-schema-definition-rpc'
import type { ImportTargetField } from '../import-mapping'
import type { ExternalClaims } from '../external-token'
import {
  ConnectorExecutionError,
  boundedErrorMessage,
} from './enterprise/errors'
import { sha256Hex } from './digest'
import { detectParserId } from './instrument-parsers'
import { ingestInstrumentPayload } from './instrument-ingestion'
import { getParser } from './registry'
import type { ConnectorWire } from './types'

export const PICKUP_MAX_BYTES = 25 * 1024 * 1024

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface PickupConfig {
  projectId: string
  schemaVersionId: string
  datasetId: string | null
  datasetNamePattern: string
  autoDetect: boolean
  instrumentId: string | null
}

export interface PickupRetained {
  fileRecordId: string
  fileObjectId: string | null
  byteSize: number
  checksum: string
}

export interface PickupDeps {
  /** Verifies the bearer token and that its credential is still live. */
  verifyCredential: (token: string) => Promise<ExternalClaims>
  createClient: (token: string) => DataClient
  /** Retains raw bytes through the file platform. */
  retain: (input: {
    token: string
    client: DataClient
    workspaceId: string
    projectId: string
    fileName: string
    mediaType: string
    bytes: Uint8Array
  }) => Promise<PickupRetained>
  maxBytes?: number
}

export class PickupError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'PickupError'
    this.status = status
    this.code = code
  }
}

export interface PickupResult {
  runId: string
  alreadyCompleted: boolean
  datasetId: string
  datasetRevision: number | null
  rowCount: number
  parser: string
  fileRecordId: string
  warnings: string[]
  instrumentRunId: string | null
  instrumentLink: 'linked' | 'skipped' | 'failed'
}

/** `Authorization: Bearer ...` → token, or null. */
export function readBearer(headers: Headers): string | null {
  const header = headers.get('authorization')
  const match = header ? /^Bearer\s+(.+)$/i.exec(header.trim()) : null
  return match ? match[1] : null
}

/** A file name from the agent: base name only, bounded, no control chars. */
export function sanitiseFileName(raw: string | null): string {
  const base = (raw ?? '').split(/[\\/]/).pop() ?? ''
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f]/g, '').trim()
  if (!cleaned || cleaned === '.' || cleaned === '..') {
    throw new PickupError(400, 'invalid_file_name', 'fileName is required.')
  }
  return cleaned.slice(0, 200)
}

export function parsePickupConfig(
  config: Record<string, unknown>,
): PickupConfig {
  const raw = config['pickup']
  if (!raw || typeof raw !== 'object') {
    throw new PickupError(
      422,
      'pickup_not_configured',
      'This connector has no pickup settings (config.pickup).',
    )
  }
  const pickup = raw as Record<string, unknown>
  const uuid = (key: string, required: boolean): string | null => {
    const value = pickup[key]
    if (value === undefined || value === null || value === '') {
      if (required) {
        throw new PickupError(
          422,
          'pickup_not_configured',
          `config.pickup.${key} is required.`,
        )
      }
      return null
    }
    if (typeof value !== 'string' || !UUID.test(value)) {
      throw new PickupError(
        422,
        'pickup_not_configured',
        `config.pickup.${key} must be a UUID.`,
      )
    }
    return value
  }
  const pattern = pickup['datasetNamePattern']
  return {
    projectId: uuid('projectId', true)!,
    schemaVersionId: uuid('schemaVersionId', true)!,
    datasetId: uuid('datasetId', false),
    instrumentId: uuid('instrumentId', false),
    datasetNamePattern:
      typeof pattern === 'string' && pattern.trim()
        ? pattern.slice(0, 200)
        : '{connector} — {file}',
    autoDetect: pickup['autoDetect'] === true,
  }
}

export function renderDatasetName(
  pattern: string,
  values: { connector: string; file: string; date: string },
): string {
  const name = pattern
    .replaceAll('{connector}', values.connector)
    .replaceAll('{file}', values.file)
    .replaceAll('{date}', values.date)
    .trim()
  return (name || values.file).slice(0, 200)
}

function mediaTypeFor(fileName: string, header: string | null): string {
  // The extension is what the instrument PC knows; generic client defaults
  // such as text/plain or form-encoded are not a better answer.
  if (/\.json$/i.test(fileName)) return 'application/json'
  if (/\.csv$/i.test(fileName)) return 'text/csv'
  if (/\.tsv$/i.test(fileName)) return 'text/tab-separated-values'
  if (/\.txt$/i.test(fileName)) return 'text/plain'
  const declared = header?.split(';')[0].trim()
  return declared && declared !== 'application/x-www-form-urlencoded'
    ? declared
    : 'application/octet-stream'
}

async function readBody(request: Request, max: number): Promise<Uint8Array> {
  const declared = Number(request.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > max) {
    throw new PickupError(
      413,
      'file_too_large',
      `Instrument files are limited to ${max} bytes.`,
    )
  }
  if (!request.body) {
    throw new PickupError(400, 'empty_file', 'The request has no file body.')
  }
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) {
      await reader.cancel()
      throw new PickupError(
        413,
        'file_too_large',
        `Instrument files are limited to ${max} bytes.`,
      )
    }
    chunks.push(value)
  }
  if (total === 0) {
    throw new PickupError(400, 'empty_file', 'The file is empty.')
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

function decodeText(bytes: Uint8Array): string {
  // A NUL byte in the first block means a binary format no parser can read.
  const head = bytes.subarray(0, 4096)
  if (head.includes(0)) {
    throw new PickupError(
      415,
      'unsupported_format',
      'Binary files are retained by the app but not parsed; export the run as CSV, TSV or JSON.',
    )
  }
  return new TextDecoder('utf-8').decode(bytes)
}

function errorResponse(status: number, code: string, message: string) {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * Best-effort instrument-side record of the pickup: a completed instrument run
 * holding the raw file and a link to the file record. The Dataset and its
 * connector run are already committed, so a failure here is reported, never
 * thrown.
 */
async function linkToInstrument(
  client: DataClient,
  input: {
    workspaceId: string
    instrumentId: string
    fileName: string
    retained: PickupRetained
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

export async function runPickup(
  request: Request,
  deps: PickupDeps,
): Promise<PickupResult> {
  const token = readBearer(request.headers)
  if (!token) {
    throw new PickupError(401, 'unauthenticated', 'Bearer token required.')
  }
  let claims: ExternalClaims
  try {
    claims = await deps.verifyCredential(token)
  } catch (error) {
    const code =
      error instanceof Error && 'code' in error
        ? String((error as { code: unknown }).code)
        : 'invalid_token'
    throw new PickupError(
      code === 'insufficient_scope' ? 403 : 401,
      code,
      boundedErrorMessage(error),
    )
  }
  if (claims.role !== 'authenticated') {
    throw new PickupError(
      403,
      'personal_token_required',
      'Instrument pickup needs a personal API token; service credentials cannot write files or Datasets.',
    )
  }
  for (const scope of ['files:write', 'datasets:write'] as const) {
    if (!claims.scopes.includes(scope)) {
      throw new PickupError(
        403,
        'insufficient_scope',
        `Credential lacks scope: ${scope}`,
      )
    }
  }

  const url = new URL(request.url)
  const connectorKey = url.searchParams.get('connector')?.trim()
  if (!connectorKey) {
    throw new PickupError(400, 'invalid_request', 'connector is required.')
  }
  const fileName = sanitiseFileName(url.searchParams.get('fileName'))
  const parserOverride = url.searchParams.get('parser')?.trim() || null

  const workspaceId = claims.workspace_id
  const client = deps.createClient(token)

  const connectors = await client.list<ConnectorWire>(
    'connectors',
    `?key=eq.${encodeURIComponent(connectorKey)}&workspace_id=eq.${workspaceId}&select=*&limit=1`,
  )
  const connector = connectors.at(0)
  if (!connector || connector.connector_type !== 'instrument') {
    throw new PickupError(
      404,
      'connector_not_found',
      'No such instrument connector.',
    )
  }
  if (connector.status !== 'active') {
    throw new PickupError(
      409,
      'connector_inactive',
      `The connector is ${connector.status}.`,
    )
  }
  const pickup = parsePickupConfig(connector.config)

  const bytes = await readBody(request, deps.maxBytes ?? PICKUP_MAX_BYTES)
  const text = decodeText(bytes)

  const parserId =
    parserOverride ??
    (pickup.autoDetect || !connector.parser_id
      ? detectParserId(text)
      : connector.parser_id)
  if (!getParser(parserId)) {
    throw new PickupError(
      422,
      'unknown_parser',
      `No parser registered for '${parserId}'.`,
    )
  }

  const fieldRows = await listCanonicalDatasetSchemaVersionFields(
    client,
    pickup.schemaVersionId,
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
    throw new PickupError(
      422,
      'pickup_not_configured',
      'The configured Dataset Schema Version has no active fields.',
    )
  }

  let expectedRevision: number | null = null
  if (pickup.datasetId) {
    const datasets = await client.list<{
      id: string
      revision: number | string
    }>('datasets', `?id=eq.${pickup.datasetId}&select=id,revision&limit=1`)
    if (!datasets[0]) {
      throw new PickupError(
        422,
        'pickup_not_configured',
        'The configured Dataset was not found.',
      )
    }
    expectedRevision = Number(datasets[0].revision)
  }

  const retained = await deps.retain({
    token,
    client,
    workspaceId,
    projectId: pickup.projectId,
    fileName,
    mediaType: mediaTypeFor(fileName, request.headers.get('content-type')),
    bytes,
  })

  let result
  try {
    result = await ingestInstrumentPayload(client, {
      workspaceId,
      connectorId: connector.id,
      parserId,
      text,
      fileName,
      fileRecordId: retained.fileRecordId,
      checksum: retained.checksum || (await sha256Hex(bytes)),
      byteSize: retained.byteSize,
      triggerKind: 'event',
      target: {
        datasetId: pickup.datasetId,
        expectedRevision,
        newDatasetName: pickup.datasetId
          ? null
          : renderDatasetName(pickup.datasetNamePattern, {
              connector: connector.name,
              file: fileName,
              date: new Date().toISOString().slice(0, 10),
            }),
        schemaVersionId: pickup.schemaVersionId,
        fields,
      },
    })
  } catch (error) {
    if (error instanceof ConnectorExecutionError) {
      throw new PickupError(422, error.code, boundedErrorMessage(error))
    }
    // The run is recorded as failed with a bounded code; the file stays
    // retained so the evidence is not lost.
    throw new PickupError(422, 'ingestion_failed', boundedErrorMessage(error))
  }

  let instrumentRunId: string | null = null
  let instrumentLink: PickupResult['instrumentLink'] = 'skipped'
  if (pickup.instrumentId) {
    try {
      instrumentRunId = await linkToInstrument(client, {
        workspaceId,
        instrumentId: pickup.instrumentId,
        fileName,
        retained,
        projectId: pickup.projectId,
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
    fileRecordId: retained.fileRecordId,
    warnings: result.warnings,
    instrumentRunId,
    instrumentLink,
  }
}

/** Request handler: maps `runPickup` outcomes onto the API error envelope. */
export async function handlePickup(
  request: Request,
  deps: PickupDeps,
): Promise<Response> {
  if (request.method !== 'POST') {
    return errorResponse(405, 'method_not_allowed', 'Use POST.')
  }
  try {
    const result = await runPickup(request, deps)
    return new Response(JSON.stringify(result), {
      status: result.alreadyCompleted ? 200 : 201,
      headers: { 'content-type': 'application/json' },
    })
  } catch (error) {
    if (error instanceof PickupError) {
      return errorResponse(error.status, error.code, error.message)
    }
    // A refusal from the database (no edit access to the pickup project, a
    // revoked membership) will not change on retry, so report it as one the
    // agent gives up on instead of a retryable 502.
    if (
      error instanceof DataClientError &&
      (error.status === 401 || error.status === 403)
    ) {
      return errorResponse(
        403,
        'forbidden',
        `The token's owner cannot write to the pickup project or Dataset: ${boundedErrorMessage(error)}`,
      )
    }
    return errorResponse(502, 'pickup_failed', boundedErrorMessage(error))
  }
}
