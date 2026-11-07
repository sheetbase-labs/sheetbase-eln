/**
 * Lists the converters the Python runtime offers and sets a workspace up with
 * one as a parser. Signed in; choosing how files are read needs the same
 * access as registering an integration, which the database checks in
 * `api.create_converter_parser`.
 */
import { z } from 'zod'

import { createServerDataClient } from './enterprise/execution.server'
import { boundedErrorMessage } from './enterprise/errors'
import { ConverterError, listConverters } from './converter.server'
import { parserKeyFromName } from './webhook-parser-admin.server'
import {
  realSessionAuthDeps,
  requestErrorResponse,
  resolveSessionAuth,
} from '../request-auth'
import type { SessionAuthDeps } from '../request-auth'
import type { ConverterVendor } from '../instrument-data/asm'

const bodySchema = z
  .object({
    vendor: z.string().regex(/^[A-Z0-9_]{2,80}$/),
    instrumentId: z.uuid().nullable().optional(),
  })
  .strict()

/** The format a parser row carries, from the files the converter reads. */
export function parserFormatFor(vendor: ConverterVendor): 'csv' | 'xlsx' | 'json' {
  const extensions = vendor.extensions.toLowerCase().split(',')
  if (extensions.includes('json') && extensions.length === 1) return 'json'
  if (extensions.includes('xlsx') && !extensions.includes('csv')) return 'xlsx'
  return 'csv'
}

function converterErrorResponse(error: ConverterError): Response {
  return requestErrorResponse(
    error.code === 'converter_unavailable' ? 503 : 422,
    error.code,
    error.code === 'converter_unavailable'
      ? 'The Python runtime isn’t available, so the converters can’t be listed. Ask an administrator to set it up.'
      : error.message,
  )
}

export async function handleConverterAdmin(
  request: Request,
  deps: SessionAuthDeps = realSessionAuthDeps,
  list: typeof listConverters = listConverters,
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'POST') {
    return requestErrorResponse(405, 'method_not_allowed', 'Use GET or POST.')
  }
  const auth = await resolveSessionAuth(request.headers, deps)
  if (!auth.ok)
    return requestErrorResponse(auth.status, auth.code, auth.message)
  const { context } = auth
  try {
    if (request.method === 'GET') {
      return Response.json({ converters: await list() })
    }
    const parsed = bodySchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return requestErrorResponse(
        400,
        'invalid_request',
        'Choose the instrument software whose files should be converted.',
      )
    }
    const body = parsed.data
    const vendor = (await list()).find((entry) => entry.key === body.vendor)
    if (!vendor) {
      return requestErrorResponse(
        422,
        'converter_unknown',
        'This install doesn’t offer that converter.',
      )
    }
    const client = createServerDataClient(context.token)
    const key = parserKeyFromName(`allotrope ${vendor.name}`)
    const existing = await client.list<{
      id: string
      parser_versions: Array<{ version: number }>
    }>(
      'parsers',
      `?workspace_id=eq.${context.workspaceId}&key=eq.${encodeURIComponent(key)}&select=id,parser_versions(version)&limit=1`,
    )
    const version =
      Math.max(
        0,
        ...(existing[0]?.parser_versions.map((v) => v.version) ?? []),
      ) + 1
    const created = await client.rpc<{
      parserId: string
      parserVersionId: string
      version: number
    }>('create_converter_parser', {
      p_workspace_id: context.workspaceId,
      p_key: key,
      p_name: `${vendor.name} (Allotrope)`,
      p_format: parserFormatFor(vendor),
      p_version: version,
      p_vendor: vendor.key,
      p_instrument_id: body.instrumentId ?? null,
    })
    return Response.json({ ...created, key }, { status: 201 })
  } catch (error) {
    if (error instanceof ConverterError) return converterErrorResponse(error)
    const message = boundedErrorMessage(error)
    if (/capability required|not permitted|42501/i.test(message)) {
      return requestErrorResponse(
        403,
        'not_permitted',
        'You need access to Integrations to set up a converter.',
      )
    }
    return requestErrorResponse(422, 'converter_parser_failed', message)
  }
}
