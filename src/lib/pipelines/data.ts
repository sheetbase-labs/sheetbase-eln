/**
 * AUTO-01/02/03 — typed DataClient surface for Pipelines.
 *
 * All writes go through the api.* RPCs so capability checks, idempotency
 * digests and change events fire server-side; the tables themselves are
 * read-only for request roles. Executing a run is a server-only operation
 * (src/lib/pipeline-execute.server.ts) because the transform SQL runs inside
 * a low-privilege pipeline_worker session role — the browser starts the run
 * and then calls the same-origin execute route.
 */
import { z } from 'zod'
import type { DataClient } from '../data-client'
import {
  pipelineRunSchema,
  pipelineTrialSchema,
  pipelineReproductionSchema,
} from './types'
import type {
  PipelineDefinitionVersionWire,
  PipelineDefinitionWire,
  PipelineRunLogWire,
  PipelineRunOutputWire,
  PipelineRunPromptWire,
  PipelineRunWire,
  PipelineScheduleKind,
  PipelineScheduleActivityWire,
  PipelineScheduleWire,
  PipelineReproductionWire,
  PipelineTrialWire,
} from './types'
import { t } from '#/copy'
import { runNumbers } from './run-steps'

// ---------------------------------------------------------------------------
// Definitions + versions.
// ---------------------------------------------------------------------------

export async function createPipelineDefinition(
  client: DataClient,
  input: {
    workspaceId: string
    key: string
    name: string
    description?: string | null
  },
): Promise<PipelineDefinitionWire> {
  return client.rpc('create_pipeline_definition', {
    p_workspace_id: input.workspaceId,
    p_key: input.key,
    p_name: input.name,
    p_description: input.description ?? null,
  })
}

export async function updatePipelineDefinition(
  client: DataClient,
  input: {
    workspaceId: string
    definitionId: string
    name?: string | null
    description?: string | null
    lifecycle?: 'active' | 'retired' | null
  },
): Promise<PipelineDefinitionWire> {
  return client.rpc('update_pipeline_definition', {
    p_workspace_id: input.workspaceId,
    p_definition_id: input.definitionId,
    p_name: input.name ?? null,
    p_description: input.description ?? null,
    p_lifecycle: input.lifecycle ?? null,
  })
}

export async function createPipelineDefinitionVersion(
  client: DataClient,
  input: {
    workspaceId: string
    definitionId: string
    configuration: Record<string, z.core.util.JSONType>
  },
): Promise<PipelineDefinitionVersionWire> {
  return client.rpc('create_pipeline_definition_version', {
    p_workspace_id: input.workspaceId,
    p_definition_id: input.definitionId,
    p_configuration: input.configuration,
  })
}

export async function publishPipelineDefinitionVersion(
  client: DataClient,
  input: { workspaceId: string; versionId: string },
): Promise<PipelineDefinitionVersionWire> {
  return client.rpc('publish_pipeline_definition_version', {
    p_workspace_id: input.workspaceId,
    p_version_id: input.versionId,
  })
}

export async function updatePipelineDefinitionVersionDraft(
  client: DataClient,
  input: {
    workspaceId: string
    versionId: string
    expectedRevision: number
    configuration: Record<string, z.core.util.JSONType>
  },
): Promise<PipelineDefinitionVersionWire> {
  return client.rpc('update_pipeline_definition_version_draft', {
    p_workspace_id: input.workspaceId,
    p_version_id: input.versionId,
    p_expected_revision: input.expectedRevision,
    p_configuration: input.configuration,
  })
}

export async function retirePipelineDefinitionVersion(
  client: DataClient,
  input: { workspaceId: string; versionId: string },
): Promise<PipelineDefinitionVersionWire> {
  return client.rpc('retire_pipeline_definition_version', {
    p_workspace_id: input.workspaceId,
    p_version_id: input.versionId,
  })
}

// ---------------------------------------------------------------------------
// Runs.
// ---------------------------------------------------------------------------

export interface StartPipelineRunInput {
  workspaceId: string
  definitionVersionId: string
  triggerKind?: 'manual' | 'scheduled' | 'event'
  parameters?: Record<string, z.core.util.JSONType>
  inputVersions?: Record<string, string>
  retryOfRunId?: string | null
  /**
   * Stable identity for scheduled/event trigger occurrences
   * (`sched:<id>:<due_at>` / `evt:<change_event_id>`); null for manual.
   * The canonical input_digest is computed server-side, never supplied here.
   */
  triggerOccurrenceId?: string | null
  /** The schedule that triggered this run (scheduled/event runs only). */
  scheduleId?: string | null
}

