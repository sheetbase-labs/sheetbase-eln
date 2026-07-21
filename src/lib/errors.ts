/**
 * API-006: stable public error categories. Database validation, permission,
 * conflict and unavailable-service failures are mapped to a small set of
 * categories so clients can branch on category, not on string messages or
 * PostgREST-internal codes.
 *
 * The proxy (AUTH-003) already returns `{ error: { code, message } }` for
 * its own failures; this module categorises the PostgREST responses it
 * passes through, and the application's own server functions.
 */
export type ErrorCategory =
  | 'validation_error' // 400 — bad input, constraint check
  | 'not_found' // 404
  | 'permission_denied' // 403 — RLS or scope
  | 'conflict' // 409 — unique violation, stale version
  | 'stale_version' // 409 — optimistic-concurrency mismatch
  | 'missing_link' // 422 — record_link target unresolved in workspace
  | 'invalid_transition' // 422 — disallowed lifecycle status transition (SCI-001)
  | 'invalid_properties' // 422 — configurable property failed DB validation (SCI-001)
  | 'unauthenticated' // 401
  | 'rate_limited' // 429
  | 'service_unavailable' // 502/503 — upstream down
  | 'server_error' // 500 — unclassified

interface CategorisedError {
  category: ErrorCategory
  status: number
  message: string
}

const PG_CODE_TO_CATEGORY: Record<string, ErrorCategory> = {
  '23505': 'conflict', // unique_violation
  '23503': 'validation_error', // foreign_key_violation
  '23502': 'validation_error', // not_null_violation
  '23514': 'validation_error', // check_violation
  '42501': 'permission_denied', // insufficient_privilege
  '42804': 'validation_error', // datatype_mismatch (used by create_project)
  '42P01': 'service_unavailable', // undefined_table — schema not loaded
  '40001': 'conflict', // serialization_failure
  '40P01': 'conflict', // deadlock_detected
  // Sheetbase-specific SQLSTATE codes (class SB) raised by notebook RPCs
  // (ELN-003) so clients can branch on the exact failure without parsing
  // messages. See docs/notebook-api.md.
  SB001: 'stale_version', // expected_version did not match
  SB002: 'missing_link', // record_link target unresolved in workspace
  SB003: 'validation_error', // invalid block payload shape
  SB004: 'invalid_transition', // disallowed lifecycle status transition (SCI-001)
  SB005: 'invalid_properties', // configurable property failed DB validation (SCI-001)
}

/** Maps a PostgREST error body to a stable category. */
export function categorisePostgrestError(
  status: number,
  body: { code?: string; message?: string } | null,
): CategorisedError {
  const code = body?.code
  const category =
    code != null && code !== '' && Object.hasOwn(PG_CODE_TO_CATEGORY, code)
      ? PG_CODE_TO_CATEGORY[code]
      : inferFromStatus(status)
  return {
    category,
    status:
      category === 'stale_version'
        ? 409
        : category === 'missing_link' ||
            category === 'invalid_transition' ||
            category === 'invalid_properties'
          ? 422
          : status,
    message: body?.message ?? 'Request failed.',
  }
}

function inferFromStatus(status: number): ErrorCategory {
  if (status === 401) return 'unauthenticated'
  if (status === 403) return 'permission_denied'
  if (status === 404) return 'not_found'
  if (status === 409) return 'conflict'
  if (status === 422) return 'missing_link'
  if (status === 429) return 'rate_limited'
  if (status === 400) return 'validation_error'
  if (status >= 500) return 'service_unavailable'
  return 'server_error'
}

/** Builds a consistent public error envelope from a categorised error. */
export function errorEnvelope({
  category,
  status,
  message,
  requestId,
}: CategorisedError & { requestId?: string }): Response {
  return Response.json(
    {
      error: {
        category,
        message,
        ...(requestId ? { request_id: requestId } : {}),
      },
    },
    { status },
  )
}

/**
 * Proxy-side error codes (unauthenticated, no_workspace, etc.) mapped to the
 * stable public categories. The proxy converts its own failures to this shape
 * before responding, so clients branch on `category` rather than per-route
 * strings.
 */
export type ProxyErrorCode =
  | 'unauthenticated'
  | 'no_workspace'
  | 'workspace_mismatch'
  | 'invalid_path'
  | 'upstream_unavailable'

const PROXY_ERROR_CATEGORY: Record<ProxyErrorCode, ErrorCategory> = {
  unauthenticated: 'unauthenticated',
  no_workspace: 'permission_denied',
  workspace_mismatch: 'permission_denied',
  invalid_path: 'validation_error',
  upstream_unavailable: 'service_unavailable',
}

const PROXY_ERROR_STATUS: Record<ProxyErrorCode, number> = {
  unauthenticated: 401,
  no_workspace: 403,
  workspace_mismatch: 403,
  invalid_path: 400,
  upstream_unavailable: 502,
}

const PROXY_ERROR_MESSAGE: Record<ProxyErrorCode, string> = {
  unauthenticated: 'Sign in to use the data API.',
  no_workspace:
    'Your account has no workspace yet. Finish workspace setup first.',
  workspace_mismatch:
    'The request workspace does not match your active workspace.',
  invalid_path: 'That resource path is not allowed.',
  upstream_unavailable: 'The data service is unavailable. Try again shortly.',
}

/** Categorises a proxy-side error code into the public envelope shape. */
export function categoriseProxyError(code: ProxyErrorCode): CategorisedError {
  return {
    category: PROXY_ERROR_CATEGORY[code],
    status: PROXY_ERROR_STATUS[code],
    message: PROXY_ERROR_MESSAGE[code],
  }
}
