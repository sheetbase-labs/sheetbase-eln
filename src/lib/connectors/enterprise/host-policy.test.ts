/**
 * INT-03 — connector destination host policy + adapter config validation.
 *
 * Connector destinations are untrusted configuration. These tests pin the
 * policy: valid http(s) endpoints pass, credential-bearing or non-http
 * URLs are refused, the optional allowlist is enforced, and the private-host
 * switch is explicit rather than silently permissive.
 */
import { afterEach, describe, expect, it } from 'vitest'

import {
  ConnectorEndpointError,
  validateConnectorEndpointUrl,
  validateConnectorHost,
} from './host-policy.server'
import {
  parsePostgresConfig,
  parseS3Config,
  quoteIdentifier,
} from './config-validation'
import { ConnectorExecutionError } from './errors'

function withEnv(
  values: Record<string, string | undefined>,
  run: () => void,
): void {
  const previous: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    run()
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

afterEach(() => {
  delete process.env['CONNECTOR_HOST_ALLOWLIST']
  delete process.env['CONNECTOR_ALLOW_PRIVATE_HOSTS']
})

describe('connector endpoint URL policy', () => {
  it('accepts http(s) endpoints', () => {
    expect(validateConnectorEndpointUrl('https://s3.example.com').hostname).toBe(
      's3.example.com',
    )
    expect(
      validateConnectorEndpointUrl('http://127.0.0.1:9000').hostname,
    ).toBe('127.0.0.1')
  })

  it('rejects non-http protocols, credentials and malformed URLs', () => {
    expect(() => validateConnectorEndpointUrl('file:///etc/passwd')).toThrow(
      ConnectorEndpointError,
    )
    expect(() =>
      validateConnectorEndpointUrl('https://key:secret@s3.example.com'),
    ).toThrow(/credentials/i)
    expect(() => validateConnectorEndpointUrl('not a url')).toThrow(
      ConnectorEndpointError,
    )
  })

  it('enforces the optional host allowlist', () => {
    withEnv({ CONNECTOR_HOST_ALLOWLIST: 's3.example.com,*.internal.test' }, () => {
      expect(
        validateConnectorEndpointUrl('https://s3.example.com').hostname,
      ).toBe('s3.example.com')
      expect(
        validateConnectorEndpointUrl('https://minio.internal.test').hostname,
      ).toBe('minio.internal.test')
      expect(() => validateConnectorEndpointUrl('https://s3.other.com')).toThrow(
        /allowlist/i,
      )
    })
  })

  it('can refuse private destinations explicitly', () => {
    withEnv({ CONNECTOR_ALLOW_PRIVATE_HOSTS: 'false' }, () => {
      expect(() => validateConnectorEndpointUrl('http://127.0.0.1:9000')).toThrow(
        /private/i,
      )
      expect(() => validateConnectorEndpointUrl('http://10.1.2.3')).toThrow(
        /private/i,
      )
    })
  })

  it('validates database hosts and ports', () => {
    validateConnectorHost('db.internal.test', 5432)
    validateConnectorHost('localhost', 5432)
    expect(() => validateConnectorHost('bad host', 5432)).toThrow(
      ConnectorEndpointError,
    )
    expect(() => validateConnectorHost('db.internal.test', 0)).toThrow(
      ConnectorEndpointError,
    )
    expect(() => validateConnectorHost('db.internal.test', 99999)).toThrow(
      ConnectorEndpointError,
    )
  })
})

describe('S3 connector config', () => {
  it('normalises prefixes to folder form and keeps endpoint settings', () => {
    const source = parseS3Config({
      adapter: 's3',
      endpoint: 'https://minio.internal.test',
      bucket: 'exports',
      prefix: 'data',
      forcePathStyle: true,
    })
    expect(source.bucket).toBe('exports')
    expect(source.prefix).toBe('data/')
    expect(source.endpoint).toBe('https://minio.internal.test')
    expect(source.forcePathStyle).toBe(true)
  })

  it('refuses invalid buckets and credential-bearing endpoints', () => {
    expect(() => parseS3Config({ bucket: '' })).toThrow(ConnectorExecutionError)
    expect(() => parseS3Config({ bucket: 'ok', endpoint: 'ftp://x' })).toThrow(
      ConnectorEndpointError,
    )
    expect(() =>
      parseS3Config({ bucket: 'ok', endpoint: 'https://u:p@h' }),
    ).toThrow(/credentials/i)
  })
})

describe('PostgreSQL connector config + identifiers', () => {
  it('accepts a valid non-secret config', () => {
    const source = parsePostgresConfig({
      adapter: 'postgres',
      host: 'db.internal.test',
      port: 5432,
      database: 'warehouse',
      sslMode: 'require',
      allowedSchemas: ['public'],
    })
    expect(source.host).toBe('db.internal.test')
    expect(source.sslMode).toBe('require')
  })

  it('refuses malformed hosts, ports and ssl modes', () => {
    expect(() => parsePostgresConfig({ host: '', port: 5432, database: 'd' })).toThrow()
    expect(() =>
      parsePostgresConfig({ host: 'db', port: 'x', database: 'd' }),
    ).toThrow()
    expect(() =>
      parsePostgresConfig({ host: 'db', port: 5432, database: 'd', sslMode: 'nope' }),
    ).toThrow()
  })

  it('never accepts a DSN or secret in the non-secret config', () => {
    // A connection-string style value in host is refused by the host policy.
    expect(() =>
      parsePostgresConfig({
        host: 'user:pass@db.internal.test',
        port: 5432,
        database: 'd',
      }),
    ).toThrow(ConnectorEndpointError)
  })

  it('quotes plain identifiers and refuses everything else', () => {
    expect(quoteIdentifier('public')).toBe('"public"')
    expect(quoteIdentifier('measurements_2026')).toBe('"measurements_2026"')
    expect(() => quoteIdentifier('bad name')).toThrow()
    expect(() => quoteIdentifier('x"; DROP TABLE users; --')).toThrow()
    expect(() => quoteIdentifier('schema.table')).toThrow()
  })
})
