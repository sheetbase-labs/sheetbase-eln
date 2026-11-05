/**
 * Live readings from an instrument.
 *
 * `POST /api/connectors/stream` takes a short batch of readings as JSON,
 *
 *   { "instrumentId": "<uuid>",
 *     "readings": [{ "feed": "Chamber temperature", "value": 4.1,
 *                    "unit": "°C", "at": "2026-11-05T09:00:00Z" }] }
 *
 * with a personal API token as `Authorization: Bearer`, and hands it to
 * api.record_instrument_readings (migration 0068). The token carries the
 * creating member's identity, so who may send readings is decided by the
 * database exactly as it is for a person working in the app. The folder agent
 * (scripts/instrument-agent.mjs) is the usual sender.
 */
import { DataClientError } from '../data-client'
import type { DataClient } from '../data-client'
import type { ExternalClaims } from '../external-token'
import { annotateRequest } from '#/lib/request-log'
import { boundedErrorMessage } from './enterprise/errors'
import { PickupError, readBearer } from './pickup.server'

export const STREAM_MAX_BYTES = 512 * 1024
export const STREAM_MAX_READINGS = 2000

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface StreamDeps {
  verifyCredential: (token: string) => Promise<ExternalClaims>
  createClient: (token: string) => DataClient
}

export interface StreamReading {
  feed: string
  value: number
  unit?: string
  at?: string
}

export interface StreamResult {
  stored: number
  feeds: number
}

function errorResponse(status: number, code: string, message: string) {
  if (status >= 500) annotateRequest({ error: { code, message } })
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** The body, checked down to what the database will accept. */
export function parseStreamBody(raw: unknown): {
  instrumentId: string
  readings: StreamReading[]
} {
  if (!raw || typeof raw !== 'object') {
    throw new PickupError(400, 'invalid_request', 'Send a JSON body.')
  }
  const body = raw as Record<string, unknown>
  const instrumentId = body['instrumentId']
  if (typeof instrumentId !== 'string' || !UUID.test(instrumentId)) {
    throw new PickupError(
      400,
      'invalid_request',
      'instrumentId must be the instrument’s id.',
    )
  }
  const list = body['readings']
  if (
    !Array.isArray(list) ||
    list.length === 0 ||
    list.length > STREAM_MAX_READINGS
  ) {
    throw new PickupError(
      400,
      'invalid_request',
      `Send between 1 and ${STREAM_MAX_READINGS} readings at a time.`,
    )
  }
  const readings = list.map((item, index): StreamReading => {
    const row = (item ?? {}) as Record<string, unknown>
    const feed = typeof row['feed'] === 'string' ? row['feed'].trim() : ''
    const value = row['value']
    if (!feed || feed.length > 80) {
      throw new PickupError(
        400,
        'invalid_reading',
        `Reading ${index + 1} needs a feed name of up to 80 characters.`,
      )
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new PickupError(
        400,
        'invalid_reading',
        `Reading ${index + 1} (${feed}) needs a number for value.`,
      )
    }
    const reading: StreamReading = { feed, value }
    if (typeof row['unit'] === 'string' && row['unit'].trim()) {
      reading.unit = row['unit'].trim().slice(0, 20)
    }
    if (typeof row['at'] === 'string' && row['at']) {
      if (Number.isNaN(Date.parse(row['at']))) {
        throw new PickupError(
          400,
          'invalid_reading',
          `Reading ${index + 1} (${feed}) has a time that isn’t a date.`,
        )
      }
      reading.at = new Date(row['at']).toISOString()
    }
    return reading
  })
  return { instrumentId, readings }
}

export async function runStream(
  request: Request,
  deps: StreamDeps,
): Promise<StreamResult> {
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
      'Live readings need a personal API token; service credentials cannot write.',
    )
  }
  if (!claims.scopes.includes('datasets:write')) {
    throw new PickupError(
      403,
      'insufficient_scope',
      'Credential lacks scope: datasets:write',
    )
  }
  const declared = Number(request.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > STREAM_MAX_BYTES) {
    throw new PickupError(413, 'too_large', 'That batch is too large.')
  }
  const text = await request.text()
  if (text.length > STREAM_MAX_BYTES) {
    throw new PickupError(413, 'too_large', 'That batch is too large.')
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new PickupError(400, 'invalid_request', 'The body is not JSON.')
  }
  const { instrumentId, readings } = parseStreamBody(raw)
  annotateRequest({
    auth: 'api_credential',
    workspace: { id: claims.workspace_id },
    instrument: { id: instrumentId },
  })
  return deps
    .createClient(token)
    .rpc<StreamResult>('record_instrument_readings', {
      p_instrument_id: instrumentId,
      p_readings: readings,
    })
}

export async function handleStream(
  request: Request,
  deps: StreamDeps,
): Promise<Response> {
  if (request.method !== 'POST') {
    return errorResponse(405, 'method_not_allowed', 'Use POST.')
  }
  try {
    const result = await runStream(request, deps)
    return new Response(JSON.stringify(result), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    })
  } catch (error) {
    if (error instanceof PickupError) {
      return errorResponse(error.status, error.code, error.message)
    }
    if (error instanceof DataClientError) {
      // The database refused: no access to the instrument, a retired
      // instrument, a reading it will not take. Sending it again won't help.
      if (error.status === 401 || error.status === 403) {
        return errorResponse(
          403,
          'forbidden',
          `The token’s owner cannot send readings for this instrument: ${boundedErrorMessage(error)}`,
        )
      }
      if (error.status === 400 || error.status === 422) {
        return errorResponse(422, 'refused', boundedErrorMessage(error))
      }
    }
    return errorResponse(502, 'stream_failed', boundedErrorMessage(error))
  }
}
