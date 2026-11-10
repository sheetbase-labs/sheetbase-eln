/**
 * INT-03 — pure config + identifier validation for enterprise adapters.
 *
 * Kept free of server-only imports so it is unit-testable and importable
 * from anywhere. The server adapters re-export these helpers and use them
 * at runtime; the browser may use them for pre-flight UI feedback, but the
 * server always re-validates.
 */
import { z } from 'zod'

import type { PostgresConnectorConfig, S3ConnectorConfig } from './types'
import { ConnectorExecutionError } from './errors'
import {
  validateConnectorEndpointUrl,
  validateConnectorHost,
} from './host-policy.server'

export function parseS3Config(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Stored connector settings are untrusted and decoded immediately below.
  config: unknown,
): S3ConnectorConfig {
  const input = z
    .object({
      bucket: z.string().trim().catch(''),
      endpoint: z.string().trim().catch(''),
      prefix: z.string().trim().catch(''),
      region: z.string().optional().catch(undefined),
      forcePathStyle: z.coerce.boolean().default(false),
    })
    .parse(config)

  const { bucket, endpoint, prefix } = input

  if (!/^[a-z0-9][a-z0-9._-]{1,251}$/i.test(bucket)) {
    throw new ConnectorExecutionError(
      'invalid_destination',
      'Configure a valid bucket name on this connector.',
    )
  }

  if (endpoint) validateConnectorEndpointUrl(endpoint)

  return {
    endpoint: endpoint || undefined,
    region: input.region,
    bucket,
    prefix:
      prefix && !prefix.endsWith('/') ? `${prefix}/` : prefix || undefined,
    forcePathStyle: input.forcePathStyle,
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
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Stored connector settings are untrusted and decoded immediately below.
  config: unknown,
): PostgresConnectorConfig {
  const input = z
    .object({
      host: z.string().trim().catch(''),
      port: z.coerce.number().catch(NaN),
      database: z.string().trim().catch(''),
      sslMode: z.unknown().optional(),
      allowedSchemas: z
        .array(z.string().regex(PG_IDENTIFIER).catch(''))
        .optional()
        .catch(undefined),
      allowedTables: z
        .array(z.string().regex(PG_QUALIFIED).catch(''))
        .optional()
        .catch(undefined),
    })
    .parse(config)

  const { host, port, database } = input

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

  const sslMode = z
    .enum(['disable', 'prefer', 'require'])
    .safeParse(input.sslMode ?? 'disable')

  if (!sslMode.success) {
    throw new ConnectorExecutionError(
      'invalid_destination',
      'sslMode must be disable, prefer or require.',
    )
  }

  return {
    host,
    port,
    database,
    sslMode: sslMode.data,
    allowedSchemas: input.allowedSchemas?.filter(Boolean),
    allowedTables: input.allowedTables?.filter(Boolean),
  }
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