export async function startPipelineRun(
  client: DataClient,
  input: StartPipelineRunInput,
): Promise<PipelineRunWire> {
  return client.rpc('start_pipeline_run', {
    p_workspace_id: input.workspaceId,
    p_definition_version_id: input.definitionVersionId,
    p_trigger_kind: input.triggerKind ?? 'manual',
    p_parameters: input.parameters ?? {},
    p_input_versions: input.inputVersions ?? {},
    p_retry_of_run_id: input.retryOfRunId ?? null,
    p_trigger_occurrence_id: input.triggerOccurrenceId ?? null,
    p_schedule_id: input.scheduleId ?? null,
  })
}

export async function cancelPipelineRun(
  client: DataClient,
  input: { workspaceId: string; runId: string },
): Promise<PipelineRunWire> {
  return client.rpc('cancel_pipeline_run', {
    p_workspace_id: input.workspaceId,
    p_run_id: input.runId,
  })
}

/** How long a client follows a run before giving up and pointing at the run page. */
const RUN_FOLLOW_LIMIT_MS = 30 * 60_000

async function readRunError(
  response: Response,
  fallback: string,
): Promise<Error> {
  let message = `${fallback} (${response.status})`

  try {
    const body = z
      .object({
        error: z.object({ message: z.string().optional() }).optional(),
      })
      .parse(await response.json())

    if (body.error?.message) message = body.error.message
  } catch {
    // keep the generic message
  }

  return new Error(message)
}

/**
 * Follow a queued run to the end: poll the run and its queue state until no job
 * is open (a worker finished with it) and return the run as it then stands.
 */
async function followRun(runId: string): Promise<PipelineRunWire> {
  const deadline = Date.now() + RUN_FOLLOW_LIMIT_MS
  let delay = 750

  for (;;) {
    const response = await fetch(
      `/api/pipelines/execute?runId=${encodeURIComponent(runId)}`,
    )

    if (!response.ok)
      throw await readRunError(
        response,
        t('data.pipelineData.followingRunFailed'),
      )

    const state = z
      .object({
        run: pipelineRunSchema,
        job: z
          .object({ state: z.string(), lastError: z.string().nullable() })
          .nullable(),
      })
      .parse(await response.json())

    const open = state.job?.state === 'queued' || state.job?.state === 'claimed'

    if (!open) {
      if (state.job?.state === 'dead')
        throw new Error(
          state.run.error_message ??
            state.job.lastError ??
            t('data.pipelineData.pipelineRunCouldExecuted'),
        )

      return state.run
    }

    if (Date.now() > deadline)
      throw new Error(t('data.pipelineData.runStillQueuedRunning'))
    await new Promise((resolve) => setTimeout(resolve, delay))
    delay = Math.min(delay * 1.4, 4_000)
  }
}

/**
 * Queue a started run through the same-origin server route and follow it to the
 * end. A worker executes it on the sandboxed pipeline connection and completes
 * or fails it; nothing runs inside the request. Returns the finished run row.
 */
export async function executePipelineRun(
  runId: string,
): Promise<PipelineRunWire> {
  const response = await fetch('/api/pipelines/execute', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ runId }),
  })

  if (!response.ok)
    throw await readRunError(
      response,
      t('data.pipelineData.pipelineExecutionFailed'),
    )

  return followRun(runId)
}

/**
 * Try a draft: run the configuration the editor holds on the chosen inputs and
 * get a preview back. Nothing is saved, published or recorded.
 */
export async function tryPipelineDraft(input: {
  workspaceId: string
  configuration: unknown
  inputVersions: Record<string, string>
  parameters: Record<string, z.core.util.JSONType>
}): Promise<PipelineTrialWire> {
  const response = await fetch('/api/pipelines/try-draft', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })

  if (!response.ok)
    throw await readRunError(response, t('data.pipelineData.tryingDraftFailed'))

  return pipelineTrialSchema.parse(await response.json())
}

