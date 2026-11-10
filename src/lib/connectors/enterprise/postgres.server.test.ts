// @vitest-environment node
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { z } from 'zod'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createDataClient } from '#/lib/data-client'
import { postgresAdapter, assertSourceAllowed } from './postgres.server'
import type { ConnectorAdapterContext } from './adapter'
import type { PostgresConnectorConfig } from './types'

const execute = promisify(execFile)
const container = `sheetbase-connector-test-${randomUUID()}`
let port = 0
let created = false

const source: PostgresConnectorConfig = {
  host: '127.0.0.1',
  port: 0,
  database: 'postgres',
  sslMode: 'disable',
  allowedSchemas: ['public'],
}

function context(
  fetchImpl: typeof fetch = async () => {
    throw new Error('Unexpected application HTTP request.')
  },
): ConnectorAdapterContext {
  return {
    client: createDataClient(fetchImpl),
    workspaceId: 'ws',
    token: '',
    connector: {
      id: 'connector',
      workspace_id: 'ws',
      key: 'pg',
      name: 'Postgres fixture',
      connector_type: 'database',
      direction: 'inbound',
      status: 'active',
      parser_id: null,
      config: {},
      created_at: '',
      updated_at: '',
    },
    limits: { previewRows: 1, importRows: 1, maxObjectBytes: 1024 },
    secrets: { username: 'reader', password: 'fixture-password' },
    readFileObject: async () => null,
  }
}

async function admin(sql: string) {
  const client = new Client({
    host: source.host,
    port,
    user: 'postgres',
    password: 'fixture-password',
    database: 'postgres',
  })

  await client.connect()

  try {
    return await client.query<{ count: string }>(sql)
  } finally {
    await client.end()
  }
}

it.each(['public;DROP TABLE x', 'public space', '"public"'])(
  'rejects unsafe schema identifiers before connecting: %s',
  (schema) => {
    expect(() => assertSourceAllowed(source, schema, 'samples')).toThrow(
      'Source identifiers must be plain PostgreSQL identifiers',
    )
  },
)

it('enforces both schema and table allowlists', () => {
  expect(() => assertSourceAllowed(source, 'private', 'samples')).toThrow(
    'That schema is not exposed',
  )
  expect(() =>
    assertSourceAllowed(
      { ...source, allowedTables: ['public.allowed'] },
      'public',
      'samples',
    ),
  ).toThrow('That table is not on this connector')
})

