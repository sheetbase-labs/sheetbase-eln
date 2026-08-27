/**
 * INT-03C — generic read-only external PostgreSQL connector adapter
 * (server-only).
 *
 * Not vendor-specific: any PostgreSQL-compatible source (self-hosted,
 * managed warehouses exposing the wire protocol) via host/port/database.
 * Reuses the INT-01 framework through the shared adapter seam.
 *
 * Strictly read-only — this is a source connector, not a SQL IDE:
 *  - no arbitrary SQL, no DML, no DDL, no stored-procedure execution;
 *  - the only statements executed are metadata queries against pg_catalog /
 *    information_schema and a generated `SELECT explicit_columns FROM
 *    schema.table LIMIT n` preview/import read;
 *  - identifiers are validated and quoted — never interpolated raw;
 *  - credentials come from sealed connector secrets (never a DSN in config);
 *  - reads are bounded by an explicit row cap that fails with
 *    `row_limit_exceeded` rather than silently truncating.
 */
import { Client } from 'pg'

import {
  POSTGRES_SYSTEM_SCHEMAS as SYSTEM_SCHEMAS,
  parsePostgresConfig,
  quoteIdentifier,
} from './config-validation'
import type {
  ConnectorAdapterContext,
  ConnectorImportRequest,
  EnterpriseConnectorAdapter,
} from './adapter'
import { ConnectorExecutionError, boundedErrorMessage } from './errors'
import { ingestTabularPayload } from '../tabular-ingestion'
import { sha256Hex } from '../digest'
import type {
  PostgresColumnDescriptor,
  PostgresConnectorConfig,
  PostgresDiscoveryResult,
  PostgresTableDescriptor,
} from './types'

export const POSTGRES_PARSER_IDENTITY = 'sheetbase.postgres-table@1'

export { parsePostgresConfig, quoteIdentifier } from './config-validation'

/** Open one short-lived read-only client. Never exposes the connection. */
async function connect(
  source: PostgresConnectorConfig,
  secrets: Record<string, string>,
): Promise<Client> {
  const username = secrets['username'] ?? ''
  const password = secrets['password'] ?? ''
  const client = new Client({
    host: source.host,
    port: source.port,
    database: source.database,
    user: username,
    password,
    ssl:
      source.sslMode === 'disable'
        ? false
        : {
            // `prefer` tolerates self-signed certificates; `require` in this
            // release does not pin CAs (documented honestly in docs).
            rejectUnauthorized: source.sslMode === 'require' ? true : false,
          },
    options: `-c default_transaction_read_only=on`,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
  })
  try {
    await client.connect()
  } catch (error) {
    await client.end().catch(() => {})
    throw mapPostgresError(error)
  }
  // Belt and braces: refuse writes for the whole session, not just queries
  // this adapter generates.
  await client
    .query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY')
    .catch(() => {})
  return client
}

function mapPostgresError(error: unknown): ConnectorExecutionError {
  const code = (error as { code?: string } | null)?.code ?? ''
  const message = boundedErrorMessage(error)
  if (/password authentication failed|role .* does not exist/i.test(message)) {
    return new ConnectorExecutionError(
      'authentication_failed',
      'The stored credentials were rejected by the source database.',
    )
  }
  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|getaddrinfo/i.test(message)) {
    return new ConnectorExecutionError(
      'connection_failed',
      'The source database could not be reached.',
    )
  }
  if (code === '28P01' || code === '42501') {
    return new ConnectorExecutionError(
      'source_forbidden',
      'The source database denied access to the requested metadata.',
    )
  }
  return new ConnectorExecutionError('query_failed', message)
}

const IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_$]*$/

function schemaFilter(source: PostgresConnectorConfig): string[] {
  if (source.allowedSchemas && source.allowedSchemas.length > 0) {
    return source.allowedSchemas
  }
  return []
}

async function listSchemas(
  client: Client,
  source: PostgresConnectorConfig,
): Promise<string[]> {
  const result = await client.query<{ schema_name: string }>(
    `SELECT schema_name FROM information_schema.schemata ORDER BY schema_name`,
  )
  const allowed = schemaFilter(source)
  return result.rows
    .map((row) => row.schema_name)
    .filter((name) => !SYSTEM_SCHEMAS.has(name))
    .filter((name) => allowed.length === 0 || allowed.includes(name))
}

