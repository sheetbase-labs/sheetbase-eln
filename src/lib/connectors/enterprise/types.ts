/**
 * INT-03 — shared types for enterprise/data-platform connectors.
 *
 * Enterprise connectors reuse the INT-01 connector framework (identity,
 * runs, secrets, provenance, audit). These types describe the small
 * server-side surface each adapter implements: connection test, bounded
 * discovery, bounded preview and governed ingestion.
 */
import { z } from 'zod'
import { pipelineJsonObjectSchema } from '#/lib/pipelines/types'
import type { ConnectorWire } from '../types'

/** Non-secret S3-compatible connector configuration (api.connectors.config). */
export interface S3ConnectorConfig {
  /** Custom endpoint for S3-compatible stores; omit for AWS. */
  endpoint?: string
  region?: string
  bucket: string
  /** Restrict discovery/imports to keys under this prefix. */
  prefix?: string
  /** Path-style addressing (required by most non-AWS stores). */
  forcePathStyle?: boolean
}

/** Non-secret PostgreSQL-compatible connector configuration. */
export interface PostgresConnectorConfig {
  host: string
  port: number
  database: string
  /** `disable` | `prefer` | `require` (mapped onto libpq semantics). */
  sslMode: 'disable' | 'prefer' | 'require'
  /** Restrict discovery/imports to these schemas; defaults to all non-system. */
  allowedSchemas?: string[]
  /** Explicit table/view allowlist (optional, name-qualified). */
  allowedTables?: string[]
}

/** Secret names required by each adapter (values live in connector secrets). */
export const S3_SECRET_NAMES = [
  'access_key_id',
  'secret_access_key',
  'session_token',
] as const

export const POSTGRES_SECRET_NAMES = ['username', 'password'] as const

/** Discriminator stored in connector config; picks the server adapter. */
export type EnterpriseAdapterId = 's3' | 'postgres'

export function enterpriseAdapterId(
  connector: ConnectorWire,
): EnterpriseAdapterId | null {
  const adapter = connector.config['adapter']

  if (adapter === 's3' && connector.connector_type === 'storage') return 's3'

  if (adapter === 'postgres' && connector.connector_type === 'database') {
    return 'postgres'
  }

  return null
}

export const testConnectionResultSchema = z.object({
  ok: z.boolean(),
  /** Concise, safe summary — never raw SDK/driver errors. */
  summary: z.string().optional(),
  detail: pipelineJsonObjectSchema.optional(),
})

export type TestConnectionResult = z.infer<typeof testConnectionResultSchema>

/** One discovered S3 object (metadata only — never bytes). */
const s3ObjectDescriptorSchema = z.object({
  key: z.string(),
  byteSize: z.number(),
  lastModified: z.string().nullable(),
  contentType: z.string().nullable(),
  /** External version id when the bucket is versioned. */
  versionId: z.string().nullable(),
  /** ETag is metadata only — never assumed to be an MD5. */
  etag: z.string().nullable(),
})

export type S3ObjectDescriptor = z.infer<typeof s3ObjectDescriptorSchema>

export const s3DiscoveryPageSchema = z.object({
  objects: z.array(s3ObjectDescriptorSchema),
  /** Opaque continuation token; null when the listing is complete. */
  continuationToken: z.string().nullable(),
})

export type S3DiscoveryPage = z.infer<typeof s3DiscoveryPageSchema>

const postgresColumnDescriptorSchema = z.object({
  name: z.string(),
  dataType: z.string(),
  nullable: z.boolean(),
})

export type PostgresColumnDescriptor = z.infer<
  typeof postgresColumnDescriptorSchema
>

const postgresTableDescriptorSchema = z.object({
  schema: z.string(),
  name: z.string(),
  kind: z.enum(['table', 'view']),
  columns: z.array(postgresColumnDescriptorSchema),
})

export type PostgresTableDescriptor = z.infer<
  typeof postgresTableDescriptorSchema
>

export const postgresDiscoveryResultSchema = z.object({
  schemas: z.array(z.string()),
  tables: z.array(postgresTableDescriptorSchema),
})

export type PostgresDiscoveryResult = z.infer<
  typeof postgresDiscoveryResultSchema
>

/** Bounded preview of a selected source. */
export const connectorPreviewResultSchema = z.object({
  columns: z.array(z.string()),
  rows: z.array(
    z.custom<Record<string, string | null>>((value) => {
      const parsed = pipelineJsonObjectSchema.safeParse(value)

      return (
        parsed.success &&
        Object.values(parsed.data).every(
          (cell) => z.string().nullable().safeParse(cell).success,
        )
      )
    }),
  ),
  truncated: z.boolean(),
})

export type PreviewResult = z.infer<typeof connectorPreviewResultSchema>

export interface ImportLimits {
  /** Maximum rows a preview returns. */
  previewRows: number
  /** Maximum rows a single import reads; more fails with row_limit_exceeded. */
  importRows: number
  /** Maximum bytes downloaded from object storage per import. */
  maxObjectBytes: number
}

/** Conservative INT-03 defaults; overridable per connector via config. */
export const DEFAULT_IMPORT_LIMITS: ImportLimits = {
  previewRows: 100,
  // The canonical DATA parse layer caps a single sheet at 1,000 rows; the
  // enterprise import cap aligns with it for this release.
  importRows: 1000,
  maxObjectBytes: 100 * 1024 * 1024,
}

export function importLimitsFromConfig(
  config: ConnectorWire['config'],
): ImportLimits {
  const readPositive = (key: string, fallback: number): number => {
    const value = Number(config[key])

    return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
  }

  return {
    previewRows: readPositive(
      'preview_rows',
      DEFAULT_IMPORT_LIMITS.previewRows,
    ),
    importRows: readPositive('import_rows', DEFAULT_IMPORT_LIMITS.importRows),
    maxObjectBytes: readPositive(
      'max_object_bytes',
      DEFAULT_IMPORT_LIMITS.maxObjectBytes,
    ),
  }
}
