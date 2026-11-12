import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'

import type { PipelineParameter } from '#/lib/pipelines/config'
import { notebookDataClient } from '#/lib/notebook-data'
import type { DataClient } from '#/lib/data-client'

/** A reusable parameter set as the table holds it. */
export interface ParameterSetRow {
  id: string
  key: string
  name: string
  description: string | null
  parameters: PipelineParameter[]
  updated_at: string
}

export const parameterSetKeys = {
  list: ['ui-port', 'pipelines', 'parameter-sets'] as const,
}

export async function listParameterSets(
  client: DataClient,
): Promise<ParameterSetRow[]> {
  return client.list<ParameterSetRow>(
    'pipeline_parameter_sets',
    '?select=id,key,name,description,parameters,updated_at&order=key.asc',
  )
}

export function usePipelineParameterSets(
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: parameterSetKeys.list,
    queryFn: () => listParameterSets(client),
    staleTime: 30_000,
  })
}

/** The sets by key: what a version file's `include:` is read against. */
export function setsByKey(
  rows: readonly ParameterSetRow[],
): Record<string, PipelineParameter[]> {
  return Object.fromEntries(rows.map((row) => [row.key, row.parameters]))
}

const savedSchema = z.looseObject({ id: z.string() })

export async function saveParameterSet(
  client: DataClient,
  input: {
    workspaceId: string
    key: string
    name: string
    description: string | null
    parameters: PipelineParameter[]
  },
) {
  return savedSchema.parse(
    await client.rpc('save_pipeline_parameter_set', {
      p_workspace_id: input.workspaceId,
      p_key: input.key,
      p_name: input.name,
      p_parameters: input.parameters,
      p_description: input.description,
    }),
  )
}

export async function deleteParameterSet(
  client: DataClient,
  workspaceId: string,
  setId: string,
) {
  await client.rpc('delete_pipeline_parameter_set', {
    p_workspace_id: workspaceId,
    p_set_id: setId,
  })
}
