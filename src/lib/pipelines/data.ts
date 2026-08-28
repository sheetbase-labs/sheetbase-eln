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
import type { DataClient } from '../data-client'
import type {
  PipelineDefinitionVersionWire,
  PipelineDefinitionWire,
  PipelineRunLogWire,
  PipelineRunOutputWire,
  PipelineRunWire,
  PipelineScheduleWire,
} from './types'

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
    configuration: Record<string, unknown>
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
    configuration: Record<string, unknown>
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
  parameters?: Record<string, unknown>
  inputVersions?: Record<string, string>
  /** sha256 of the canonical run identity; enables idempotent replay. */
  inputDigest?: string | null
  retryOfRunId?: string | null
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
    p_input_digest: input.inputDigest ?? null,
    p_retry_of_run_id: input.retryOfRunId ?? null,
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

/**
 * Execute a started run through the same-origin server route. The server
 * runs the transform SQL in the sandboxed pipeline_worker role and completes
 * or fails the run. Returns the finished run row.
 */
export async function executePipelineRun(
  runId: string,
): Promise<PipelineRunWire> {
  const response = await fetch('/api/pipelines/execute', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ runId }),
  })
  if (!response.ok) {
    let message = `Pipeline execution failed (${response.status})`
    try {
      const body = (await response.json()) as {
        error?: { message?: string }
      }
      if (body.error?.message) message = body.error.message
    } catch {
      // keep the generic message
    }
    throw new Error(message)
  }
  return (await response.json()) as PipelineRunWire
}

// ---------------------------------------------------------------------------
// Schedules.
// ---------------------------------------------------------------------------

export async function createPipelineSchedule(
  client: DataClient,
  input: {
    workspaceId: string
    definitionId: string
    kind: 'interval' | 'daily' | 'event'
    spec: Record<string, unknown>
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
    kind?: 'interval' | 'daily' | 'event' | null
    spec?: Record<string, unknown> | null
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
  'id,workspace_id,key,name,description,lifecycle,revision,created_at,updated_at,created_by_user_id,updated_by_user_id'

const VERSION_FIELDS =
  'id,definition_id,workspace_id,version,lifecycle,configuration_format_version,configuration,revision,created_at,updated_at,created_by_user_id,published_at,published_by_user_id,retired_at,retired_by_user_id'

const RUN_FIELDS =
  'id,workspace_id,definition_version_id,trigger_kind,status,attempt,retry_of_run_id,input_digest,parameters,input_versions,result,error_code,error_message,started_at,finished_at,actor_user_id,actor_credential_id,created_at'

const LOG_FIELDS =
  'id,workspace_id,run_id,sequence,level,stage,message,detail,at'

const OUTPUT_FIELDS =
  'id,workspace_id,run_id,dataset_id,dataset_version_id,label,created_at'

const SCHEDULE_FIELDS =
  'id,workspace_id,definition_id,kind,spec,enabled,last_run_at,next_run_at,last_evaluated_at,created_at,updated_at,created_by_user_id'

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
