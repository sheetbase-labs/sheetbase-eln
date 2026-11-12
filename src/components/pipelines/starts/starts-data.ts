/** What the Starts and runs tab reads and writes: the rules, what the starts
 * heard, the runs' manifests, and the reminder to the people a run waits on. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'

import {
  webhookKey,
  webhookRequest,
} from '#/components/pipelines/webhook-state'
import { listDefinitionActivity } from '#/lib/pipelines/data'
import { pipelineDataQueryKeys } from '#/components/pipelines/pipelines-data'
import { notebookDataClient } from '#/lib/notebook-data'
import { parseStartRules } from '#/lib/pipelines/start-rules'
import type { StartRules } from '#/lib/pipelines/start-rules'
import type { StartEvent } from '#/lib/pipelines/starts-view'

export const startsKeys = {
  rules: (id: string) => ['ui-port', 'pipelines', 'start-rules', id] as const,
  activity: (id: string) =>
    ['ui-port', 'pipelines', 'definition-activity', id] as const,
  events: (id: string) => ['ui-port', 'pipelines', 'start-events', id] as const,
  manifest: (runId: string) =>
    ['ui-port', 'pipelines', 'run-manifest', runId] as const,
}

/** The rules stored on the pipeline; none stored means no extra rules. */
export function useStartRules(definitionId: string) {
  return useQuery({
    queryKey: startsKeys.rules(definitionId),
    queryFn: async (): Promise<StartRules> => {
      const rows = await notebookDataClient.list<{ start_rules: unknown }>(
        'pipeline_definitions',
        `?select=start_rules&id=eq.${encodeURIComponent(definitionId)}`,
      )

      return parseStartRules(rows[0]?.start_rules)
    },
  })
}

export function useSetStartRules(workspaceId: string, definitionId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (rules: StartRules) =>
      notebookDataClient.rpc<unknown>('set_pipeline_start_rules', {
        p_workspace_id: workspaceId,
        p_definition_id: definitionId,
        p_rules: rules,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: startsKeys.rules(definitionId),
      })
      void queryClient.invalidateQueries({
        queryKey: ['ui-port', 'pipelines', 'definition', definitionId],
      })
    },
  })
}

/** What every start of the pipeline did over the last 7 days. */
export function useDefinitionActivity(definitionId: string) {
  return useQuery({
    queryKey: startsKeys.activity(definitionId),
    queryFn: () => listDefinitionActivity(notebookDataClient, definitionId, 7),
    staleTime: 15_000,
  })
}

const startEventRow = z.object({
  schedule_id: z.string(),
  event_id: z.string(),
  occurred_at: z.string(),
  dataset_display_id: z.string().nullable(),
  version_label: z.string().nullable(),
  new_rows: z.number().nullable(),
})

/** The snapshots the pipeline's starts heard, for testing the rules. */
export function useStartEvents(
  workspaceId: string,
  definitionId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: startsKeys.events(definitionId),
    enabled,
    queryFn: async (): Promise<StartEvent[]> => {
      const rows = z.array(startEventRow).parse(
        await notebookDataClient.rpc<unknown>('pipeline_start_events', {
          p_workspace_id: workspaceId,
          p_definition_id: definitionId,
          p_days: 7,
        }),
      )

      return rows.map((row) => ({
        scheduleId: row.schedule_id,
        eventId: row.event_id,
        at: new Date(row.occurred_at),
        label: [row.dataset_display_id, row.version_label]
          .filter(Boolean)
          .join(' '),
        newRows: row.new_rows ?? 0,
      }))
    },
  })
}

export interface RunManifestInfo {
  sequence: number
  digest: string
  signed: boolean
}

/** The manifest a succeeded run kept, if it has one. */
export function useRunManifest(runId: string | null) {
  return useQuery({
    queryKey: startsKeys.manifest(runId ?? ''),
    enabled: runId !== null,
    queryFn: async (): Promise<RunManifestInfo | null> => {
      const rows = await notebookDataClient.list<{
        sequence: number | string
        manifest_digest: string
        signature: string | null
      }>(
        'pipeline_run_manifests',
        `?select=sequence,manifest_digest,signature&run_id=eq.${encodeURIComponent(runId ?? '')}`,
      )

      const row = rows.at(0)

      return row
        ? {
            sequence: Number(row.sequence),
            digest: row.manifest_digest,
            signed: row.signature !== null,
          }
        : null
    },
  })
}

/** Nudge the people a waiting run asked; answers how many were reminded. */
export function useRemindRun(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (runId: string): Promise<number> =>
      z.number().parse(
        await notebookDataClient.rpc<unknown>('remind_pipeline_run', {
          p_workspace_id: workspaceId,
          p_run_id: runId,
        }),
      ),
    onSuccess: (_count, runId) =>
      queryClient.invalidateQueries({
        queryKey: pipelineDataQueryKeys.runPrompts(runId),
      }),
  })
}

/** Dataset id → name, for the Datasets a start names. */
export function useDatasetNameMap() {
  const query = useQuery({
    queryKey: ['ui-port', 'pipelines', 'trigger-datasets'],
    queryFn: async (): Promise<Map<string, string>> => {
      const rows = await notebookDataClient.list<{ id: string; name: string }>(
        'datasets',
        '?select=id,name&order=name.asc',
      )

      return new Map(rows.map((row) => [row.id, row.name]))
    },
    staleTime: 60_000,
  })

  return query.data ?? new Map<string, string>()
}

/** Is the pipeline's webhook on? Unknown until the endpoint answers. */
export function useWebhookOn(definitionId: string): boolean {
  const state = useQuery({
    queryKey: webhookKey(definitionId),
    queryFn: () => webhookRequest(definitionId, 'GET'),
    staleTime: 30_000,
    retry: false,
  })

  return state.data?.enabled ?? false
}
