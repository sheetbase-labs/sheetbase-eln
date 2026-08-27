/**
 * INT-03 — server operations for enterprise connector actions.
 *
 * The single server-side entry surface for connection tests, discovery,
 * previews and governed imports. Exposed through `/api/connectors/source`
 * (src/routes/api/connectors.source.ts); the browser never talks to external
 * systems and never receives decrypted secrets. Every operation:
 *  1. resolves the verified session + workspace membership (never trusting
 *     browser-supplied role/workspace claims);
 *  2. refuses viewers (execution is writer-only; secret management remains
 *     steward-only in the INT-01 functions);
 *  3. resolves the connector through RLS, dispatches to the right adapter
 *     and decrypts secrets only inside trusted server execution;
 *  4. returns bounded, safe payloads — no secrets, no raw driver errors.
 */
import type {
  AnyEnterpriseConnectorAdapter,
  ConnectorAdapterContext,
  ConnectorImportRequest,
} from './adapter'
import { ConnectorExecutionError, resolveConnectorExecutionContext } from './execution.server'
import { enterpriseAdapterId, importLimitsFromConfig } from './types'
import type { EnterpriseAdapterId } from './types'
import { loadConnectorSecrets } from './secrets.server'
import { s3Adapter } from './s3.server'
import { postgresAdapter } from './postgres.server'
import type { ConnectorWire } from '../types'

interface ConnectorOperationInput {
  workspaceId: string
  connectorId: string
}

async function resolveSession(input: { workspaceId: string }) {
  const { getRequestHeaders } = await import('@tanstack/react-start/server')
  const { getCurrentContext } = await import('#/lib/current-user')
  const { getAppSession } = await import('#/lib/auth')
  const headers = getRequestHeaders()
  const session = await getAppSession(headers)
  if (!session) {
    throw new ConnectorExecutionError('unauthenticated', 'You must be signed in.')
  }
  const context = await getCurrentContext(headers)
  if (!context || context.workspace?.id !== input.workspaceId) {
    throw new ConnectorExecutionError(
      'forbidden',
      'You do not have access to this workspace.',
    )
  }
  return resolveConnectorExecutionContext({
    userId: session.user.id,
    sessionId: session.session.id,
    workspaceId: input.workspaceId,
    role: context.workspace.role,
  })
}

// One cast per adapter at this single dispatch point keeps the generic
// adapter interfaces clean; the dispatcher only ever hands each adapter the
// source shape its own parseConfig produced.
const ADAPTERS: Record<EnterpriseAdapterId, AnyEnterpriseConnectorAdapter> = {
  s3: s3Adapter,
  postgres: postgresAdapter,
}

async function resolveConnector(input: ConnectorOperationInput): Promise<{
  context: ConnectorAdapterContext
  adapter: AnyEnterpriseConnectorAdapter
  source: never
}> {
  const exec = await resolveSession(input)
  const connectors = await exec.client.list<ConnectorWire>(
    'connectors',
    `?select=id,workspace_id,key,name,connector_type,direction,status,parser_id,config,created_at,updated_at&id=eq.${encodeURIComponent(input.connectorId)}`,
  )
  const connector = connectors.find(
    (entry) => entry.id === input.connectorId,
  )
  if (!connector) {
    throw new ConnectorExecutionError('not_found', 'Connector not found in this workspace.')
  }
  if (connector.status !== 'active') {
    throw new ConnectorExecutionError('connector_paused', 'This connector is paused.')
  }
  const adapterId = enterpriseAdapterId(connector)
  if (!adapterId) {
    throw new ConnectorExecutionError(
      'unsupported_connector',
      'This connector has no enterprise source adapter configured.',
    )
  }
  const adapter = ADAPTERS[adapterId]
  const source = adapter.parseConfig(connector.config) as never
  const secrets = await loadConnectorSecrets({
    workspaceId: input.workspaceId,
    connectorId: connector.id,
    required: adapter.requiredSecrets,
    optional: adapter.optionalSecrets ?? [],
  })
  return {
    context: {
      client: exec.client,
      workspaceId: input.workspaceId,
      connector,
      limits: importLimitsFromConfig(connector.config),
      secrets,
      token: exec.token,
    },
    adapter,
    source,
  }
}

export async function testConnectorConnection(input: ConnectorOperationInput) {
  const resolved = await resolveConnector(input)
  const result = await resolved.adapter.testConnection(
    resolved.context,
    resolved.source,
  )
  return { ok: true as const, detail: result.detail ?? {} }
}

export async function discoverConnectorSource(
  input: ConnectorOperationInput & { query?: Record<string, unknown> },
) {
  const resolved = await resolveConnector(input)
  return resolved.adapter.discover(
    resolved.context,
    resolved.source,
    input.query ?? {},
  )
}

export async function previewConnectorSource(
  input: ConnectorOperationInput & { selector: Record<string, unknown> },
) {
  const resolved = await resolveConnector(input)
  return resolved.adapter.preview(
    resolved.context,
    resolved.source,
    input.selector,
  )
}

export interface ConnectorImportInput extends ConnectorOperationInput {
  source: Record<string, unknown>
  projectId?: string | null
  target: ConnectorImportRequest<never>['target']
  mappings?: Array<Record<string, unknown>> | null
}

export async function importConnectorSource(input: ConnectorImportInput) {
  const resolved = await resolveConnector(input)
  const request: ConnectorImportRequest<never> = {
    source: resolved.source,
    projectId: input.projectId ?? null,
    target: input.target,
    mappings: (input.mappings ?? undefined) as never,
  }
  return resolved.adapter.ingest(resolved.context, resolved.source, request)
}