// ---------------------------------------------------------------------------
// Reproductions.
// ---------------------------------------------------------------------------

/**
 * Reproduce a finished run: run it again from the version, parameters and
 * inputs it pinned, into scratch, and get the verdict back. Nothing is added to
 * the workspace except the reproduction record.
 */
export async function reproducePipelineRun(input: {
  runId: string
  tolerance?: number
}): Promise<PipelineReproductionWire> {
  const response = await fetch('/api/pipelines/reproduce', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })

  if (!response.ok)
    throw await readRunError(response, t('data.reproduce.couldNotReproduce'))

  return pipelineReproductionSchema.parse(await response.json())
}

const REPRODUCTION_FIELDS =
  'id,workspace_id,source_run_id,definition_version_id,status,tolerance,compared,summary,changes,error_code,error_message,duration_ms,requested_by_user_id,created_at'

/** A run's reproductions, newest first. */
export async function listPipelineReproductions(
  client: DataClient,
  runId: string,
): Promise<PipelineReproductionWire[]> {
  return client.list<PipelineReproductionWire>(
    'pipeline_reproductions',
    `?select=${REPRODUCTION_FIELDS}&source_run_id=eq.${encodeURIComponent(runId)}&order=created_at.desc&limit=20`,
  )
}

/** The newest verdict for each of these runs, for the run history. */
export async function listLatestReproductions(
  client: DataClient,
  runIds: string[],
): Promise<Record<string, PipelineReproductionWire['status']>> {
  if (runIds.length === 0) return {}

  const rows = await client.list<
    Pick<PipelineReproductionWire, 'source_run_id' | 'status'>
  >(
    'pipeline_reproductions',
    `?select=source_run_id,status&source_run_id=in.(${runIds.map(encodeURIComponent).join(',')})&order=created_at.desc&limit=500`,
  )

  const latest: Record<string, PipelineReproductionWire['status']> = {}

  for (const row of rows) latest[row.source_run_id] ??= row.status

  return latest
}

// ---------------------------------------------------------------------------
// Schedules.
// ---------------------------------------------------------------------------

export async function createPipelineSchedule(
  client: DataClient,
  input: {
    workspaceId: string
    definitionId: string
    kind: PipelineScheduleKind
    spec: Record<string, z.core.util.JSONType>
    enabled?: boolean
  },
): Promise<PipelineScheduleWire> {
  return client.rpc('create_pipeline_schedule', {
    p_workspace_id: input.workspaceId,
    p_definition_id: input.definitionId,
    p_kind: input.kind,
    p_spec: input.spec,
    p_enabled: input.enabled ?? true,
  })
}

export async function updatePipelineSchedule(
  client: DataClient,
  input: {
    workspaceId: string
    scheduleId: string
    kind?: PipelineScheduleKind | null
    spec?: Record<string, z.core.util.JSONType> | null
    enabled?: boolean | null
  },
): Promise<PipelineScheduleWire> {
  return client.rpc('update_pipeline_schedule', {
    p_workspace_id: input.workspaceId,
    p_schedule_id: input.scheduleId,
    p_kind: input.kind ?? null,
    p_spec: input.spec ?? null,
    p_enabled: input.enabled ?? null,
  })
}

export async function deletePipelineSchedule(
  client: DataClient,
  input: { workspaceId: string; scheduleId: string },
): Promise<void> {
  await client.rpc('delete_pipeline_schedule', {
    p_workspace_id: input.workspaceId,
    p_schedule_id: input.scheduleId,
  })
}

// ---------------------------------------------------------------------------
// Reads.
// ---------------------------------------------------------------------------

const DEFINITION_FIELDS =
  'id,workspace_id,key,display_id,name,description,lifecycle,revision,created_at,updated_at,created_by_user_id,updated_by_user_id'

const VERSION_FIELDS =
  'id,definition_id,workspace_id,version,lifecycle,configuration_format_version,configuration,revision,created_at,updated_at,created_by_user_id,published_at,published_by_user_id,retired_at,retired_by_user_id'

const RUN_FIELDS =
  'id,workspace_id,definition_version_id,trigger_kind,status,attempt,retry_of_run_id,trigger_occurrence_id,schedule_id,input_digest,parameters,input_versions,result,error_code,error_message,started_at,finished_at,actor_user_id,actor_credential_id,created_at'

