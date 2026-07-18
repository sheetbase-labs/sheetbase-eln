/**
 * The same-origin PostgREST proxy. Browser CRUD goes to /api/db/*; this
 * module verifies the application session, mints a short-lived PostgREST
 * JWT and forwards the request upstream. The Better Auth session never
 * leaves the application boundary.
 */
import { buildUpstreamUrl, parseProxyPath } from './postgrest-path'

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

export type ProxyErrorCode =
  | 'unauthenticated'
  | 'no_workspace'
  | 'workspace_mismatch'
  | 'invalid_path'
  | 'upstream_unavailable'

const STATUS_BY_CODE: Record<ProxyErrorCode, number> = {
  unauthenticated: 401,
  no_workspace: 403,
  workspace_mismatch: 403,
  invalid_path: 400,
  upstream_unavailable: 502,
}

function errorResponse(code: ProxyErrorCode, message: string): Response {
  return Response.json(
    { error: { code, message } },
    { status: STATUS_BY_CODE[code] },
  )
}

export async function handleProxyRequest(
  request: Request,
  rawPath: string,
  deps: ProxyDeps,
): Promise<Response> {
  const path = parseProxyPath(rawPath)
  if (!path) {
    return errorResponse('invalid_path', 'That resource path is not allowed.')
  }

  const session = await deps.getSession(request.headers)
  if (!session) {
    return errorResponse('unauthenticated', 'Sign in to use the data API.')
  }

  const workspace = await deps.getWorkspaceForUser(session.user.id)
  if (!workspace) {
    return errorResponse(
      'no_workspace',
      'Your account has no workspace yet. Finish workspace setup first.',
    )
  }

  const requestedWorkspace = request.headers.get('x-sheetbase-workspace')
  if (requestedWorkspace && requestedWorkspace !== workspace.id) {
    return errorResponse(
      'workspace_mismatch',
      'The request workspace does not match your active workspace.',
    )
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
  const contentType = request.headers.get('content-type')
  if (contentType) headers.set('content-type', contentType)
  const prefer = request.headers.get('prefer')
  if (prefer) headers.set('prefer', prefer)

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
  } catch {
    return errorResponse(
      'upstream_unavailable',
      'The data service is unavailable. Try again shortly.',
    )
  }

  // PostgREST responses — including its JSON error bodies — pass through
  // unchanged; they are designed for clients and contain no secrets.
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
