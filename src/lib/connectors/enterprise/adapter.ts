/**
 * INT-03 — shared enterprise connector adapter layer (server-side).
 *
 * A thin seam between the INT-01 connector framework and vendor-specific
 * client code. Adapters implement connection testing, bounded discovery,
 * bounded preview and governed ingestion; the framework continues to own
 * runs, secrets, provenance, retry/idempotency and audit. Vendor specifics
 * stay inside each adapter — there is no second integration framework.
 */
import { z } from 'zod'
import type { DataClient } from '#/lib/data-client'
import type { ConnectorWire } from '../types'
import type {
  ImportLimits,
  PostgresConnectorConfig,
  S3ConnectorConfig,
  PostgresDiscoveryResult,
  S3DiscoveryPage,
  PreviewResult,
  TestConnectionResult,
} from './types'
import type {
  ImportColumnMapping,
  ImportTargetField,
} from '#/lib/import-mapping'

export interface ConnectorAdapterContext {
  client: DataClient
  workspaceId: string
  connector: ConnectorWire
  limits: ImportLimits
  /** Decrypted secrets, in-process only (never returned to a browser). */
  secrets: Record<string, string>
  /** Session token for file-platform retention reads (server-side only). */
  token: string
  /** Reads a file_objects row (PostgREST in prod, injectable in tests). */
  readFileObject: (
    workspaceId: string,
    recordId: string,
  ) => Promise<{
    id: string
    storage_key: string
    status: string
    version: number
  } | null>
}

export interface ConnectorImportTarget {
  datasetId?: string | null
  expectedRevision?: number | null
  newDatasetName?: string | null
  schemaVersionId: string
  fields: ImportTargetField[]
}

const importTargetFieldSchema = z.object({
  id: z.string(),
  key: z.string().optional(),
  label: z.string(),
  logicalType: z.string(),
  nullable: z.boolean(),
  options: z
    .array(
      z.object({
        id: z.string(),
        key: z.string().optional(),
        label: z.string(),
      }),
    )
    .optional(),
  unit: z.string().nullish(),
  kind: z.enum([
    'dataset-field',
    'record-field',
    'record-title',
    'record-status',
  ]),
}) satisfies z.ZodType<ImportTargetField>

export const connectorImportTargetSchema = z.object({
  datasetId: z.string().nullish(),
  expectedRevision: z.number().nullish(),
  newDatasetName: z.string().nullish(),
  schemaVersionId: z.string(),
  fields: z.array(importTargetFieldSchema),
}) satisfies z.ZodType<ConnectorImportTarget>

export const connectorImportMappingsSchema = z.array(
  z.discriminatedUnion('kind', [
    z.object({ source: z.string(), kind: z.literal('ignore') }),
    z.object({
      source: z.string(),
      kind: z.literal('field'),
      field: importTargetFieldSchema,
      sourceUnit: z.string().nullish(),
    }),
  ]),
) satisfies z.ZodType<ImportColumnMapping[]>

export interface ConnectorImportRequest<TSource> {
  /** Selector of the source object/table to import. */
  source: TSource
  /** Project used to retain raw source evidence (storage adapters). */
  projectId?: string | null
  target: ConnectorImportTarget
  mappings?: ImportColumnMapping[]
}

export const connectorImportResultSchema = z.object({
  runId: z.string(),
  attempt: z.number(),
  alreadyCompleted: z.boolean(),
  rowCount: z.number(),
  datasetId: z.string(),
  datasetRevision: z.number().optional(),
})

export type ConnectorImportResult = z.infer<typeof connectorImportResultSchema>

/**
 * One enterprise connector adapter. `discover`/`preview` return bounded,
 * safe payloads; `ingest` runs the governed execution model end-to-end and
 * reports the finished run.
 */
export interface EnterpriseConnectorAdapter<
  TSource = S3ConnectorConfig | PostgresConnectorConfig,
> {
  readonly id: string
  /** Required + optional secret names for this adapter. */
  readonly requiredSecrets: readonly string[]
  readonly optionalSecrets?: readonly string[]
  /** Parse + validate non-secret config; throws a safe message when invalid. */
  parseConfig: (config: ConnectorWire['config']) => TSource
  testConnection: (
    context: ConnectorAdapterContext,
    source: TSource,
  ) => Promise<Pick<TestConnectionResult, 'detail'>>
  discover: (
    context: ConnectorAdapterContext,
    source: TSource,
    query: ConnectorWire['config'],
  ) => Promise<S3DiscoveryPage | PostgresDiscoveryResult>
  preview: (
    context: ConnectorAdapterContext,
    source: TSource,
    selector: ConnectorWire['config'],
  ) => Promise<PreviewResult>
  ingest: (
    context: ConnectorAdapterContext,
    source: TSource,
    request: ConnectorImportRequest<ConnectorWire['config']>,
  ) => Promise<ConnectorImportResult>
}

/** Non-generic structural view used by the operation dispatcher. */
export interface AnyEnterpriseConnectorAdapter {
  id: string
  requiredSecrets: readonly string[]
  optionalSecrets?: readonly string[]
  parseConfig: (
    config: ConnectorWire['config'],
  ) => S3ConnectorConfig | PostgresConnectorConfig
  testConnection: (
    context: ConnectorAdapterContext,
    source: never,
  ) => Promise<Pick<TestConnectionResult, 'detail'>>
  discover: (
    context: ConnectorAdapterContext,
    source: never,
    query: ConnectorWire['config'],
  ) => Promise<S3DiscoveryPage | PostgresDiscoveryResult>
  preview: (
    context: ConnectorAdapterContext,
    source: never,
    selector: ConnectorWire['config'],
  ) => Promise<PreviewResult>
  ingest: (
    context: ConnectorAdapterContext,
    source: never,
    request: ConnectorImportRequest<ConnectorWire['config']>,
  ) => Promise<ConnectorImportResult>
}