const LOG_FIELDS =
  'id,workspace_id,run_id,sequence,level,stage,message,detail,at'

const OUTPUT_FIELDS =
  'id,workspace_id,run_id,dataset_id,dataset_version_id,label,created_at'

const SCHEDULE_FIELDS =
  'id,workspace_id,definition_id,kind,spec,enabled,last_run_at,next_run_at,last_evaluated_at,last_evaluated_sequence,input_watermarks,created_at,updated_at,created_by_user_id'

const PROMPT_FIELDS =
  'id,workspace_id,run_id,step_id,form_schema,asked_user_ids,answer,answered_by_user_id,answered_at,expires_at,created_at'

export async function listPipelineDefinitions(
  client: DataClient,
): Promise<PipelineDefinitionWire[]> {
  return client.list<PipelineDefinitionWire>(
    'pipeline_definitions',
    `?select=${DEFINITION_FIELDS}&order=name.asc`,
  )
}

export async function getPipelineDefinition(
  client: DataClient,
  definitionId: string,
): Promise<PipelineDefinitionWire | undefined> {
  const rows = await client.list<PipelineDefinitionWire>(
    'pipeline_definitions',
    `?select=${DEFINITION_FIELDS}&id=eq.${encodeURIComponent(definitionId)}`,
  )

  return rows[0]
}

export async function listPipelineDefinitionVersions(
  client: DataClient,
  definitionId: string,
): Promise<PipelineDefinitionVersionWire[]> {
  return client.list<PipelineDefinitionVersionWire>(
    'pipeline_definition_versions',
    `?select=${VERSION_FIELDS}&definition_id=eq.${encodeURIComponent(definitionId)}&order=version.desc`,
  )
}

export async function getPipelineDefinitionVersion(
  client: DataClient,
  versionId: string,
): Promise<PipelineDefinitionVersionWire | undefined> {
  const rows = await client.list<PipelineDefinitionVersionWire>(
    'pipeline_definition_versions',
    `?select=${VERSION_FIELDS}&id=eq.${encodeURIComponent(versionId)}`,
  )

  return rows[0]
}

export async function listPipelineRuns(
  client: DataClient,
  definitionVersionId: string,
  limit = 50,
): Promise<PipelineRunWire[]> {
  return client.list<PipelineRunWire>(
    'pipeline_runs',
    `?select=${RUN_FIELDS}&definition_version_id=eq.${encodeURIComponent(definitionVersionId)}&order=started_at.desc&limit=${limit}`,
  )
}

/** Recent workspace runs, newest first — the notebook picker surface. */
export async function listRecentPipelineRuns(
  client: DataClient,
  limit = 20,
): Promise<PipelineRunWire[]> {
  return client.list<PipelineRunWire>(
    'pipeline_runs',
    `?select=${RUN_FIELDS}&order=started_at.desc&limit=${limit}`,
  )
}

export async function getPipelineRun(
  client: DataClient,
  runId: string,
): Promise<PipelineRunWire | undefined> {
  const rows = await client.list<PipelineRunWire>(
    'pipeline_runs',
    `?select=${RUN_FIELDS}&id=eq.${encodeURIComponent(runId)}`,
  )

  return rows[0]
}

export async function listPipelineRunLogs(
  client: DataClient,
  runId: string,
): Promise<PipelineRunLogWire[]> {
  return client.list<PipelineRunLogWire>(
    'pipeline_run_logs',
    `?select=${LOG_FIELDS}&run_id=eq.${encodeURIComponent(runId)}&order=sequence.asc`,
  )
}

export async function listPipelineRunOutputs(
  client: DataClient,
  runId: string,
): Promise<PipelineRunOutputWire[]> {
  return client.list<PipelineRunOutputWire>(
    'pipeline_run_outputs',
    `?select=${OUTPUT_FIELDS}&run_id=eq.${encodeURIComponent(runId)}&order=created_at.asc`,
  )
}

