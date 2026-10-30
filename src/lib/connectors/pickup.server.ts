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
import { annotateRequest } from '#/lib/request-log'
import type { DataClient } from '../data-client'
import type { ExternalClaims } from '../external-token'
import { boundedErrorMessage } from './enterprise/errors'
import { sha256Hex } from './digest'
import {
  IntakeError,
  describeIntakeFailure,
  recordIntakeFailure,
  runIntake,
} from './intake.server'
import type { IntakeResult, IntakeRetained } from './intake.server'
import { webhookReader } from './webhook-parser.server'
import type { WebhookParserDeps } from './webhook-parser.server'
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

export type PickupRetained = IntakeRetained

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
  /** Replaced in tests; the server reads the sealed key. */
  loadWebhookSecret?: (workspaceId: string, parserId: string) => Promise<string>
  webhook?: WebhookParserDeps
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

export type PickupResult = IntakeResult

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
  if (/\.xlsx$/i.test(fileName))
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
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

function errorResponse(status: number, code: string, message: string) {
  if (status >= 500) annotateRequest({ error: { code, message } })
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
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
  annotateRequest({
    auth: 'api_credential',
    workspace: { id: workspaceId },
    connector: { key: connectorKey },
  })
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

  const target = {
    projectId: pickup.projectId,
    schemaVersionId: pickup.schemaVersionId,
    datasetId: pickup.datasetId,
    newDatasetName: pickup.datasetId
      ? null
      : renderDatasetName(pickup.datasetNamePattern, {
          connector: connector.name,
          file: fileName,
          date: new Date().toISOString().slice(0, 10),
        }),
  }
  const forIntake = {
    client,
    workspaceId,
    connector,
    fileName,
    source: 'agent' as const,
    target,
  }

  // A file that can't even be kept (too large, empty) is still written down,
  // so it doesn't vanish into the agent's `failed` folder unseen.
  let bytes: Uint8Array
  try {
    bytes = await readBody(request, deps.maxBytes ?? PICKUP_MAX_BYTES)
  } catch (error) {
    if (error instanceof PickupError) {
      await recordIntakeFailure({
        ...forIntake,
        retained: null,
        code: error.code,
        message: describeIntakeFailure(error.code),
        parserKey: null,
        checksum: null,
        byteSize: null,
        runId: null,
      })
    }
    throw error
  }
  const checksum = await sha256Hex(bytes)

  // The same file sent again while its problem is open (the agent retries a
  // service that was down) reuses the copy already kept.
  const open = await client
    .list<{ file_record_id: string | null }>(
      'intake_failures',
      `?connector_id=eq.${connector.id}&checksum=eq.${checksum}&status=eq.open&select=file_record_id&limit=1`,
    )
    .catch(() => [])
  const kept = open[0]?.file_record_id ?? null
  const retained: IntakeRetained = kept
    ? {
        fileRecordId: kept,
        fileObjectId: null,
        byteSize: bytes.byteLength,
        checksum,
      }
    : await deps.retain({
        token,
        client,
        workspaceId,
        projectId: pickup.projectId,
        fileName,
        mediaType: mediaTypeFor(fileName, request.headers.get('content-type')),
        bytes,
      })

  try {
    return await runIntake({
      ...forIntake,
      bytes,
      retained,
      triggerKind: 'event',
      autoDetect: pickup.autoDetect,
      parserKey: parserOverride,
      instrumentId: pickup.instrumentId,
      readWithWebhook: webhookReader({
        workspaceId,
        fileName,
        bytes,
        loadSecret: deps.loadWebhookSecret,
        deps: deps.webhook,
      }),
    })
  } catch (error) {
    if (error instanceof IntakeError) {
      throw new PickupError(error.status, error.code, error.message)
    }
    throw error
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
