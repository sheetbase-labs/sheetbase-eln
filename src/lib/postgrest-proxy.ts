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
import {
  buildUpstreamUrl,
  InvalidPostgrestQueryError,
  isValidScientificMutationQuery,
  parseProxyPath,
} from './postgrest-path'
import type { ProxyPath } from './postgrest-path'
import {
  REQUEST_ID_HEADER,
  resolveRequestId,
  stampRequestId,
} from './request-id'
import { ExternalTokenError, readBearerToken } from './external-token'

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
    clientId?: string | null
  }) => Promise<string>
  /**
   * Verifies an external bearer token, checks revocation at use time and
   * enforces scope. Returns the workspace id the token is scoped to. Throws
   * ExternalTokenError on any failure. Optional: only the /api/db route
   * wires it; tests may omit it.
   */
  resolveExternalToken?: (
    token: string,
    method: string,
    path: ProxyPath,
  ) => Promise<{ workspaceId: string }>
  upstreamBaseUrl: string
  fetchFn?: typeof fetch
}

function proxyErrorResponse(code: ProxyErrorCode, requestId: string): Response {
  const categorised = categoriseProxyError(code)
  return stampRequestId(errorEnvelope({ ...categorised, requestId }), requestId)
}

/**
 * Maps an external-token verification failure to the public envelope.
 * All three codes surface as a 401/403 with a stable category; the message
 * is non-sensitive and never echoes the token.
 */
function externalTokenErrorResponse(
  error: unknown,
  requestId: string,
): Response {
  if (error instanceof ExternalTokenError) {
    const status =
      error.code === 'insufficient_scope' || error.code === 'revoked'
        ? 403
        : 401
    return stampRequestId(
      errorEnvelope({
        category:
          error.code === 'insufficient_scope'
            ? 'permission_denied'
            : error.code === 'revoked'
              ? 'permission_denied'
              : 'unauthenticated',
        status,
        message: error.message,
        requestId,
      }),
      requestId,
    )
  }
  return proxyErrorResponse('unauthenticated', requestId)
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

  const requestUrl = new URL(request.url)
  const generatedMutation =
    path.kind === 'table' &&
    /^sheet_[a-z2-7]{26}$/.test(path.resource) &&
    (request.method === 'PATCH' || request.method === 'DELETE')
  if (generatedMutation && !isValidScientificMutationQuery(requestUrl.search)) {
    return proxyErrorResponse('invalid_path', requestId)
  }

  // Two auth paths share this boundary:
  //   1. External bearer token (Authorization: Bearer <api_client jwt>) —
  //      verified, revocation-checked and scope-enforced by the resolver.
  //   2. Browser session — Better Auth cookies exchanged for an
  //      authenticated PostgREST JWT (AUTH-003).
  // An external token wins when present; otherwise the browser path runs.
  const authorization = request.headers.get('authorization')
  const bearer = readBearerToken(request.headers)
  let token: string
  if (authorization !== null) {
    if (!bearer || !deps.resolveExternalToken) {
      return proxyErrorResponse('unauthenticated', requestId)
    }
    try {
      await deps.resolveExternalToken(bearer, request.method, path)
      token = bearer
    } catch (error) {
      return externalTokenErrorResponse(error, requestId)
    }
  } else {
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
    token = await deps.mintToken({
      userId: session.user.id,
      workspaceId: workspace.id,
      sessionId: session.session.id,
      // LIVE-003: forward the tab-scoped client id so the JWT carries it
      // and the durable change-event trigger records the actor's tab.
      clientId: request.headers.get('x-sheetbase-client-id') ?? null,
    })
  }

  let upstream: string
  try {
    upstream = buildUpstreamUrl(deps.upstreamBaseUrl, path, requestUrl.search)
  } catch (error) {
    if (error instanceof InvalidPostgrestQueryError) {
      return proxyErrorResponse('invalid_path', requestId)
    }
    throw error
  }

  const headers = new Headers()
  headers.set('authorization', `Bearer ${token}`)
  headers.set('accept', 'application/json')
  headers.set(REQUEST_ID_HEADER, requestId)
  const contentType = request.headers.get('content-type')
  if (contentType) headers.set('content-type', contentType)
  const prefer = request.headers.get('prefer')
  if (generatedMutation) {
    headers.set(
      'prefer',
      'handling=strict,max-affected=1,return=representation',
    )
  } else if (prefer) headers.set('prefer', prefer)
  const range = request.headers.get('range')
  if (range) headers.set('range', range)
  const rangeUnit = request.headers.get('range-unit')
  if (rangeUnit) headers.set('range-unit', rangeUnit)

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
    if (
      response.ok &&
      path.kind === 'rpc' &&
      SCHEMA_READINESS_RPCS.has(path.resource) &&
      !(await waitForScientificSchema(
        response,
        deps.upstreamBaseUrl,
        headers,
        fetchFn,
      ))
    ) {
      return stampRequestId(
        errorEnvelope({
          category: 'service_unavailable',
          status: 503,
          message:
            'The schema change committed, but its REST resource is not ready yet. Retry shortly.',
          requestId,
        }),
        requestId,
      )
    }
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
    generatedMutation,
    requestId,
    startedAt,
  )
  return stampRequestId(finalResponse, requestId)
}