/** The run that made a Dataset Version, with the pipeline it belongs to, if any. */
export async function getRunForDatasetVersion(
  client: DataClient,
  datasetVersionId: string,
): Promise<{
  runId: string
  pipelineId: string
  pipelineName: string
  runNumber: number | null
} | null> {
  const outputs = await client.list<{ run_id: string }>(
    'pipeline_run_outputs',
    `?select=run_id&dataset_version_id=eq.${encodeURIComponent(datasetVersionId)}&order=created_at.desc&limit=1`,
  )

  const runId = outputs.at(0)?.run_id

  if (!runId) return null

  const runs = await client.list<{ definition_version_id: string }>(
    'pipeline_runs',
    `?select=definition_version_id&id=eq.${encodeURIComponent(runId)}&limit=1`,
  )

  const versionId = runs.at(0)?.definition_version_id

  if (!versionId) return null

  const versions = await client.list<{ definition_id: string }>(
    'pipeline_definition_versions',
    `?select=definition_id&id=eq.${encodeURIComponent(versionId)}&limit=1`,
  )

  const pipelineId = versions.at(0)?.definition_id

  if (!pipelineId) return null

  const [definitions, siblings] = await Promise.all([
    client.list<{ name: string }>(
      'pipeline_definitions',
      `?select=name&id=eq.${encodeURIComponent(pipelineId)}&limit=1`,
    ),
    client.list<{ id: string }>(
      'pipeline_definition_versions',
      `?select=id&definition_id=eq.${encodeURIComponent(pipelineId)}`,
    ),
  ])

  const everyRun = siblings.length
    ? await client.list<{ id: string; started_at: string }>(
        'pipeline_runs',
        `?select=id,started_at&definition_version_id=in.(${siblings.map((v) => v.id).join(',')})&order=started_at.asc&limit=5000`,
      )
    : []

  return {
    runId,
    pipelineId,
    pipelineName: definitions.at(0)?.name ?? '',
    runNumber: runNumbers(everyRun).get(runId) ?? null,
  }
}

/** Which Pipeline runs produced a given Dataset (Dataset page integration). */
export async function listPipelineOutputsForDataset(
  client: DataClient,
  datasetId: string,
): Promise<PipelineRunOutputWire[]> {
  return client.list<PipelineRunOutputWire>(
    'pipeline_run_outputs',
    `?select=${OUTPUT_FIELDS}&dataset_id=eq.${encodeURIComponent(datasetId)}&order=created_at.desc&limit=50`,
  )
}

// ---------------------------------------------------------------------------
// Waiting runs (PIPE-02).
// ---------------------------------------------------------------------------

/** Every prompt a run has raised, oldest first. */
export async function listPipelineRunPrompts(
  client: DataClient,
  runId: string,
): Promise<PipelineRunPromptWire[]> {
  return client.list<PipelineRunPromptWire>(
    'pipeline_run_prompts',
    `?select=${PROMPT_FIELDS}&run_id=eq.${encodeURIComponent(runId)}&order=created_at.asc`,
  )
}

/** The answer a person gives to a waiting run's prompt. */
export interface PipelineRunPromptAnswer {
  decision: 'confirm' | 'skip' | 'stop'
  values?: Record<string, z.core.util.JSONType>
  reason?: string
}

/**
 * Answer a waiting run's prompt through the same-origin execute route. The
 * route resumes the run from the paused step with the same pinned inputs and
 * records the decision under the answering person's name; only the people the
 * prompt asked may answer.
 */
export async function answerPipelineRunPrompt(
  runId: string,
  answer: PipelineRunPromptAnswer,
): Promise<PipelineRunWire> {
  const response = await fetch('/api/pipelines/execute', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ runId, answer }),
  })

  if (!response.ok)
    throw await readRunError(
      response,
      t('data.pipelineData.answeringRunFailed'),
    )

  return followRun(runId)
}

export async function listPipelineSchedules(
  client: DataClient,
  definitionId?: string,
): Promise<PipelineScheduleWire[]> {
  const filter = definitionId
    ? `&definition_id=eq.${encodeURIComponent(definitionId)}`
    : ''

  return client.list<PipelineScheduleWire>(
    'pipeline_schedules',
    `?select=${SCHEDULE_FIELDS}${filter}&order=created_at.asc`,
  )
}

/** Runs one trigger started, newest first: the trigger's run history. */
export async function listScheduleRuns(
  client: DataClient,
  scheduleId: string,
  limit = 25,
): Promise<PipelineRunWire[]> {
  return client.list<PipelineRunWire>(
    'pipeline_runs',
    `?select=${RUN_FIELDS}&schedule_id=eq.${encodeURIComponent(scheduleId)}&order=started_at.desc&limit=${limit}`,
  )
}

