import { z } from 'zod'
import {
  postgrestRpc,
  realSessionAuthDeps,
  requestErrorResponse,
  resolveSessionAuth,
} from '#/lib/request-auth'
import type { SessionAuthDeps } from '#/lib/request-auth'

const requestSchema = z.object({ fileId: z.uuid() }).strict()

/** Request intent only. The RPC requires an existing authoritative failure. */
export async function handleParserUpdateRequest(
  request: Request,
  deps: SessionAuthDeps = realSessionAuthDeps,
): Promise<Response> {
  if (request.method !== 'POST')
    return requestErrorResponse(405, 'method_not_allowed', 'Use POST.')
  const auth = await resolveSessionAuth(request.headers, deps)
  if (!auth.ok)
    return requestErrorResponse(auth.status, auth.code, auth.message)
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return requestErrorResponse(
      400,
      'invalid_request',
      'Choose a retained import file.',
    )
  }
  const body = requestSchema.safeParse(raw)
  if (!body.success)
    return requestErrorResponse(
      400,
      'invalid_request',
      'Only a retained file ID is accepted.',
    )
  const result = await postgrestRpc<{
    id: string
    parser_failure: { requestedAt?: string } | null
  }>(
    'request_parser_update',
    { p_file_id: body.data.fileId },
    auth.context.token,
  )
  if (result.status >= 400) {
    return requestErrorResponse(
      result.status,
      'request_failed',
      'The parser update request was not recorded. The file is kept for retry.',
    )
  }
  const row = Array.isArray(result.body) ? result.body[0] : result.body
  if (
    !row ||
    !('id' in row) ||
    row.id !== body.data.fileId ||
    !row.parser_failure?.requestedAt
  ) {
    return requestErrorResponse(
      502,
      'request_failed',
      'The server did not confirm a parser update request.',
    )
  }
  return Response.json({ ok: true, fileId: row.id })
}
