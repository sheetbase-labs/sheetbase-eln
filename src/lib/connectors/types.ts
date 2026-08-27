/**
 * INT-01 — Generic Connector Framework types.
 *
 * One execution, security, provenance and error model for every integration:
 * a connector is registered once, executions become `connector_runs` with
 * trigger/attempt/digest lineage and a bounded error code, and progress is
 * observable through `connector_run_logs`. Wire shapes are PostgREST
 * snake_case; see docs/integrations.md for the contract.
 */

export type ConnectorType =
  'instrument' | 'storage' | 'webhook' | 'database' | 'custom'

export const CONNECTOR_TYPES: ConnectorType[] = [
  'instrument',
  'storage',
  'webhook',
  'database',
  'custom',
]

export type ConnectorDirection = 'inbound' | 'outbound' | 'bidirectional'

export const CONNECTOR_DIRECTIONS: ConnectorDirection[] = [
  'inbound',
  'outbound',
  'bidirectional',
]

export type ConnectorStatus = 'active' | 'paused' | 'archived'

export type ConnectorRunTrigger = 'manual' | 'scheduled' | 'event'

export type ConnectorRunStatus = 'running' | 'succeeded' | 'failed'

export interface ConnectorWire {
  id: string
  workspace_id: string
  key: string
  name: string
  connector_type: ConnectorType
  direction: ConnectorDirection
  status: ConnectorStatus
  parser_id: string | null
  config: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface ConnectorRunWire {
  id: string
  workspace_id: string
  connector_id: string
  trigger_kind: ConnectorRunTrigger
  status: ConnectorRunStatus
  attempt: number
  retry_of_run_id: string | null
  request_digest: string | null
  result: Record<string, unknown>
  error_code: string | null
  error_message: string | null
  started_at: string
  finished_at: string | null
}

export interface ConnectorRunLogWire {
  id: string
  workspace_id: string
  run_id: string
  sequence: number
  level: 'info' | 'warning' | 'error'
  stage: string
  message: string
  detail: Record<string, unknown>
  at: string
}
