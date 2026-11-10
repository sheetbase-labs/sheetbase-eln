/**
 * INT-03 — browser surface for enterprise connector source operations.
 *
 * Thin fetch wrapper over `/api/connectors/source`. All external-system
 * access happens server-side; this module only ships bounded results back
 * (object metadata, schema/table metadata, previews, import receipts).
 */
import { z } from 'zod'
import { connectorImportResultSchema } from './adapter'
import type {
  ConnectorImportRequest,
  ConnectorImportResult,
  ConnectorImportTarget,
} from './adapter'
import {
  connectorPreviewResultSchema,
  postgresDiscoveryResultSchema,
  s3DiscoveryPageSchema,
  testConnectionResultSchema,
} from './types'
import type { ConnectorWire } from '../types'
import type {
  PostgresDiscoveryResult,
  PreviewResult,
  S3DiscoveryPage,
  TestConnectionResult,
} from '#/lib/connectors/enterprise/types'

const sourceErrorSchema = z.object({
  error: z.object({ message: z.string().optional() }).optional(),
})

type SourceRequest =
  | ({ operation: 'test' } & Parameters<typeof testConnectorConnection>[0])
  | ({ operation: 'discover' } & Parameters<typeof discoverConnectorSource>[0])
  | ({ operation: 'preview' } & Parameters<typeof previewConnectorSource>[0])
  | ({ operation: 'import' } & Parameters<typeof importConnectorSource>[0])

async function callSource<T>(
  body: SourceRequest,
  schema: z.ZodType<T>,
  fetchImpl: typeof fetch,
): Promise<T> {
  const response = await fetchImpl('/api/connectors/source', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const text = await response.text()
    const parsed = sourceErrorSchema.safeParse(text ? JSON.parse(text) : {})

    const message =
      parsed.data?.error?.message ?? 'The connector operation failed.'

    throw new Error(message)
  }

  return schema.parse(await response.json())
}

export function testConnectorConnection(
  input: {
    workspaceId: string
    connectorId: string
  },
  fetchImpl: typeof fetch = fetch,
): Promise<TestConnectionResult> {
  return callSource(
    { ...input, operation: 'test' },
    testConnectionResultSchema,
    fetchImpl,
  )
}

export function discoverConnectorSource(
  input: {
    workspaceId: string
    connectorId: string
    query?: Partial<ConnectorWire['config']>
  },
  fetchImpl: typeof fetch = fetch,
): Promise<S3DiscoveryPage | PostgresDiscoveryResult> {
  return callSource(
    { ...input, operation: 'discover', query: input.query ?? {} },
    z.union([s3DiscoveryPageSchema, postgresDiscoveryResultSchema]),
    fetchImpl,
  )
}

export function previewConnectorSource(
  input: {
    workspaceId: string
    connectorId: string
    selector: ConnectorWire['config']
  },
  fetchImpl: typeof fetch = fetch,
): Promise<PreviewResult> {
  return callSource(
    { ...input, operation: 'preview' },
    connectorPreviewResultSchema,
    fetchImpl,
  )
}

export type ConnectorImportReceipt = ConnectorImportResult

export function importConnectorSource(
  input: {
    workspaceId: string
    connectorId: string
    source: ConnectorWire['config']
    projectId?: string | null
    target: ConnectorImportTarget
    mappings?:
      ConnectorImportRequest<ConnectorWire['config']>['mappings'] | null
  },
  fetchImpl: typeof fetch = fetch,
): Promise<ConnectorImportReceipt> {
  return callSource(
    { ...input, operation: 'import' },
    connectorImportResultSchema,
    fetchImpl,
  )
}
