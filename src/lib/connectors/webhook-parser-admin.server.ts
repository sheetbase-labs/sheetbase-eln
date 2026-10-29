/**
 * Makes webhook parsers and their signing keys. Signed-in; pointing the
 * workspace's files at another service needs the same access as registering
 * an integration, which the database checks in `api.create_webhook_parser`.
 */
import { z } from 'zod'

import { createServerDataClient } from './enterprise/execution.server'
import { boundedErrorMessage } from './enterprise/errors'
import { rotateParserWebhookSecret } from './webhook-parser.server'
import {
  realSessionAuthDeps,
  requestErrorResponse,
  resolveSessionAuth,
} from '../request-auth'
import type { SessionAuthDeps } from '../request-auth'

const bodySchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('create'),
      name: z.string().trim().min(1).max(120),
      format: z.enum(['csv', 'tsv', 'xlsx', 'json']),
      url: z.string().trim().min(1).max(2000),
      instrumentId: z.uuid().nullable().optional(),
    })
    .strict(),
  z.object({ action: z.literal('rotate'), parserId: z.uuid() }).strict(),
])

/** `qPCR bench service` → `qpcr-bench-service`. */
export function parserKeyFromName(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return slug || 'webhook-parser'
}

export async function handleWebhookParserAdmin(
  request: Request,
  deps: SessionAuthDeps = realSessionAuthDeps,
): Promise<Response> {
  if (request.method !== 'POST') {
    return requestErrorResponse(405, 'method_not_allowed', 'Use POST.')
  }
  const auth = await resolveSessionAuth(request.headers, deps)
  if (!auth.ok)
    return requestErrorResponse(auth.status, auth.code, auth.message)
  const { context } = auth
  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return requestErrorResponse(
      400,
      'invalid_request',
      'Give the parser a name, a file format and the address it listens at.',
    )
  }
  const body = parsed.data
  const client = createServerDataClient(context.token)
  try {
    if (body.action === 'rotate') {
      await client.rpc('require_capability', {
        p_workspace_id: context.workspaceId,
        p_capability: 'integrations.manage',
      })
      const owned = await client.list<{ id: string }>(
        'parsers',
        `?id=eq.${body.parserId}&select=id&limit=1`,
      )
      if (!owned[0]) {
        return requestErrorResponse(404, 'not_found', 'No such parser.')
      }
      const secret = await rotateParserWebhookSecret({
        workspaceId: context.workspaceId,
        parserId: body.parserId,
        userId: context.userId,
      })
      return Response.json({ parserId: body.parserId, secret })
    }

    const key = parserKeyFromName(body.name)
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
    }>('create_webhook_parser', {
      p_workspace_id: context.workspaceId,
      p_key: key,
      p_name: body.name,
      p_format: body.format,
      p_version: version,
      p_url: body.url,
      p_instrument_id: body.instrumentId ?? null,
    })
    // A new version of an existing parser keeps its key; the first version
    // makes one, shown once.
    const secret = existing[0]
      ? null
      : await rotateParserWebhookSecret({
          workspaceId: context.workspaceId,
          parserId: created.parserId,
          userId: context.userId,
        })
    return Response.json({ ...created, key, secret }, { status: 201 })
  } catch (error) {
    const message = boundedErrorMessage(error)
    if (/capability required|not permitted|42501/i.test(message)) {
      return requestErrorResponse(
        403,
        'not_permitted',
        'You need access to Integrations to set up a webhook parser.',
      )
    }
    if (/http or https address/i.test(message)) {
      return requestErrorResponse(
        422,
        'invalid_address',
        'Use an http or https address.',
      )
    }
    return requestErrorResponse(422, 'webhook_parser_failed', message)
  }
}
