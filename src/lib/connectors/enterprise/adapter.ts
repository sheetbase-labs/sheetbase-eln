/**
 * INT-03 — shared enterprise connector adapter layer (server-side).
 *
 * A thin seam between the INT-01 connector framework and vendor-specific
 * client code. Adapters implement connection testing, bounded discovery,
 * bounded preview and governed ingestion; the framework continues to own
 * runs, secrets, provenance, retry/idempotency and audit. Vendor specifics
 * stay inside each adapter — there is no second integration framework.
 */
import type { DataClient } from '#/lib/data-client'
import type { ConnectorWire } from '../types'
import type { ImportLimits } from './types'
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

export interface ConnectorImportRequest<TSource> {
  /** Selector of the source object/table to import. */
  source: TSource
  /** Project used to retain raw source evidence (storage adapters). */
  projectId?: string | null
  target: ConnectorImportTarget
  mappings?: ImportColumnMapping[]
}

export interface ConnectorImportResult {
  runId: string
  attempt: number
  alreadyCompleted: boolean
  rowCount: number
  datasetId: string
  datasetRevision?: number
}

/**
 * One enterprise connector adapter. `discover`/`preview` return bounded,
 * safe payloads; `ingest` runs the governed execution model end-to-end and
 * reports the finished run.
 */
export interface EnterpriseConnectorAdapter<TSource = unknown> {
  readonly id: string
  /** Required + optional secret names for this adapter. */
  readonly requiredSecrets: readonly string[]
  readonly optionalSecrets?: readonly string[]
  /** Parse + validate non-secret config; throws a safe message when invalid. */
  parseConfig: (config: Record<string, unknown>) => TSource
  testConnection: (
    context: ConnectorAdapterContext,
    source: TSource,
  ) => Promise<{ detail?: Record<string, unknown> }>
  discover: (
    context: ConnectorAdapterContext,
    source: TSource,
    query: Record<string, unknown>,
  ) => Promise<unknown>
  preview: (
    context: ConnectorAdapterContext,
    source: TSource,
    selector: Record<string, unknown>,
  ) => Promise<unknown>
  ingest: (
    context: ConnectorAdapterContext,
    source: TSource,
    request: ConnectorImportRequest<Record<string, unknown>>,
  ) => Promise<ConnectorImportResult>
}

/** Non-generic structural view used by the operation dispatcher. */
export interface AnyEnterpriseConnectorAdapter {
  id: string
  requiredSecrets: readonly string[]
  optionalSecrets?: readonly string[]
  parseConfig: (config: Record<string, unknown>) => unknown
  testConnection: (
    context: ConnectorAdapterContext,
    source: never,
  ) => Promise<{ detail?: Record<string, unknown> }>
  discover: (
    context: ConnectorAdapterContext,
    source: never,
    query: Record<string, unknown>,
  ) => Promise<unknown>
  preview: (
    context: ConnectorAdapterContext,
    source: never,
    selector: Record<string, unknown>,
  ) => Promise<unknown>
  ingest: (
    context: ConnectorAdapterContext,
    source: never,
    request: ConnectorImportRequest<Record<string, unknown>>,
  ) => Promise<ConnectorImportResult>
}
