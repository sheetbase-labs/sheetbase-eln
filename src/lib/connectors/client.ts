/**
 * INT-01 — typed DataClient surface for connectors, runs and run logs.
 * All writes go through the `api.*_connector*` RPCs so capability checks,
 * idempotency digests and change events fire server-side.
 */
import type { DataClient } from '../data-client'
import type {
  ConnectorDirection,
  ConnectorRunLogWire,
  ConnectorRunWire,
  ConnectorType,
  ConnectorWire,
} from './types'
import { t } from '#/copy'

export interface RegisterConnectorInput {
  workspaceId: string
  key: string
  name: string
  connectorType?: ConnectorType
  direction?: ConnectorDirection
  config?: Record<string, unknown>
  parserId?: string | null
}

export async function registerConnector(
  client: DataClient,
  input: RegisterConnectorInput,
): Promise<ConnectorWire> {
  return client.rpc('register_connector', {
    p_workspace_id: input.workspaceId,
    p_key: input.key,
    p_name: input.name,
    p_connector_type: input.connectorType ?? 'custom',
    p_direction: input.direction ?? 'inbound',
    p_config: input.config ?? {},
    p_parser_id: input.parserId ?? null,
  })
}

export async function updateConnector(
  client: DataClient,
  input: {
    workspaceId: string
    connectorId: string
    name?: string | null
    status?: 'active' | 'paused' | 'archived' | null
    config?: Record<string, unknown> | null
    /** Another parser, or `null` to read each file by what's in it. */
    parserId?: string | null
  },
): Promise<ConnectorWire> {
  return client.rpc('update_connector', {
    p_workspace_id: input.workspaceId,
    p_connector_id: input.connectorId,
    p_name: input.name ?? null,
    p_status: input.status ?? null,
    p_config: input.config ?? null,
    ...(input.parserId === undefined
      ? {}
      : input.parserId === null
        ? { p_clear_parser: true }
        : { p_parser_id: input.parserId }),
  })
}

export interface StartConnectorRunInput {
  workspaceId: string
  connectorId: string
  triggerKind?: 'manual' | 'scheduled' | 'event'
  /** sha256 of the request inputs; enables retry-safe ingestion. */
  requestDigest?: string | null
  retryOfRunId?: string | null
  /**
   * INT-03 provisional logical source identity, known before external source
   * work starts. Guards concurrent duplicates; the canonical content-aware
   * request digest is established inside the running attempt pre-commit.
   */
  selectorDigest?: string | null
}

export async function startConnectorRun(
  client: DataClient,
  input: StartConnectorRunInput,
): Promise<ConnectorRunWire> {
  return client.rpc('start_connector_run', {
    p_workspace_id: input.workspaceId,
    p_connector_id: input.connectorId,
    p_trigger_kind: input.triggerKind ?? 'manual',
    p_request_digest: input.requestDigest ?? null,
    p_retry_of_run_id: input.retryOfRunId ?? null,
    p_selector_digest: input.selectorDigest ?? null,
  })
}

/**
 * INT-03 — establish the canonical content-aware request digest inside a
 * running enterprise attempt, before commit. Rejects with
 * 'request already imported' (SB047) when an identical content identity was
 * already imported successfully (replay).
 */
export async function establishConnectorRunRequest(
  client: DataClient,
  input: { workspaceId: string; runId: string; requestDigest: string },
): Promise<void> {
  await client.rpc('establish_connector_run_request', {
    p_workspace_id: input.workspaceId,
    p_run_id: input.runId,
    p_request_digest: input.requestDigest,
  })
}

export async function completeConnectorRun(
  client: DataClient,
  input: {
    workspaceId: string
    runId: string
    result?: Record<string, unknown>
  },
): Promise<ConnectorRunWire> {
  return client.rpc('complete_connector_run', {
    p_workspace_id: input.workspaceId,
    p_run_id: input.runId,
    p_result: input.result ?? {},
  })
}

export async function failConnectorRun(
  client: DataClient,
  input: {
    workspaceId: string
    runId: string
    errorCode: string
    errorMessage?: string | null
  },
): Promise<ConnectorRunWire> {
  return client.rpc('fail_connector_run', {
    p_workspace_id: input.workspaceId,
    p_run_id: input.runId,
    p_error_code: input.errorCode,
    p_error_message: input.errorMessage ?? null,
  })
}

export async function appendConnectorRunLog(
  client: DataClient,
  input: {
    workspaceId: string
    runId: string
    level?: 'info' | 'warning' | 'error'
    stage: string
    message: string
    detail?: Record<string, unknown>
  },
): Promise<ConnectorRunLogWire> {
  return client.rpc('append_connector_run_log', {
    p_workspace_id: input.workspaceId,
    p_run_id: input.runId,
    p_level: input.level ?? 'info',
    p_stage: input.stage,
    p_message: input.message,
    p_detail: input.detail ?? {},
  })
}

// ---------------------------------------------------------------------------
// Reads (PostgREST resource queries).
// ---------------------------------------------------------------------------

const CONNECTOR_FIELDS =
  'id,workspace_id,key,name,connector_type,direction,status,parser_id,config,created_at,updated_at'

const RUN_FIELDS =
  'id,workspace_id,connector_id,trigger_kind,status,attempt,retry_of_run_id,request_digest,result,error_code,error_message,started_at,finished_at'

export async function listConnectors(
  client: DataClient,
): Promise<ConnectorWire[]> {
  return client.list<ConnectorWire>(
    'connectors',
    `?select=${CONNECTOR_FIELDS}&order=name.asc`,
  )
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A connector by id, or by its key ("document-management") when the address
 * carries the readable name instead. */
export async function getConnector(
  client: DataClient,
  idOrKey: string,
): Promise<ConnectorWire | undefined> {
  const column = UUID.test(idOrKey) ? 'id' : 'key'
  const rows = await client.list<ConnectorWire>(
    'connectors',
    `?select=${CONNECTOR_FIELDS}&${column}=eq.${encodeURIComponent(idOrKey)}`,
  )
  return rows[0]
}

export async function listConnectorRuns(
  client: DataClient,
  connectorId: string,
  limit = 50,
): Promise<ConnectorRunWire[]> {
  return client.list<ConnectorRunWire>(
    'connector_runs',
    `?select=${RUN_FIELDS}&connector_id=eq.${encodeURIComponent(connectorId)}&order=started_at.desc&limit=${limit}`,
  )
}

export async function listRunLogs(
  client: DataClient,
  runId: string,
): Promise<ConnectorRunLogWire[]> {
  return client.list<ConnectorRunLogWire>(
    'connector_run_logs',
    `?select=id,workspace_id,run_id,sequence,level,stage,message,detail,at&run_id=eq.${encodeURIComponent(runId)}&order=sequence.asc`,
  )
}

export const connectorQueryKeys = {
  connectors: ['connectors'] as const,
  connector: (id: string) => ['connectors', id] as const,
  runs: (connectorId: string) => ['connectors', connectorId, 'runs'] as const,
  runLogs: (runId: string) => ['connectors', 'runs', runId, 'logs'] as const,
}

export function describeConnectorsError(cause: unknown): string {
  const message =
    cause instanceof Error
      ? cause.message
      : t('data.connectorsClient.requestFailed')
  if (/capability required/i.test(message)) {
    return t('data.connectorsClient.doHavePermissionManage')
  }
  if (/connector key|invalid connector key/i.test(message)) {
    return t('data.connectorsClient.chooseDifferentLowercaseKey')
  }
  return message
}
