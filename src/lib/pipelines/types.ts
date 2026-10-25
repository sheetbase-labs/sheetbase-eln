import type { ResultPreview } from './result-preview'
/**
 * AUTO-01/02/03 — Pipeline wire types. PostgREST snake_case shapes; see
 * docs/subsystems/pipelines.md for the contract.
 */

import type { PipelineScheduleKind } from '../pipeline-schedule'

export type { PipelineScheduleKind }

export type PipelineLifecycle = 'active' | 'retired'
export type PipelineVersionLifecycle = 'draft' | 'published' | 'retired'
export type PipelineRunTrigger = 'manual' | 'scheduled' | 'event'
export type PipelineRunStatus =
  'running' | 'waiting' | 'succeeded' | 'failed' | 'cancelled'

export interface PipelineDefinitionWire {
  id: string
  workspace_id: string
  key: string
  /** Stable per-workspace id, e.g. PL-0007. */
  display_id?: string | null
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

/** One paused `confirm` step of a run: the typed form, the people asked, and
 * the answer once given. See former migration 0396. */
export interface PipelineRunPromptWire {
  id: string
  workspace_id: string
  run_id: string
  step_id: string
  form_schema: Record<string, unknown>
  asked_user_ids: string[]
  answer: Record<string, unknown> | null
  answered_by_user_id: string | null
  answered_at: string | null
  expires_at: string | null
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
  /** `incremental` inputs: the Dataset Version last started on, by input. */
  input_watermarks: Record<string, string>
  created_at: string
  updated_at: string
  created_by_user_id: string | null
}

/** One line of what a trial of a draft did; nothing of it is stored. */
export interface PipelineTrialLogEntry {
  level: 'info' | 'warning' | 'error'
  stage: string
  message: string
}

/** The answer to "Try draft": a preview of the result, or why there is none. */
export type PipelineTrialWire =
  | {
      ok: true
      /** Set when the draft stopped at a step that waits for a person. */
      stoppedAt?: { step: string; reason: 'confirm' }
      preview: ResultPreview
      logs: PipelineTrialLogEntry[]
      durationMs: number
      /** What a real run would do with the result; a trial does none of it. */
      wouldWrite: 'create' | 'append' | 'none'
    }
  | {
      ok: false
      errorCode: string
      errorMessage: string
      logs: PipelineTrialLogEntry[]
    }

export type PipelineScheduleActivityKind =
  | 'skipped_missed'
  | 'skipped_unchanged'
  | 'skipped_overlap'
  | 'skipped_no_version'
  | 'input_unresolved'
  | 'start_failed'

/** What a trigger did instead of starting a run. */
export interface PipelineScheduleActivityWire {
  id: string
  schedule_id: string
  kind: PipelineScheduleActivityKind
  occurrence_id: string | null
  message: string
  detail: { count?: number } & Record<string, unknown>
  occurred_at: string
}