async function listTables(
  client: Client,
  schema: string,
): Promise<PostgresTableDescriptor[]> {
  if (!IDENTIFIER.test(schema)) return []
  const result = await client.query<{
    table_name: string
    table_type: string
  }>(
    `SELECT table_name, table_type
       FROM information_schema.tables
      WHERE table_schema = $1
      ORDER BY table_name`,
    [schema],
  )
  return result.rows.map((row) => ({
    schema,
    name: row.table_name,
    kind: row.table_type === 'VIEW' ? ('view' as const) : ('table' as const),
    columns: [],
  }))
}

async function listColumns(
  client: Client,
  schema: string,
  table: string,
): Promise<PostgresColumnDescriptor[]> {
  if (!IDENTIFIER.test(schema) || !IDENTIFIER.test(table)) return []
  const result = await client.query<{
    column_name: string
    data_type: string
    is_nullable: string
  }>(
    `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position`,
    [schema, table],
  )
  return result.rows.map((row) => ({
    name: row.column_name,
    dataType: row.data_type,
    nullable: row.is_nullable === 'YES',
  }))
}

interface SourceRows {
  columns: string[]
  rows: Array<Record<string, string | null>>
  truncated: boolean
}

async function readRows(
  source: PostgresConnectorConfig,
  secrets: Record<string, string>,
  selector: { schema: string; table: string; columns?: string[] },
  rowCap: number,
  hardCap: boolean,
): Promise<SourceRows> {
  const schema =
    typeof selector['schema'] === 'string' ? selector['schema'] : ''
  const table = typeof selector['table'] === 'string' ? selector['table'] : ''
  const requested = Array.isArray(selector['columns'])
    ? (selector['columns'] as unknown[]).filter(
        (entry): entry is string => typeof entry === 'string',
      )
    : undefined
  const allowedTables = source.allowedTables ?? []
  if (
    allowedTables.length > 0 &&
    !allowedTables.includes(`${schema}.${table}`)
  ) {
    throw new ConnectorExecutionError(
      'source_forbidden',
      'That table is not on this connector’s allowlist.',
    )
  }
  const client = await connect(source, secrets)
  try {
    const columns = await listColumns(client, schema, table)
    const usable = requested
      ? columns.filter((column) => requested.includes(column.name))
      : columns
    if (usable.length === 0) {
      throw new ConnectorExecutionError(
        'preview_failed',
        'No readable columns were found for that table.',
      )
    }
    // Explicit column list — no SELECT *, no expressions, no SQL passthrough.
    const columnSql = usable
      .map((column) => quoteIdentifier(column.name))
      .join(', ')
    const tableSql = `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`
    // Bounded read: fetch cap + 1 so a truncating import is impossible —
    // more rows than the cap is an explicit `row_limit_exceeded` failure.
    const limit = rowCap + (hardCap ? 1 : 0)
    const result = await client.query<Record<string, unknown>>(
      `SELECT ${columnSql} FROM ${tableSql} LIMIT ${limit}`,
    )
    const rows = result.rows
      .slice(0, rowCap)
      .map((row) =>
        Object.fromEntries(
          Object.entries(row).map(([key, value]) => [
            key,
            value === null || value === undefined
              ? null
              : value instanceof Date
                ? value.toISOString()
                : typeof value === 'object'
                  ? JSON.stringify(value)
                  : String(value),
          ]),
        ),
      )
    return {
      columns: usable.map((column) => column.name),
      rows,
      truncated: hardCap && result.rows.length > rowCap,
    }
  } catch (error) {
    if (error instanceof ConnectorExecutionError) throw error
    throw mapPostgresError(error)
  } finally {
    await client.end().catch(() => {})
  }
}

