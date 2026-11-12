import { z } from 'zod'
import type { ResultPreview } from './result-preview'
import type { DiffExample } from './reproduce-diff'
/**
 * AUTO-01/02/03 — Pipeline wire types. PostgREST snake_case shapes; see
 * docs/subsystems/pipelines.md for the contract.
 */

import type { PipelineScheduleKind } from '../pipeline-schedule'

export type { PipelineScheduleKind }

const rawJsonObjectSchema = z.record(z.string(), z.unknown())
const jsonRecordSchema = z.record(z.string(), z.json())

function isRawJsonObject(
  value: unknown,
): value is z.infer<typeof rawJsonObjectSchema> {
  return rawJsonObjectSchema.safeParse(value).success
}

// Preserve scientific column keys while validating every original JSON value.
// Zod's record clones omit an own __proto__ key before checking its value.
export const pipelineJsonObjectSchema = z.custom<
  z.infer<typeof jsonRecordSchema>
>(
  (value) =>
    isRawJsonObject(value) &&
    Object.values(value).every(
      (entry) => pipelineJsonValueSchema.safeParse(entry).success,
    ),
)

export const pipelineJsonValueSchema: z.ZodType<z.core.util.JSONType> = z.lazy(
  () =>
    z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.null(),
      z.array(pipelineJsonValueSchema),
      pipelineJsonObjectSchema,
    ]),
)

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
  configuration: Record<string, z.core.util.JSONType>
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
  parameters: Record<string, z.core.util.JSONType>
  input_versions: Record<string, string>
  result: Record<string, z.core.util.JSONType>
  error_code: string | null
  error_message: string | null
  started_at: string
  finished_at: string | null
  actor_user_id: string | null
  actor_credential_id: string | null
  created_at: string
}

export type PipelineReproductionStatus = 'matches' | 'differs' | 'failed'

/** What a reproduction found, in numbers. Row detail is in `changes`. */
export interface PipelineReproductionSummary {
  /** The reproduced rows hash to exactly what the run recorded. */
  identical: boolean
  /** Digest of the run's recorded result and of the reproduced one. */
  originalDigest: string | null
  reproducedDigest: string | null
  /** Each pinned input, and whether its rows still read the same as when the run used them. */
  inputs: Array<{
    name: string
    datasetVersionId: string
    unchanged: boolean | null
  }>
  originalRows: number
  reproducedRows: number
  matchedRows: number
  addedRows: number
  removedRows: number
  changedRows: number
  changedCells: number
  columnsAdded: string[]
  columnsRemoved: string[]
  changedColumns: Record<string, number>
  largestDelta: Record<string, number>
  /** More changes than `changes` holds. */
  truncated: boolean
  /** Set when only part of the result could be compared. */
  note?: string
  /** Each further output of the version, compared by digest. */
  furtherOutputs?: Array<{
    from: string | null
    originalDigest: string | null
    reproducedDigest: string
    matches: boolean
  }>
}

export interface PipelineReproductionWire {
  id: string
  workspace_id: string
  source_run_id: string
  definition_version_id: string
  status: PipelineReproductionStatus
  tolerance: number | string
  compared: 'dataset_version' | 'preview' | 'digest' | null
  summary: PipelineReproductionSummary | Record<string, never>
  changes: DiffExample[]
  error_code: string | null
  error_message: string | null
  duration_ms: number | null
  requested_by_user_id: string | null
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
  detail: Record<string, z.core.util.JSONType>
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
  form_schema: Record<string, z.core.util.JSONType>
  asked_user_ids: string[]
  answer: Record<string, z.core.util.JSONType> | null
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
  spec: Record<string, z.core.util.JSONType>
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
  /** For a step's line: its name, the rows it gave and their column names. */
  detail?: { name?: string; rowCount?: number; columns?: string[] }
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
  | 'started'
  | 'batched'
  | 'skipped_condition'
  | 'skipped_missed'
  | 'skipped_unchanged'
  | 'skipped_overlap'
  | 'skipped_no_version'
  | 'input_unresolved'
  | 'start_failed'

/** What a trigger did instead of starting a run. */
export interface PipelineScheduleActivityWire {
  id: string
  /** Empty for a webhook call, which has no schedule. */
  schedule_id: string | null
  definition_id: string
  source: 'event' | 'schedule' | 'webhook' | null
  /** What it heard, for the log: `DS-0311 S-15`. */
  label: string | null
  /** The run it began. */
  run_id: string | null
  kind: PipelineScheduleActivityKind
  occurrence_id: string | null
  message: string
  detail: { count?: number } & Record<string, z.core.util.JSONType>
  occurred_at: string
}

/** Decode same-origin execution responses before their values reach the UI. */
export const pipelineRunSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  definition_version_id: z.string(),
  trigger_kind: z.enum(['manual', 'scheduled', 'event']),
  status: z.enum(['running', 'waiting', 'succeeded', 'failed', 'cancelled']),
  attempt: z.number(),
  retry_of_run_id: z.string().nullable(),
  trigger_occurrence_id: z.string().nullable(),
  schedule_id: z.string().nullable(),
  input_digest: z.string().nullable(),
  parameters: pipelineJsonObjectSchema,
  input_versions: z.record(z.string(), z.string()),
  result: pipelineJsonObjectSchema,
  error_code: z.string().nullable(),
  error_message: z.string().nullable(),
  started_at: z.string(),
  finished_at: z.string().nullable(),
  actor_user_id: z.string().nullable(),
  actor_credential_id: z.string().nullable(),
  created_at: z.string(),
}) satisfies z.ZodType<PipelineRunWire>

