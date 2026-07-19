/**
 * Path and query validation for the PostgREST proxy. The upstream URL is
 * constructed server-side from validated pieces; clients can never aim the
 * proxy at a different origin, schema or path.
 */

const RESOURCE_SEGMENT = /^[a-z][a-z0-9_]*$/
const QUERY_KEY = /^[a-zA-Z_][a-zA-Z0-9_.]*$/
const MAX_QUERY_VALUE_LENGTH = 500

export type ProxyPath =
  { kind: 'table'; resource: string } | { kind: 'rpc'; resource: string }

/**
 * Accepts "projects" or "rpc/create_project". Anything else — dots, schema
 * prefixes, traversal, uppercase, extra segments — is rejected.
 */
export function parseProxyPath(raw: string): ProxyPath | null {
  const segments = raw.split('/')
  if (segments.length === 1 && RESOURCE_SEGMENT.test(segments[0])) {
    return { kind: 'table', resource: segments[0] }
  }
  if (
    segments.length === 2 &&
    segments[0] === 'rpc' &&
    RESOURCE_SEGMENT.test(segments[1])
  ) {
    return { kind: 'rpc', resource: segments[1] }
  }
  return null
}

/**
 * Accepts safe PostgREST parameters: simple identifier keys and bounded
 * values. The whole request is rejected when any parameter is unsafe; silently
 * dropping a mutation filter would turn a narrow write into a broad one.
 */
export function sanitizeQuery(search: string): string {
  const incoming = new URLSearchParams(search)
  const safe = new URLSearchParams()
  for (const [key, value] of incoming) {
    if (!QUERY_KEY.test(key) || value.length > MAX_QUERY_VALUE_LENGTH) {
      throw new InvalidPostgrestQueryError()
    }
    safe.append(key, value)
  }
  const out = safe.toString()
  return out ? `?${out}` : ''
}

export class InvalidPostgrestQueryError extends Error {
  constructor() {
    super('Invalid PostgREST query parameter.')
    this.name = 'InvalidPostgrestQueryError'
  }
}

const UUID_FILTER =
  /^eq\.[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const VERSION_FILTER = /^eq\.[1-9][0-9]*$/

/** DATA-003 row mutations require one stable identity and expected version. */
export function isValidScientificMutationQuery(search: string): boolean {
  const query = new URLSearchParams(search)
  const ids = query.getAll('id')
  const versions = query.getAll('version')
  return (
    [...query.keys()].every((key) => key === 'id' || key === 'version') &&
    ids.length === 1 &&
    versions.length === 1 &&
    UUID_FILTER.test(ids[0]) &&
    VERSION_FILTER.test(versions[0])
  )
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
