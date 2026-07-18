/**
 * Path and query validation for the PostgREST proxy. The upstream URL is
 * constructed server-side from validated pieces; clients can never aim the
 * proxy at a different origin, schema or path.
 */

const RESOURCE_SEGMENT = /^[a-z][a-z0-9_]*$/
const QUERY_KEY = /^[a-zA-Z_][a-zA-Z0-9_.]*$/
const MAX_QUERY_VALUE_LENGTH = 500

export type ProxyPath =
  | { kind: 'table'; resource: string }
  | { kind: 'rpc'; resource: string }

/**
 * Accepts "projects" or "rpc/create_project". Anything else — dots, schema
 * prefixes, traversal, uppercase, extra segments — is rejected.
 */
export function parseProxyPath(raw: string): ProxyPath | null {
  const segments = raw.split('/')
  if (segments.length === 1 && RESOURCE_SEGMENT.test(segments[0]!)) {
    return { kind: 'table', resource: segments[0]! }
  }
  if (
    segments.length === 2 &&
    segments[0] === 'rpc' &&
    RESOURCE_SEGMENT.test(segments[1]!)
  ) {
    return { kind: 'rpc', resource: segments[1]! }
  }
  return null
}

/**
 * Filters the incoming query string to safe PostgREST parameters: simple
 * identifier keys and bounded values. Anything else is dropped silently —
 * a dropped filter fails the request closed, never open.
 */
export function sanitizeQuery(search: string): string {
  const incoming = new URLSearchParams(search)
  const safe = new URLSearchParams()
  for (const [key, value] of incoming) {
    if (QUERY_KEY.test(key) && value.length <= MAX_QUERY_VALUE_LENGTH) {
      safe.append(key, value)
    }
  }
  const out = safe.toString()
  return out ? `?${out}` : ''
}

/** Builds the upstream URL from validated pieces only. */
export function buildUpstreamUrl(
  baseUrl: string,
  path: ProxyPath,
  search: string,
): string {
  const suffix =
    path.kind === 'rpc' ? `/rpc/${path.resource}` : `/${path.resource}`
  return `${baseUrl}${suffix}${sanitizeQuery(search)}`
}