const SCHEMA_READINESS_RPCS = new Set<string>()

/**
 * DDL commits before PostgREST receives the transaction's schema-reload
 * notification. Poll its OpenAPI cache for the generated resource/field so a
 * successful management response means the published REST shape is usable.
 */
async function waitForScientificSchema(
  managementResponse: Response,
  upstreamBaseUrl: string,
  requestHeaders: Headers,
  fetchFn: typeof fetch,
): Promise<boolean> {
  let result: unknown
  try {
    result = await managementResponse.clone().json()
  } catch {
    return false
  }
  if (Array.isArray(result) && result.length === 1) result = result[0]
  if (!result || typeof result !== 'object') return false
  const value = result as Record<string, unknown>
  const resource = value.resourceName
  const field = value.fieldName
  if (
    typeof resource !== 'string' ||
    !/^sheet_[a-z2-7]{26}$/.test(resource) ||
    (field !== undefined &&
      (typeof field !== 'string' || !/^col_[a-z2-7]{26}$/.test(field)))
  ) {
    return false
  }

  const headers = new Headers(requestHeaders)
  headers.set('accept', 'application/openapi+json')
  headers.delete('content-type')
  headers.delete('prefer')
  for (const delay of [0, 20, 40, 80, 160, 320]) {
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
    try {
      const response = await fetchFn(`${upstreamBaseUrl}/`, {
        method: 'GET',
        headers,
      })
      if (!response.ok) continue
      const document = (await response.json()) as {
        definitions?: Record<string, { properties?: Record<string, unknown> }>
      }
      const definition = document.definitions?.[resource]
      if (definition && (!field || definition.properties?.[field])) return true
    } catch {
      // Keep polling within the bound; the committed DDL is not rolled back.
    }
  }
  return false
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
  generatedMutation: boolean,
  requestId: string,
  startedAt: number,
): Promise<Response> {
  const durationMs = Date.now() - startedAt

  if (response.status < 400) {
    let successfulBody: BodyInit | null = response.body
    if (generatedMutation) {
      const text = await response.text()
      let rows: unknown
      try {
        rows = JSON.parse(text)
      } catch {
        rows = null
      }
      if (Array.isArray(rows) && rows.length === 0) {
        return errorEnvelope({
          category: 'stale_version',
          status: 409,
          message: 'The scientific row changed or no longer exists.',
          requestId,
        })
      }
      successfulBody = text
    }
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
    for (const name of ['content-range', 'range-unit', 'preference-applied']) {
      const value = response.headers.get(name)
      if (value) passthroughHeaders.set(name, value)
    }
    return new Response(successfulBody, {
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
