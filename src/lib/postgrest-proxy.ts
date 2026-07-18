/**
 * The same-origin PostgREST proxy. Browser CRUD goes to /api/db/*; this
 * module verifies the application session, mints a short-lived PostgREST
 * JWT and forwards the request upstream. The Better Auth session never
 * leaves the application boundary.
 *
 * API-006: every request carries a correlation id (from x-request-id or
 * generated) that is forwarded to PostgREST, stamped on the response and
 * included in structured logs and the public error envelope. Upstream
 * PostgREST errors are re-wrapped into stable public categories so clients
 * branch on category, not on PostgREST-internal codes.
 */
import {
  categorisePostgrestError,
  categoriseProxyError,
  errorEnvelope,
} from './errors'
import type { ProxyErrorCode } from './errors'
import { logger } from './logger'
import { buildUpstreamUrl, parseProxyPath } from './postgrest-path'
import type { ProxyPath } from './postgrest-path'
import {
  REQUEST_ID_HEADER,
  resolveRequestId,
  stampRequestId,
} from './request-id'

export interface ProxyDeps {
  getSession: (headers: Headers) => Promise<{
    user: { id: string }
    session: { id: string }
  } | null>
  getWorkspaceForUser: (userId: string) => Promise<{ id: string } | null>
  mintToken: (input: {
    userId: string
    workspaceId: string
    sessionId: string
  }) => Promise<string>
  upstreamBaseUrl: string
  fetchFn?: typeof fetch
}

function proxyErrorResponse(code: ProxyErrorCode, requestId: string): Response {
  const categorised = categoriseProxyError(code)
  return stampRequestId(errorEnvelope({ ...categorised, requestId }), requestId)
}

export async function handleProxyRequest(
  request: Request,
  rawPath: string,
  deps: ProxyDeps,
): Promise<Response> {
  const requestId = resolveRequestId(request.headers)
  const path = parseProxyPath(rawPath)
  if (!path) {
    return proxyErrorResponse('invalid_path', requestId)
  }

  const session = await deps.getSession(request.headers)
  if (!session) {
    return proxyErrorResponse('unauthenticated', requestId)
  }

  const workspace = await deps.getWorkspaceForUser(session.user.id)
  if (!workspace) {
    return proxyErrorResponse('no_workspace', requestId)
  }

  const requestedWorkspace = request.headers.get('x-sheetbase-workspace')
  if (requestedWorkspace && requestedWorkspace !== workspace.id) {
    return proxyErrorResponse('workspace_mismatch', requestId)
  }

  const token = await deps.mintToken({
    userId: session.user.id,
    workspaceId: workspace.id,
    sessionId: session.session.id,
  })

  const url = new URL(request.url)
  const upstream = buildUpstreamUrl(deps.upstreamBaseUrl, path, url.search)

  const headers = new Headers()
  headers.set('authorization', `Bearer ${token}`)
  headers.set('accept', 'application/json')
  headers.set(REQUEST_ID_HEADER, requestId)
  const contentType = request.headers.get('content-type')
  if (contentType) headers.set('content-type', contentType)
  const prefer = request.headers.get('prefer')
  if (prefer) headers.set('prefer', prefer)

  const startedAt = Date.now()
  let response: Response
  try {
    const fetchFn = deps.fetchFn ?? fetch
    response = await fetchFn(upstream, {
      method: request.method,
      headers,
      body:
        request.method === 'GET' || request.method === 'HEAD'
          ? undefined
          : await request.text(),
    })
  } catch (error) {
    logger.error('postgrest proxy upstream fetch failed', {
      request_id: requestId,
      method: request.method,
      resource: safePathLog(path),
      error: error instanceof Error ? error.message : 'unknown',
      duration_ms: Date.now() - startedAt,
    })
    return proxyErrorResponse('upstream_unavailable', requestId)
  }

  const finalResponse = await normaliseUpstreamResponse(
    response,
    path,
    request.method,
    requestId,
    startedAt,
  )
  return stampRequestId(finalResponse, requestId)
}

/**
 * Successful upstream responses pass through unchanged (PostgREST JSON is
 * designed for clients and contains no secrets). Upstream error bodies are
 * re-wrapped into the stable public envelope so clients branch on `category`
 * rather than PostgREST-internal codes. The upstream message is preserved
 * when present; `details`/`hint` are dropped because they can leak schema
 * internals.
 */
async function normaliseUpstreamResponse(
  response: Response,
  path: ProxyPath,
  method: string,
  requestId: string,
  startedAt: number,
): Promise<Response> {
  const durationMs = Date.now() - startedAt

  if (response.status < 400) {
    logger.info('postgrest proxy request complete', {
      request_id: requestId,
      method,
      resource: safePathLog(path),
      status: response.status,
      duration_ms: durationMs,
    })
    const passthroughHeaders = new Headers()
    const upstreamContentType = response.headers.get('content-type')
    if (upstreamContentType) {
      passthroughHeaders.set('content-type', upstreamContentType)
    }
    return new Response(response.body, {
      status: response.status,
      headers: passthroughHeaders,
    })
  }

  // Upstream error: read the body once, categorise, re-wrap.
  let body: { code?: string; message?: string } | null = null
  let rawBody: string | null
  try {
    rawBody = await response.text()
    body = rawBody
      ? (JSON.parse(rawBody) as { code?: string; message?: string })
      : null
  } catch {
    body = null
  }

  const categorised = categorisePostgrestError(response.status, body)

  // Expected client errors (4xx) are warn; unexpected upstream 5xx is error.
  // Either way the public envelope hides PostgREST-internal detail.
  const logLevel = categorised.status < 500 ? 'warn' : 'error'
  logger[logLevel]('postgrest proxy upstream error', {
    request_id: requestId,
    method,
    resource: safePathLog(path),
    upstream_status: response.status,
    category: categorised.category,
    duration_ms: durationMs,
  })

  return errorEnvelope({ ...categorised, requestId })
}

/**
 * Returns a safe resource label for logs. Never includes query string,
 * body, identifiers or row filters — only the validated resource name and
 * whether it was an RPC.
 */
function safePathLog(path: ProxyPath): string {
  return path.kind === 'rpc' ? `rpc/${path.resource}` : path.resource
}
