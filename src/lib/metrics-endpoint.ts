/**
 * PLAT-02 — metrics endpoint handler. Serves the Prometheus text exposition
 * of the process registry.
 *
 * Deployment access model: the endpoint is never public. In staging and
 * production it requires a bearer token (`SHEETBASE_METRICS_TOKEN`, injected
 * by the secret manager) and the deployment binds the app to loopback, so
 * scraping happens over the private network/Tailscale. When no token is
 * configured in a deployed environment the endpoint answers 404 (fail closed,
 * without revealing that the surface exists). Development without a token
 * allows local scraping for convenience.
 */
import { metrics } from './metrics'
import { resolveRequestId, stampRequestId } from './request-id'
import { stampSecurityHeaders } from './security-headers'

export interface MetricsEndpointDeps {
  /** Bearer token required in deployed environments; undefined otherwise. */
  token?: string
  environment: 'development' | 'test' | 'staging' | 'production'
}

function metricsResponse(
  request: Request,
  status: number,
  body: string,
): Response {
  const requestId = resolveRequestId(request.headers)
  return stampSecurityHeaders(
    stampRequestId(
      new Response(body, {
        status,
        headers:
          status === 200
            ? { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' }
            : undefined,
      }),
      requestId,
    ),
  )
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization')
  if (!header?.startsWith('Bearer ')) return null
  return header.slice('Bearer '.length)
}

export async function handleMetricsRequest(
  request: Request,
  deps: MetricsEndpointDeps,
): Promise<Response> {
  const deployed =
    deps.environment === 'staging' || deps.environment === 'production'
  if (deployed && !deps.token) {
    // Fail closed: no token configured means no metrics surface.
    return metricsResponse(request, 404, 'not found\n')
  }
  if (deps.token) {
    const provided = bearerToken(request)
    if (
      provided === null ||
      provided.length !== deps.token.length ||
      !timingSafeEqual(provided, deps.token)
    ) {
      return metricsResponse(request, 401, 'unauthenticated\n')
    }
  }
  return metricsResponse(request, 200, metrics.render())
}

/** Constant-time string comparison to avoid a token oracle. */
function timingSafeEqual(provided: string, expected: string): boolean {
  let mismatch = 0
  for (let i = 0; i < expected.length; i += 1) {
    mismatch |= provided.charCodeAt(i) ^ expected.charCodeAt(i)
  }
  return mismatch === 0
}