export const postgresAdapter: EnterpriseConnectorAdapter<PostgresConnectorConfig> =
  {
    id: 'postgres',
    requiredSecrets: ['username', 'password'],

    parseConfig: parsePostgresConfig,

    async testConnection(
      context: ConnectorAdapterContext,
      source: PostgresConnectorConfig,
    ) {
      const client = await connect(source, context.secrets)
      try {
        const probe = await client.query<{ ok: number }>('SELECT 1 AS ok')
        if (Number(probe.rows[0]?.ok) !== 1) {
          throw new ConnectorExecutionError(
            'connection_failed',
            'The source database did not answer the connection probe.',
          )
        }
        const schemas = await listSchemas(client, source)
        return {
          detail: {
            host: source.host,
            database: source.database,
            sslMode: source.sslMode,
            schemas: schemas.length,
          },
        }
      } catch (error) {
        if (error instanceof ConnectorExecutionError) throw error
        throw mapPostgresError(error)
      } finally {
        await client.end().catch(() => {})
      }
    },

    async discover(context, source, query): Promise<PostgresDiscoveryResult> {
      const schema = typeof query['schema'] === 'string' ? query['schema'] : ''
      const client = await connect(source, context.secrets)
      try {
        const schemas = await listSchemas(client, source)
        if (schema) {
          if (!schemas.includes(schema)) {
            throw new ConnectorExecutionError(
              'source_forbidden',
              'That schema is not exposed by this connector.',
            )
          }
          const tables = await listTables(client, schema)
          for (const descriptor of tables) {
            descriptor.columns = await listColumns(
              client,
              schema,
              descriptor.name,
            )
          }
          return { schemas, tables }
        }
        return { schemas, tables: [] }
      } catch (error) {
        if (error instanceof ConnectorExecutionError) throw error
        throw mapPostgresError(error)
      } finally {
        await client.end().catch(() => {})
      }
    },

    async preview(context, source, selector) {
      const rows = await readRows(
        source,
        context.secrets,
        selector as { schema: string; table: string; columns?: string[] },
        context.limits.previewRows,
        true,
      )
      return {
        columns: rows.columns,
        rows: rows.rows,
        truncated: rows.truncated,
      }
    },

    async ingest(
      context: ConnectorAdapterContext,
      source: PostgresConnectorConfig,
      request: ConnectorImportRequest<Record<string, unknown>>,
    ) {
      const read = await readRows(
        source,
        context.secrets,
        request.source as { schema: string; table: string; columns?: string[] },
        context.limits.importRows,
        true,
      )
      if (read.truncated) {
        throw new ConnectorExecutionError(
          'row_limit_exceeded',
          `The source has more than ${context.limits.importRows} rows; raise the connector's import_rows limit deliberately or narrow the selection.`,
        )
      }
      if (read.rows.length === 0) {
        throw new ConnectorExecutionError(
          'no_rows',
          'The selected source returned no rows.',
        )
      }
      const schema = String(request.source['schema'] ?? '')
      const table = String(request.source['table'] ?? '')
      // Request identity includes a hash of the actually-read content: a
      // changed source under the same selector is a new logical request.
      const contentSha256 = await sha256Hex(JSON.stringify(read.rows))
      const result = await ingestTabularPayload(context.client, {
        workspaceId: context.workspaceId,
        connectorId: context.connector.id,
        parserIdentity: POSTGRES_PARSER_IDENTITY,
        sheetName: `${schema}.${table}`,
        payload: {
          headers: read.columns,
          // NULL → blank so the pinned Schema's fail-closed coercion decides,
          // mirroring CSV import semantics.
          rows: read.rows.map((row) =>
            Object.fromEntries(
              read.columns.map((column) => [column, row[column] ?? '']),
            ),
          ),
          metadata: {},
          warnings: [],
        },
        source: {
          kind: 'postgres_table',
          host: source.host,
          port: source.port,
          database: source.database,
          schema,
          table,
          columns: read.columns,
          contentSha256,
        },
        // Content hash stands in for a raw retained file; database imports
        // have no raw-file evidence by design (documented in provenance).
        checksum: contentSha256,
        byteSize: null,
        target: request.target,
        mappings: request.mappings,
        resultKind: 'postgres_import',
      })
      return {
        runId: result.runId,
        attempt: result.attempt,
        alreadyCompleted: result.alreadyCompleted,
        rowCount: result.rowCount,
        datasetId: result.datasetId,
        datasetRevision: result.datasetRevision,
      }
    },
  }
