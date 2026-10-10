import { useQuery } from '@tanstack/react-query'

import type { Tone } from '#/components/v3/ui/status'
import type { WorkspaceMemberIdentity } from '#/components/v3/projects/project-data'
import type { DataClient } from '#/lib/data-client'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  getPipelineDefinition,
  listPipelineDefinitionVersions,
  listPipelineDefinitions,
  listPipelineRunLogs,
  listPipelineRunOutputs,
  listPipelineRunPrompts,
  listPipelineSchedules,
} from '#/lib/pipelines/data'
import type {
  PipelineDefinitionVersionWire,
  PipelineDefinitionWire,
  PipelineRunLogWire,
  PipelineRunOutputWire,
  PipelineRunPromptWire,
  PipelineRunStatus,
  PipelineRunWire,
  PipelineScheduleWire,
} from '#/lib/pipelines/types'

/**
 * UI port (roadmap-4/ui-app3): the Pipelines board reads the AUTO-01/02/03
 * registry — definitions, versions, runs, logs, outputs and schedules. Runs are
 * started through api.start_pipeline_run and executed through the same-origin
 * execute route, so capability checks and the sandbox role stay server-side.
 */
export function runStatus(status: PipelineRunStatus): {
  tone: Tone
  label: string
} {
  switch (status) {
    case 'running':
      return { tone: 'progress', label: 'Running' }
    case 'waiting':
      return { tone: 'warn', label: 'Waiting for a person' }
    case 'succeeded':
      return { tone: 'ok', label: 'Succeeded' }
    case 'failed':
      return { tone: 'bad', label: 'Failed' }
    case 'cancelled':
      return { tone: 'stored', label: 'Cancelled' }
    default:
      return { tone: 'none', label: status }
  }
}

export function versionStatus(
  lifecycle: PipelineDefinitionVersionWire['lifecycle'],
): { tone: Tone; label: string } {
  switch (lifecycle) {
    case 'published':
      return { tone: 'ok', label: 'Published' }
    case 'draft':
      return { tone: 'draft', label: 'Draft' }
    case 'retired':
      return { tone: 'stored', label: 'Retired' }
    default:
      return { tone: 'none', label: lifecycle }
  }
}

