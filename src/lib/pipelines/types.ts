/**
 * AUTO-01/02/03 — Pipeline wire types. PostgREST snake_case shapes; see
 * docs/pipelines.md for the contract.
 */

export type PipelineLifecycle = 'active' | 'retired'
export type PipelineVersionLifecycle = 'draft' | 'published' | 'retired'
export type PipelineRunTrigger = 'manual' | 'scheduled' | 'event'
export type PipelineRunStatus = 'running' | 'succeeded' | 'failed' | 'cancelled'
export type PipelineScheduleKind = 'interval' | 'daily' | 'event'

export interface PipelineDefinitionWire {
  id: string
  workspace_id: string
  key: string
  name: string
  description: string | null
  lifecycle: PipelineLifecycle
  revision: number | string
  created_at: string
  updated_at: string
  created_by_user_id: string | null
  updated_by_user_id: string | null
}

export interface PipelineDefinitionVersionWire {
  id: string
  definition_id: string
  workspace_id: string
  version: number
  lifecycle: PipelineVersionLifecycle
  configuration_format_version: number
  configuration: Record<string, unknown>
  revision: number | string
  created_at: string
  updated_at: string
  created_by_user_id: string | null
  published_at: string | null
  published_by_user_id: string | null
  retired_at: string | null
  retired_by_user_id: string | null
}

export interface PipelineRunWire {
  id: string
  workspace_id: string
  definition_version_id: string
  trigger_kind: PipelineRunTrigger
  status: PipelineRunStatus
  attempt: number
  retry_of_run_id: string | null
  trigger_occurrence_id: string | null
  schedule_id: string | null
  input_digest: string | null
  parameters: Record<string, unknown>
  input_versions: Record<string, string>
  result: Record<string, unknown>
  error_code: string | null
  error_message: string | null
  started_at: string
  finished_at: string | null
  actor_user_id: string | null
  actor_credential_id: string | null
  created_at: string
}

export interface PipelineRunLogWire {
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

export interface PipelineRunOutputWire {
  id: string
  workspace_id: string
  run_id: string
  dataset_id: string
  dataset_version_id: string
  label: string
  created_at: string
}

export interface PipelineScheduleWire {
  id: string
  workspace_id: string
  definition_id: string
  kind: PipelineScheduleKind
  spec: Record<string, unknown>
  enabled: boolean
  last_run_at: string | null
  next_run_at: string | null
  last_evaluated_at: string | null
  last_evaluated_sequence: number | string | null
  created_at: string
  updated_at: string
  created_by_user_id: string | null
}
