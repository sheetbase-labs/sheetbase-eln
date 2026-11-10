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
 * api.record_instrument_readings (migration 0068). A freezer or room takes the
 * same batch under `storageUnitId` or `storageRoomId` in place of `instrumentId`
 * (api.record_storage_readings, migration 0090). The token carries the
 * creating member's identity, so who may send readings is decided by the
 * database exactly as it is for a person working in the app. The folder agent
 * (scripts/instrument-agent.mjs) is the usual sender.
 */
import { z } from 'zod'

import { DataClientError } from '../data-client'
import type { DataClient } from '../data-client'
import type { ExternalClaims } from '../external-token'
import { annotateRequest } from '#/lib/request-log'
import { boundedErrorMessage } from './enterprise/errors'
import { PickupError, readBearer } from './pickup.server'

export const STREAM_MAX_BYTES = 512 * 1024
export const STREAM_MAX_READINGS = 2000

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const streamBodySchema = z.object({
  instrumentId: z.unknown().optional(),
  storageUnitId: z.unknown().optional(),
  storageRoomId: z.unknown().optional(),
  readings: z.unknown().optional(),
})

const streamReadingSchema = z.object({
  feed: z.string().trim().catch(''),
  value: z.number().catch(NaN),
  unit: z.string().optional().catch(undefined),
  at: z.string().optional().catch(undefined),
})

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
export function parseStreamBody(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- HTTP JSON is untrusted; the schemas below decode each field before use.
  raw: unknown,
) {
  const parsed = streamBodySchema.safeParse(raw)

  if (!parsed.success) {
    throw new PickupError(400, 'invalid_request', 'Send a JSON body.')
  }

  const body = parsed.data

  const named = (
    [
      ['instrumentId', 'instrument'],
      ['storageUnitId', 'unit'],
      ['storageRoomId', 'room'],
    ] as const
  ).filter(([key]) => body[key] !== undefined)

  if (named.length !== 1) {
    throw new PickupError(
      400,
      'invalid_request',
      'Name one place for the readings: instrumentId, storageUnitId or storageRoomId.',
    )
  }

  const [idKey, kind] = named[0]
  const targetId = z.string().regex(UUID).safeParse(body[idKey])

  if (!targetId.success) {
    throw new PickupError(
      400,
      'invalid_request',
      `${idKey} must be the id of the ${kind === 'instrument' ? 'instrument' : kind === 'unit' ? 'storage unit' : 'room'}.`,
    )
  }

  const list = z.array(z.unknown()).safeParse(body.readings)

  if (
    !list.success ||
    list.data.length === 0 ||
    list.data.length > STREAM_MAX_READINGS
  ) {
    throw new PickupError(
      400,
      'invalid_request',
      `Send between 1 and ${STREAM_MAX_READINGS} readings at a time.`,
    )
  }

  const readings = list.data.map((item, index): StreamReading => {
    const parsedReading = streamReadingSchema.safeParse(item)

    const row = parsedReading.success
      ? parsedReading.data
      : { feed: '', value: NaN }

    const { feed, value } = row

    if (!feed || feed.length > 80) {
      throw new PickupError(
        400,
        'invalid_reading',
        `Reading ${index + 1} needs a feed name of up to 80 characters.`,
      )
    }

    if (!Number.isFinite(value)) {
      throw new PickupError(
        400,
        'invalid_reading',
        `Reading ${index + 1} (${feed}) needs a number for value.`,
      )
    }

    const reading: StreamReading = { feed, value }

    if (row.unit?.trim()) {
      reading.unit = row.unit.trim().slice(0, 20)
    }

    if (row.at) {
      if (Number.isNaN(Date.parse(row.at))) {
        throw new PickupError(
          400,
          'invalid_reading',
          `Reading ${index + 1} (${feed}) has a time that isn’t a date.`,
        )
      }

      reading.at = new Date(row.at).toISOString()
    }

    return reading
  })

  return { target: { kind, id: targetId.data }, readings }
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
        ? String(error.code)
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

  const { target, readings } = parseStreamBody(raw)
  annotateRequest({
    auth: 'api_credential',
    workspace: { id: claims.workspace_id },
    ...(target.kind === 'instrument'
      ? { instrument: { id: target.id } }
      : { storage: { kind: target.kind, id: target.id } }),
  })
  const client = deps.createClient(token)

  if (target.kind === 'instrument') {
    return client.rpc<StreamResult>('record_instrument_readings', {
      p_instrument_id: target.id,
      p_readings: readings,
    })
  }

  return client.rpc<StreamResult>('record_storage_readings', {
    p_unit_id: target.kind === 'unit' ? target.id : null,
    p_room_id: target.kind === 'room' ? target.id : null,
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
          `The token’s owner cannot send readings here: ${boundedErrorMessage(error)}`,
        )
      }

      if (error.status === 400 || error.status === 422) {
        return errorResponse(422, 'refused', boundedErrorMessage(error))
      }
    }

    return errorResponse(502, 'stream_failed', boundedErrorMessage(error))
  }
}
