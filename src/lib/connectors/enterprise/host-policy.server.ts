/**
 * INT-03 — connector destination host policy.
 *
 * Connector destinations are untrusted configuration, so every server-side
 * connection target is validated here before any socket is opened:
 *
 *  - malformed URLs/hosts are rejected;
 *  - only http(s) is allowed for endpoint URLs — `file://`, `unix:`, etc.
 *    are never valid connector transports;
 *  - credential-bearing URLs (userinfo) are rejected — credentials belong in
 *    sealed connector secrets, not in connection strings;
 *  - SSH-style scp syntax is not a URL and fails parsing.
 *
 * Sheetbase legitimately integrates with private/on-prem networks, so private
 * address ranges are allowed by default. The policy is explicit and
 * configurable rather than silently permissive:
 *
 *  - `CONNECTOR_HOST_ALLOWLIST` — optional comma-separated hostnames or
 *    `*.example.com` wildcards. When set, connector destinations must match
 *    (an empty allowlist would block everything, so unset = no allowlist).
 *  - `CONNECTOR_ALLOW_PRIVATE_HOSTS` — defaults to `true`; set to `false` to
 *    refuse loopback/private/link-local destinations on deployments that have
 *    a separate network-layer control (documented — this is policy only and
 *    must not be presented as network isolation).
 */
const PRIVATE_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1'])

function isPrivateIp(host: string): boolean {
  if (host.startsWith('[') && host.endsWith(']')) {
    const bracketed = host.slice(1, -1)
    return (
      bracketed === '::1' ||
      bracketed.toLowerCase().startsWith('fe80:') ||
      bracketed.toLowerCase().startsWith('fc') ||
      bracketed.toLowerCase().startsWith('fd')
    )
  }
  const parts = host.split('.')
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) {
    return false
  }
  const [a, b] = parts.map(Number)
  if (a === 10 || a === 127) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 169 && b === 254) return true
  return false
}

function allowPrivateHosts(): boolean {
  return process.env['CONNECTOR_ALLOW_PRIVATE_HOSTS'] !== 'false'
}

function allowlist(): string[] {
  return (process.env['CONNECTOR_HOST_ALLOWLIST'] ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
}

function hostAllowedByAllowlist(host: string): boolean {
  const entries = allowlist()
  if (entries.length === 0) return true
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, '')
  return entries.some((entry) => {
    if (entry.startsWith('*.')) {
      const suffix = entry.slice(1)
      return normalized.endsWith(suffix)
    }
    return normalized === entry
  })
}

export class ConnectorEndpointError extends Error {
  readonly code = 'invalid_destination'
  constructor(message: string) {
    super(message)
    this.name = 'ConnectorEndpointError'
  }
}

function checkHost(host: string, what: string): void {
  if (!host || host.includes('/') || host.includes('\\')) {
    throw new ConnectorEndpointError(`${what} is malformed.`)
  }
  if (!hostAllowedByAllowlist(host)) {
    throw new ConnectorEndpointError(
      `${what} is not on this deployment's connector host allowlist.`,
    )
  }
  if (!allowPrivateHosts() && (PRIVATE_HOSTNAMES.has(host) || isPrivateIp(host))) {
    throw new ConnectorEndpointError(
      `${what} is a private address and this deployment refuses private connector destinations.`,
    )
  }
}

/**
 * Validate an HTTP(S) endpoint URL used by an object-storage connector.
 * Returns the parsed URL only when every policy check passes.
 */
export function validateConnectorEndpointUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new ConnectorEndpointError('The endpoint URL is malformed.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ConnectorEndpointError(
      'Only http(s) endpoint URLs are supported for connectors.',
    )
  }
  if (url.username || url.password) {
    throw new ConnectorEndpointError(
      'Endpoint URLs must not embed credentials; store them as connector secrets.',
    )
  }
  if (!url.hostname) {
    throw new ConnectorEndpointError('The endpoint URL has no host.')
  }
  checkHost(url.hostname, 'The endpoint host')
  return url
}

/**
 * Validate a bare host (plus optional port) used by database connectors —
 * there is no URL to parse, so the checks are explicit.
 */
export function validateConnectorHost(host: string, port: number): void {
  if (!/^[._a-zA-Z0-9-]+(\.[._a-zA-Z0-9-]+)*$/.test(host) && !host.startsWith('[')) {
    throw new ConnectorEndpointError('The database host is malformed.')
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConnectorEndpointError('The database port is malformed.')
  }
  checkHost(host.replace(/^\[|\]$/g, ''), 'The database host')
}
