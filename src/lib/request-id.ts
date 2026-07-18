/**
 * API-006: correlation/request identifiers. Every request gets a stable id
 * (from the incoming `x-request-id` header if present, otherwise generated)
 * that is propagated through the application, the PostgREST proxy and logs.
 *
 * The id is surfaced back to the client in the `x-request-id` response
 * header so a user can quote it in a bug report. It is also forwarded to
 * PostgREST as `x-request-id` so upstream logs share the correlation.
 */
import { randomBytes } from 'node:crypto'

export const REQUEST_ID_HEADER = 'x-request-id'
const ID_PATTERN = /^[a-z0-9-]{1,128}$/i

/** Reads or generates the request id for the incoming request. */
export function resolveRequestId(headers: Headers): string {
  const incoming = headers.get(REQUEST_ID_HEADER)
  if (incoming && ID_PATTERN.test(incoming)) {
    return incoming
  }
  // 16 random bytes as 32 hex chars — unique enough for correlation without
  // being a tracking surface.
  return randomBytes(16).toString('hex')
}

/** Copies the request id onto a response header for client correlation. */
export function stampRequestId(
  response: Response,
  requestId: string,
): Response {
  response.headers.set(REQUEST_ID_HEADER, requestId)
  return response
}