// Opt in only where Docker is available. The fixture owns its container and
// loopback-only random port; it never reads the application's DATABASE_URL.
describe.skipIf(process.env['CONNECTOR_POSTGRES_ISOLATED_TEST'] !== 'true')(
  'isolated native PostgreSQL adapter',
  () => {
    beforeAll(async () => {
      await execute('docker', [
        'run',
        '--detach',
        '--name',
        container,
        '-e',
        'POSTGRES_PASSWORD=fixture-password',
        '-p',
        '127.0.0.1::5432',
        'postgres:18-alpine',
      ])
      created = true
      const binding = await execute('docker', ['port', container, '5432'])
      port = z.coerce
        .number()
        .int()
        .positive()
        .parse(binding.stdout.trim().split(':').at(-1))
      source.port = port
      await execute(
        'docker',
        [
          'exec',
          container,
          'sh',
          '-c',
          'until pg_isready -h 127.0.0.1 -U postgres >/dev/null; do sleep 0.1; done',
        ],
        { timeout: 20_000 },
      )
      await admin(`
      CREATE ROLE reader LOGIN PASSWORD 'fixture-password';
      CREATE TABLE samples AS SELECT n, NULL::text AS absent, false AS flag,
        '2026-02-03 04:05:06+00'::timestamptz AS measured,
        decode('00ff41', 'hex') AS bytes, '{"nested":[1,false],"__proto__":{"kept":true}}'::jsonb AS document,
        ARRAY[2,3] AS readings, 'Infinity'::float8 AS positive, 'NaN'::float8 AS not_number
        FROM generate_series(1,3) n;
      CREATE VIEW readonly_probe AS SELECT current_setting('default_transaction_read_only') AS setting;
      CREATE FUNCTION broken_read() RETURNS text LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION E'fixture query failed\\nprivate detail'; END $$;
      CREATE VIEW broken AS SELECT broken_read() AS value;
        CREATE FUNCTION forbidden_read() RETURNS text LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'source permission refused'; END $$;
        CREATE VIEW forbidden AS SELECT forbidden_read() AS value;
      GRANT SELECT ON ALL TABLES IN SCHEMA public TO reader;
    `)
    }, 40_000)

    afterEach(async () => {
      const active = await admin(
        "SELECT count(*) FROM pg_stat_activity WHERE usename = 'reader'",
      )

      expect(active.rows[0].count).toBe('0')
    })

    afterAll(async () => {
      if (created)
        await execute('docker', ['rm', '--force', '--volumes', container])
    })

    it('serializes native Date, Buffer, JSON, arrays and nonfinite primitives without preprocessing', async () => {
      const result = await postgresAdapter.preview(context(), source, {
        schema: 'public',
        table: 'samples',
      })

      expect(result.truncated).toBe(true)
      expect(result.rows).toEqual([
        {
          n: '1',
          absent: null,
          flag: 'false',
          measured: '2026-02-03T04:05:06.000Z',
          bytes: '{"type":"Buffer","data":[0,255,65]}',
          document: '{"nested":[1,false],"__proto__":{"kept":true}}',
          readings: '[2,3]',
          positive: 'Infinity',
          not_number: 'NaN',
        },
      ])
    })

    it('filters mixed requested columns while retaining database column order and the row cap', async () => {
      const result = await postgresAdapter.preview(context(), source, {
        schema: 'public',
        table: 'samples',
        columns: ['flag', 42, 'n', null, 'n; DROP TABLE samples'],
      })

      expect(result.columns).toEqual(['n', 'flag'])
      expect(result.rows).toEqual([{ n: '1', flag: 'false' }])
      expect(result.truncated).toBe(true)
      await expect(
        postgresAdapter.preview(context(), source, {
          schema: 'public',
          table: 'samples',
          columns: [],
        }),
      ).rejects.toMatchObject({ code: 'preview_failed' })
    })

    it('keeps the source session read-only and discovers allowed tables with columns', async () => {
      const probe = await postgresAdapter.preview(context(), source, {
        schema: 'public',
        table: 'readonly_probe',
      })

      expect(probe.rows).toEqual([{ setting: 'on' }])

      const discovery = await postgresAdapter.discover(
        context(),
        {
          ...source,
          allowedTables: ['public.samples', 'public.readonly_probe'],
        },
        { schema: 'public' },
      )

      expect(discovery).toMatchObject({
        schemas: ['public'],
        tables: [
          {
            name: 'readonly_probe',
            kind: 'view',
            columns: [{ name: 'setting', dataType: 'text', nullable: true }],
          },
          {
            name: 'samples',
            kind: 'table',
            columns: expect.arrayContaining([
              { name: 'n', dataType: 'integer', nullable: true },
            ]),
          },
        ],
      })
      await expect(
        postgresAdapter.testConnection(context(), source),
      ).resolves.toMatchObject({ detail: { schemas: 1 } })
    })

    it('starts the governed run before reading and records an over-cap import as failed', async () => {
      const paths: string[] = []
      const failures: string[] = []

      const run = {
        id: 'run',
        workspace_id: 'ws',
        connector_id: 'connector',
        trigger_kind: 'manual',
        status: 'running',
        attempt: 1,
        retry_of_run_id: null,
        request_digest: null,
        result: {},
        error_code: null,
        error_message: null,
        started_at: '2026-01-01T00:00:00Z',
        finished_at: null,
      }

      const ctx = context(async (input, init) => {
        const path = new URL(
          input instanceof Request ? input.url : input.toString(),
          'http://localhost',
        ).pathname

        paths.push(path)

        if (path === '/api/db/connector_runs') return Response.json([])

        if (path === '/api/db/rpc/start_connector_run') {
          // This source cannot be read until the run-start request happens.
          await admin(
            'CREATE VIEW import_after_start AS SELECT 1 AS n UNION ALL SELECT 2; GRANT SELECT ON import_after_start TO reader',
          )

          return Response.json(run)
        }

        if (path === '/api/db/rpc/append_connector_run_log')
          return Response.json({})

        if (path === '/api/db/rpc/fail_connector_run') {
          const request = new Request('http://localhost', init)
          failures.push(
            z.object({ p_error_code: z.string() }).parse(await request.json())
              .p_error_code,
          )

          return Response.json({ ...run, status: 'failed' })
        }

        throw new Error(`Unexpected application request: ${path}`)
      })

      await expect(
        postgresAdapter.ingest(ctx, source, {
          source: { schema: 'public', table: 'import_after_start' },
          target: {
            schemaVersionId: 'schema',
            newDatasetName: 'Import',
            fields: [],
          },
        }),
      ).rejects.toMatchObject({ code: 'row_limit_exceeded' })
      expect(failures).toEqual(['row_limit_exceeded'])
      expect(paths).toEqual([
        '/api/db/connector_runs',
        '/api/db/rpc/start_connector_run',
        '/api/db/rpc/append_connector_run_log',
        '/api/db/rpc/append_connector_run_log',
        '/api/db/rpc/fail_connector_run',
      ])
    })

    it('bounds query errors and retains authentication failures while releasing clients', async () => {
      await expect(
        postgresAdapter.preview(context(), source, {
          schema: 'public',
          table: 'broken',
        }),
      ).rejects.toMatchObject({
        code: 'query_failed',
        message: 'fixture query failed',
      })

      await expect(
        postgresAdapter.preview(context(), source, {
          schema: 'public',
          table: 'forbidden',
        }),
      ).rejects.toMatchObject({
        code: 'source_forbidden',
        message: 'The source database denied access to the requested metadata.',
      })

      const bad = context()
      bad.secrets['password'] = 'wrong-password'
      await expect(
        postgresAdapter.testConnection(bad, source),
      ).rejects.toMatchObject({
        code: 'authentication_failed',
        message: 'The stored credentials were rejected by the source database.',
      })
    })
  },
)
