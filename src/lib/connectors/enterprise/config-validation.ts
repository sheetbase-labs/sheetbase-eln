/**
 * INT-03 — pure config + identifier validation for enterprise adapters.
 *
 * Kept free of server-only imports so it is unit-testable and importable
 * from anywhere. The server adapters re-export these helpers and use them
 * at runtime; the browser may use them for pre-flight UI feedback, but the
 * server always re-validates.
 */
import type { PostgresConnectorConfig, S3ConnectorConfig } from './types'
import { ConnectorExecutionError } from './errors'
import {
  validateConnectorEndpointUrl,
  validateConnectorHost,
} from './host-policy.server'

export function parseS3Config(
  config: Record<string, unknown>,
): S3ConnectorConfig {
  const bucket =
    typeof config['bucket'] === 'string' ? config['bucket'].trim() : ''
  if (!/^[a-z0-9][a-z0-9._-]{1,251}$/i.test(bucket)) {
    throw new ConnectorExecutionError(
      'invalid_destination',
      'Configure a valid bucket name on this connector.',
    )
  }
  const endpoint =
    typeof config['endpoint'] === 'string' ? config['endpoint'].trim() : ''
  if (endpoint) validateConnectorEndpointUrl(endpoint)
  const prefix =
    typeof config['prefix'] === 'string' ? config['prefix'].trim() : ''
  if (prefix && !prefix.endsWith('/')) {
    // Normalise: discovery and imports treat the prefix as a folder.
    return {
      endpoint: endpoint || undefined,
      region:
        typeof config['region'] === 'string' ? config['region'] : undefined,
      bucket,
      prefix: `${prefix}/`,
      forcePathStyle: Boolean(config['forcePathStyle']),
    }
  }
  return {
    endpoint: endpoint || undefined,
    region: typeof config['region'] === 'string' ? config['region'] : undefined,
    bucket,
    prefix: prefix || undefined,
    forcePathStyle: Boolean(config['forcePathStyle']),
  }
}

const PG_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_$]*$/
const PG_QUALIFIED = /^[a-zA-Z_][a-zA-Z0-9_$]*\.[a-zA-Z_][a-zA-Z0-9_$]*$/

export const POSTGRES_SYSTEM_SCHEMAS = new Set([
  'information_schema',
  'pg_catalog',
  'pg_toast',
])

export function parsePostgresConfig(
  config: Record<string, unknown>,
): PostgresConnectorConfig {
  const host = typeof config['host'] === 'string' ? config['host'].trim() : ''
  const port = Number(config['port'])
  const database =
    typeof config['database'] === 'string' ? config['database'].trim() : ''
  const sslMode = config['sslMode'] ?? 'disable'
  if (!host) {
    throw new ConnectorExecutionError(
      'invalid_destination',
      'Configure the source host on this connector.',
    )
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConnectorExecutionError(
      'invalid_destination',
      'Configure a valid source port.',
    )
  }
  validateConnectorHost(host, port)
  if (!database) {
    throw new ConnectorExecutionError(
      'invalid_destination',
      'Configure the source database.',
    )
  }
  if (sslMode !== 'disable' && sslMode !== 'prefer' && sslMode !== 'require') {
    throw new ConnectorExecutionError(
      'invalid_destination',
      'sslMode must be disable, prefer or require.',
    )
  }
  const allowedSchemas = Array.isArray(config['allowedSchemas'])
    ? (config['allowedSchemas'] as unknown[]).filter(
        (entry): entry is string =>
          typeof entry === 'string' && PG_IDENTIFIER.test(entry),
      )
    : undefined
  const allowedTables = Array.isArray(config['allowedTables'])
    ? (config['allowedTables'] as unknown[]).filter(
        (entry): entry is string =>
          typeof entry === 'string' && PG_QUALIFIED.test(entry),
      )
    : undefined
  return { host, port, database, sslMode, allowedSchemas, allowedTables }
}

/** Quote a validated identifier; non-conforming names are refused outright. */
export function quoteIdentifier(identifier: string): string {
  if (!PG_IDENTIFIER.test(identifier)) {
    throw new ConnectorExecutionError(
      'query_failed',
      'Source identifiers must be plain PostgreSQL identifiers (no quotes or whitespace).',
    )
  }
  return `"${identifier}"`
}