/** The newest run each of these triggers started, keyed by trigger id. */
export async function listLatestScheduleRuns(
  client: DataClient,
  scheduleIds: string[],
): Promise<Map<string, PipelineRunWire>> {
  const latest = new Map<string, PipelineRunWire>()

  if (scheduleIds.length === 0) return latest

  const runs = await client.list<PipelineRunWire>(
    'pipeline_runs',
    `?select=${RUN_FIELDS}&schedule_id=in.(${scheduleIds.map(encodeURIComponent).join(',')})&order=started_at.desc&limit=200`,
  )

  for (const run of runs) {
    if (run.schedule_id && !latest.has(run.schedule_id)) {
      latest.set(run.schedule_id, run)
    }
  }

  return latest
}

/** What one trigger did instead of running (skips, unresolved inputs). */
export async function listScheduleActivity(
  client: DataClient,
  scheduleId: string,
  limit = 25,
): Promise<PipelineScheduleActivityWire[]> {
  return client.list<PipelineScheduleActivityWire>(
    'pipeline_schedule_activity',
    `?select=id,schedule_id,kind,occurrence_id,message,detail,occurred_at&schedule_id=eq.${encodeURIComponent(scheduleId)}&order=occurred_at.desc&limit=${limit}`,
  )
}

// ---------------------------------------------------------------------------
// Dataset product integration (AUTO-03): which Pipelines can run against a
// Dataset, and their run-compatible surface.
// ---------------------------------------------------------------------------

export interface RunCompatiblePipeline {
  definitionId: string
  definitionName: string
  definitionKey: string
  versionId: string
  versionNumber: number
  /** The single input name v1-compatible Pipelines expose. */
  inputName: string
  hasParameters: boolean
}

/**
 * Published Pipelines with exactly one input — the surface the Dataset page
 * offers for "run a Pipeline against this Dataset" (the run pre-fills the
 * input with the Dataset's latest Version id).
 */
export async function listRunCompatiblePipelines(
  client: DataClient,
): Promise<RunCompatiblePipeline[]> {
  const [definitions, versions] = await Promise.all([
    client.list<PipelineDefinitionWire>(
      'pipeline_definitions',
      `?select=${DEFINITION_FIELDS}&lifecycle=eq.active&order=name.asc`,
    ),
    client.list<PipelineDefinitionVersionWire>(
      'pipeline_definition_versions',
      `?select=${VERSION_FIELDS}&lifecycle=eq.published&order=version.desc`,
    ),
  ])

  const definitionById = new Map(definitions.map((d) => [d.id, d]))
  const latestByDefinition = new Map<string, PipelineDefinitionVersionWire>()

  for (const version of versions) {
    if (!latestByDefinition.has(version.definition_id)) {
      latestByDefinition.set(version.definition_id, version)
    }
  }

  const result: RunCompatiblePipeline[] = []

  for (const version of latestByDefinition.values()) {
    const definition = definitionById.get(version.definition_id)
    const config = version.configuration

    const inputs = z
      .array(z.object({ name: z.string().catch('input') }))
      .length(1)
      .safeParse(config.inputs)

    if (!definition || !inputs.success) {
      continue
    }

    const first = inputs.data[0]
    result.push({
      definitionId: definition.id,
      definitionName: definition.name,
      definitionKey: definition.key,
      versionId: version.id,
      versionNumber: version.version,
      inputName: first.name,
      hasParameters:
        Array.isArray(config.parameters) && config.parameters.length > 0,
    })
  }

  return result
}

export const pipelineQueryKeys = {
  definitions: ['pipelines', 'definitions'] as const,
  definition: (id: string) => ['pipelines', 'definitions', id] as const,
  versions: (id: string) =>
    ['pipelines', 'definitions', id, 'versions'] as const,
  runs: (versionId: string) => ['pipelines', 'runs', versionId] as const,
  run: (runId: string) => ['pipelines', 'runs', runId] as const,
  runLogs: (runId: string) => ['pipelines', 'runs', runId, 'logs'] as const,
  runOutputs: (runId: string) =>
    ['pipelines', 'runs', runId, 'outputs'] as const,
  schedules: ['pipelines', 'schedules'] as const,
}