const previewSchema = z.object({
  columns: z.array(z.string()),
  rows: z.array(
    z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])),
  ),
  rowCount: z.number(),
  truncated: z.boolean(),
}) satisfies z.ZodType<ResultPreview>

const trialLogSchema = z.object({
  level: z.enum(['info', 'warning', 'error']),
  stage: z.string(),
  message: z.string(),
  detail: z
    .object({
      name: z.string().optional(),
      rowCount: z.number().optional(),
      columns: z.array(z.string()).optional(),
    })
    .optional(),
}) satisfies z.ZodType<PipelineTrialLogEntry>

export const pipelineTrialSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    stoppedAt: z
      .object({ step: z.string(), reason: z.literal('confirm') })
      .optional(),
    preview: previewSchema,
    logs: z.array(trialLogSchema),
    durationMs: z.number(),
    wouldWrite: z.enum(['create', 'append', 'none']),
  }),
  z.object({
    ok: z.literal(false),
    errorCode: z.string(),
    errorMessage: z.string(),
    logs: z.array(trialLogSchema),
  }),
]) satisfies z.ZodType<PipelineTrialWire>

const diffCellSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])
const diffRowSchema = z.record(z.string(), diffCellSchema)

const diffExampleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('added'), row: diffRowSchema }),
  z.object({ kind: z.literal('removed'), row: diffRowSchema }),
  z.object({
    kind: z.literal('changed'),
    position: z.number(),
    row: diffRowSchema,
    cells: z.array(
      z.object({
        column: z.string(),
        before: diffCellSchema,
        after: diffCellSchema,
      }),
    ),
  }),
]) satisfies z.ZodType<DiffExample>

export const pipelineReproductionSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  source_run_id: z.string(),
  definition_version_id: z.string(),
  status: z.enum(['matches', 'differs', 'failed']),
  tolerance: z.union([z.number(), z.string()]),
  compared: z.enum(['dataset_version', 'preview', 'digest']).nullable(),
  summary: z.union([
    z.object({
      identical: z.boolean(),
      originalDigest: z.string().nullable(),
      reproducedDigest: z.string().nullable(),
      inputs: z.array(
        z.object({
          name: z.string(),
          datasetVersionId: z.string(),
          unchanged: z.boolean().nullable(),
        }),
      ),
      originalRows: z.number(),
      reproducedRows: z.number(),
      matchedRows: z.number(),
      addedRows: z.number(),
      removedRows: z.number(),
      changedRows: z.number(),
      changedCells: z.number(),
      columnsAdded: z.array(z.string()),
      columnsRemoved: z.array(z.string()),
      changedColumns: z.record(z.string(), z.number()),
      largestDelta: z.record(z.string(), z.number()),
      truncated: z.boolean(),
      note: z.string().optional(),
    }),
    z.record(z.string(), z.never()),
  ]),
  changes: z.array(diffExampleSchema),
  error_code: z.string().nullable(),
  error_message: z.string().nullable(),
  duration_ms: z.number().nullable(),
  requested_by_user_id: z.string().nullable(),
  created_at: z.string(),
}) satisfies z.ZodType<PipelineReproductionWire>
