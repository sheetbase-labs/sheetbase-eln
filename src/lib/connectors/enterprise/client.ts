/**
 * INT-03 — browser surface for enterprise connector source operations.
 *
 * Thin fetch wrapper over `/api/connectors/source`. All external-system
 * access happens server-side; this module only ships bounded results back
 * (object metadata, schema/table metadata, previews, import receipts).
 */
import type { ConnectorImportTarget } from '#/lib/connectors/enterprise/adapter'
import type {
  PostgresDiscoveryResult,
  PreviewResult,
  S3DiscoveryPage,
  TestConnectionResult,
} from '#/lib/connectors/enterprise/types'

interface SourceError {
  error?: { code?: string; message?: string }
}

async function callSource<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch('/api/connectors/source', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  const parsed: unknown = text ? JSON.parse(text) : {}
  if (!response.ok) {
    const message =
      (parsed as SourceError).error?.message ?? 'The connector operation failed.'
    throw new Error(message)
  }
  return parsed as T
}

export function testConnectorConnection(input: {
  workspaceId: string
  connectorId: string
}): Promise<TestConnectionResult> {
  return callSource({ ...input, operation: 'test' })
}

export function discoverConnectorSource(input: {
  workspaceId: string
  connectorId: string
  query?: Record<string, unknown>
}): Promise<S3DiscoveryPage | PostgresDiscoveryResult> {
  return callSource({ ...input, operation: 'discover', query: input.query ?? {} })
}

export function previewConnectorSource(input: {
  workspaceId: string
  connectorId: string
  selector: Record<string, unknown>
}): Promise<PreviewResult> {
  return callSource({ ...input, operation: 'preview' })
}

export interface ConnectorImportReceipt {
  runId: string
  attempt: number
  alreadyCompleted: boolean
  rowCount: number
  datasetId: string
  datasetRevision?: number
}

export function importConnectorSource(input: {
  workspaceId: string
  connectorId: string
  source: Record<string, unknown>
  projectId?: string | null
  target: ConnectorImportTarget
  mappings?: Array<Record<string, unknown>> | null
}): Promise<ConnectorImportReceipt> {
  return callSource({ ...input, operation: 'import' })
}