export function runDuration(run: PipelineRunWire): string {
  if (!run.finished_at) return '—'
  const ms =
    new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()
  if (ms < 1000) return `${ms} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
  return `${Math.round(ms / 60_000)} min`
}

/** The version a definition currently runs on: the newest published version. */
export function currentVersion(
  versions: PipelineDefinitionVersionWire[],
): PipelineDefinitionVersionWire | undefined {
  return (
    versions.find((v) => v.lifecycle === 'published') ??
    versions.find((v) => v.lifecycle === 'draft') ??
    versions[0]
  )
}

export function draftVersion(
  versions: PipelineDefinitionVersionWire[],
): PipelineDefinitionVersionWire | undefined {
  return versions.find((v) => v.lifecycle === 'draft')
}

export interface PipelineListRow extends PipelineDefinitionWire {
  versions: PipelineDefinitionVersionWire[]
  current: PipelineDefinitionVersionWire | undefined
  draft: PipelineDefinitionVersionWire | undefined
  runCount: number
  lastRun: PipelineRunWire | undefined
}

export function buildPipelineRows(
  definitions: PipelineDefinitionWire[],
  versions: PipelineDefinitionVersionWire[],
  runs: PipelineRunWire[],
): PipelineListRow[] {
  const byDefinition = new Map<string, PipelineDefinitionVersionWire[]>()
  for (const v of versions) {
    const list = byDefinition.get(v.definition_id) ?? []
    list.push(v)
    byDefinition.set(v.definition_id, list)
  }
  const runsByVersion = new Map<string, PipelineRunWire[]>()
  for (const r of runs) {
    const list = runsByVersion.get(r.definition_version_id) ?? []
    list.push(r)
    runsByVersion.set(r.definition_version_id, list)
  }
  return definitions.map((d) => {
    const list = (byDefinition.get(d.id) ?? []).sort(
      (a, b) => b.version - a.version,
    )
    const allRuns = list.flatMap((v) => runsByVersion.get(v.id) ?? [])
    allRuns.sort(
      (a, b) =>
        new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
    )
    return {
      ...d,
      versions: list,
      current: currentVersion(list),
      draft: draftVersion(list),
      runCount: allRuns.length,
      lastRun: allRuns.at(0),
    }
  })
}

export const pipelineDataQueryKeys = {
  list: ['ui-port', 'pipelines', 'list'] as const,
  definition: (id: string) =>
    ['ui-port', 'pipelines', 'definition', id] as const,
  versions: (id: string) => ['ui-port', 'pipelines', 'versions', id] as const,
  runs: (id: string) =>
    ['ui-port', 'pipelines', 'definition-runs', id] as const,
  run: (id: string) => ['ui-port', 'pipelines', 'run', id] as const,
  runLogs: (id: string) => ['ui-port', 'pipelines', 'run-logs', id] as const,
  runPrompts: (id: string) =>
    ['ui-port', 'pipelines', 'run-prompts', id] as const,
  runOutputs: (id: string) =>
    ['ui-port', 'pipelines', 'run-outputs', id] as const,
  runDeliveries: (id: string) =>
    ['ui-port', 'pipelines', 'run-deliveries', id] as const,
  schedules: (id: string) => ['ui-port', 'pipelines', 'schedules', id] as const,
}

export function usePipelineRows(client: DataClient = notebookDataClient) {
  return useQuery({
    queryKey: pipelineDataQueryKeys.list,
    queryFn: async (): Promise<PipelineListRow[]> => {
      const definitions = await listPipelineDefinitions(client)
      if (definitions.length === 0) return []
      const [versions, runs] = await Promise.all([
        client.list<PipelineDefinitionVersionWire>(
          'pipeline_definition_versions',
          '?select=id,definition_id,workspace_id,version,lifecycle,configuration_format_version,configuration,revision,created_at,updated_at,created_by_user_id,published_at,published_by_user_id,retired_at,retired_by_user_id&order=version.desc',
        ),
        client.list<PipelineRunWire>(
          'pipeline_runs',
          '?select=id,workspace_id,definition_version_id,trigger_kind,status,attempt,retry_of_run_id,trigger_occurrence_id,schedule_id,input_digest,parameters,input_versions,result,error_code,error_message,started_at,finished_at,actor_user_id,actor_credential_id,created_at&order=started_at.desc&limit=200',
        ),
      ])
      return buildPipelineRows(definitions, versions, runs)
    },
    staleTime: 15_000,
  })
}

export function usePipelineDefinition(
  definitionId: string,
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: pipelineDataQueryKeys.definition(definitionId),
    queryFn: () => getPipelineDefinition(client, definitionId),
    staleTime: 15_000,
  })
}

export function usePipelineVersions(
  definitionId: string,
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: pipelineDataQueryKeys.versions(definitionId),
    queryFn: () => listPipelineDefinitionVersions(client, definitionId),
    staleTime: 15_000,
  })
}

/** Runs across every version of the definition, newest first. */
export function useDefinitionRuns(
  versions: PipelineDefinitionVersionWire[],
  client: DataClient = notebookDataClient,
) {
  const versionIds = versions.map((v) => v.id)
  return useQuery({
    queryKey: [...pipelineDataQueryKeys.runs(versionIds.join(',')), versionIds],
    queryFn: () =>
      client.list<PipelineRunWire>(
        'pipeline_runs',
        `?select=id,workspace_id,definition_version_id,trigger_kind,status,attempt,retry_of_run_id,trigger_occurrence_id,schedule_id,input_digest,parameters,input_versions,result,error_code,error_message,started_at,finished_at,actor_user_id,actor_credential_id,created_at&definition_version_id=in.(${versionIds.join(',')})&order=started_at.desc&limit=100`,
      ),
    enabled: versionIds.length > 0,
    staleTime: 15_000,
  })
}

export function usePipelineRun(
  runId: string,
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: pipelineDataQueryKeys.run(runId),
    queryFn: () =>
      client
        .list<PipelineRunWire>(
          'pipeline_runs',
          `?select=id,workspace_id,definition_version_id,trigger_kind,status,attempt,retry_of_run_id,trigger_occurrence_id,schedule_id,input_digest,parameters,input_versions,result,error_code,error_message,started_at,finished_at,actor_user_id,actor_credential_id,created_at&id=eq.${encodeURIComponent(runId)}`,
        )
        .then((rows) => rows[0]),
  })
}

/** Resolve the pipeline a run belongs to, for the /pipelines/runs/$runId alias. */
export function usePipelineIdForRun(
  runId: string,
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: ['ui-port', 'pipelines', 'run-definition', runId],
    queryFn: async (): Promise<string | undefined> => {
      const run = await client.list<PipelineRunWire>(
        'pipeline_runs',
        `?select=id,definition_version_id&id=eq.${encodeURIComponent(runId)}`,
      )
      const versionId = run[0]?.definition_version_id
      if (!versionId) return undefined
      const versions = await client.list<{ definition_id: string }>(
        'pipeline_definition_versions',
        `?select=definition_id&id=eq.${encodeURIComponent(versionId)}`,
      )
      return versions[0]?.definition_id
    },
  })
}

export function useRunLogs(
  runId: string,
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: pipelineDataQueryKeys.runLogs(runId),
    queryFn: () => listPipelineRunLogs(client, runId),
  })
}

export function useRunOutputs(
  runId: string,
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: pipelineDataQueryKeys.runOutputs(runId),
    queryFn: () => listPipelineRunOutputs(client, runId),
  })
}

/** The prompts a run has raised — the waiting step's typed form and answer. */
export function useRunPrompts(
  runId: string,
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: pipelineDataQueryKeys.runPrompts(runId),
    queryFn: () => listPipelineRunPrompts(client, runId),
  })
}

export type PipelineRunDeliveryStatus =
  'pending' | 'delivered' | 'failed' | 'retrying' | 'dead_letter'

/** One notification delivery a run queued (PIPE-05.3). `api.webhook_deliveries`
 * records the destination and outcome; the channel type lives on the
 * destination's configuration, not on the delivery. */
export interface PipelineRunDeliveryWire {
  id: string
  subscription_id: string
  event_type: string
  status: PipelineRunDeliveryStatus
  attempt: number
  response_status: number | null
  error_code: string | null
  error_message: string | null
  delivered_at: string | null
  created_at: string
  /** The destination webhook, when the workspace can read it. */
  destination: { key: string; description: string | null } | null
}

/** The delivery ids a run recorded in `result.notificationDeliveryIds`. */
export function readDeliveryIds(result: Record<string, unknown>): string[] {
  const raw = result.notificationDeliveryIds
  if (!Array.isArray(raw)) return []
  return raw.filter((v): v is string => typeof v === 'string' && v.length > 0)
}

/** The deliveries a run queued, joined to their destination webhooks. */
export function useRunDeliveries(
  runId: string,
  deliveryIds: string[],
  client: DataClient = notebookDataClient,
) {
  const ids = deliveryIds.join(',')
  return useQuery({
    queryKey: pipelineDataQueryKeys.runDeliveries(runId),
    queryFn: async (): Promise<PipelineRunDeliveryWire[]> => {
      const rows = await client.list<
        Omit<PipelineRunDeliveryWire, 'destination'>
      >(
        'webhook_deliveries',
        `?select=id,subscription_id,event_type,status,attempt,response_status,error_code,error_message,delivered_at,created_at&id=in.(${ids})&order=created_at.asc`,
      )
      if (rows.length === 0) return []
      const subscriptionIds = [...new Set(rows.map((r) => r.subscription_id))]
      const subscriptions = await client.list<{
        id: string
        key: string
        description: string | null
      }>(
        'webhook_subscriptions',
        `?select=id,key,description&id=in.(${subscriptionIds.join(',')})`,
      )
      const byId = new Map(subscriptions.map((s) => [s.id, s]))
      return rows.map((row) => ({
        ...row,
        destination: byId.get(row.subscription_id) ?? null,
      }))
    },
    enabled: deliveryIds.length > 0,
  })
}

/** The people a prompt can name: user id → display name for the workspace. */
export function useWorkspaceMemberNames(
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: ['ui-port', 'pipelines', 'member-names'] as const,
    queryFn: async (): Promise<Record<string, string>> => {
      const members = await client.rpc<WorkspaceMemberIdentity[]>(
        'workspace_members_list',
        {},
      )
      return Object.fromEntries(members.map((m) => [m.user_id, m.name]))
    },
    staleTime: 60_000,
  })
}

export function useSchedules(
  definitionId: string,
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: pipelineDataQueryKeys.schedules(definitionId),
    queryFn: () => listPipelineSchedules(client, definitionId),
  })
}

export type {
  PipelineDefinitionVersionWire,
  PipelineRunLogWire,
  PipelineRunOutputWire,
  PipelineRunPromptWire,
  PipelineRunWire,
  PipelineScheduleWire,
}
