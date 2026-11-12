import { z } from 'zod'

import { PIPELINE_REMOTE_READ_TOOL } from './cards'
import { invalid, toolDef } from '#/lib/assistant-lab-tools.server'
import type { LabToolContext } from '#/lib/assistant-lab-tools.server'
import type { LakehouseSettings } from '#/lib/pipelines/remote/client'
import type { ProviderToolDef } from '#/lib/ai-providers/types'

/**
 * What the assistant can read about remote jobs and lakehouse SQL, as areas of
 * `sheetbase.pipeline_remote.read`, through the same calls as the app and as
 * the signed-in person.
 */
export const PIPELINE_REMOTE_READ_AREAS = {
  remote_jobs:
    'Jobs pipeline runs sent to an HPC queue, newest first: state, queue, why one failed and when it must finish (openOnly: only those still going)',
  lakehouse:
    'Whether pipeline steps may run SQL over open tables, whether open tables are on, and how many are ready',
} as const

export type PipelineRemoteReadArea = keyof typeof PIPELINE_REMOTE_READ_AREAS

export const pipelineRemoteReadSchema = z.strictObject({
  area: z.enum(['remote_jobs', 'lakehouse']).describe(
    Object.entries(PIPELINE_REMOTE_READ_AREAS)
      .map(([key, text]) => `${key}: ${text}`)
      .join('. '),
  ),
  openOnly: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).optional(),
})

export function pipelineRemoteReadDefs(): ProviderToolDef[] {
  return [
    toolDef(
      PIPELINE_REMOTE_READ_TOOL,
      'Read jobs pipelines sent to an HPC queue, or whether pipeline steps may run SQL over open tables.',
      pipelineRemoteReadSchema,
    ),
  ]
}

/** One job as the assistant is shown it. */
interface RemoteJobListRow {
  id: string
  run_id: string
  step_name: string
  connection_key: string
  queue: string
  state: string
  reason: string | null
  message: string | null
  limit_minutes: number
  deadline_at: string
  result_rows: number | null
  submitted_at: string
  finished_at: string | null
}

export const isPipelineRemoteReadTool = (name: string): boolean =>
  name === PIPELINE_REMOTE_READ_TOOL

export async function listPipelineRemoteArea(
  input: z.infer<typeof pipelineRemoteReadSchema>,
  context: LabToolContext,
): Promise<string> {
  const { client, workspaceId } = context

  if (input.area === 'lakehouse') {
    const settings = await client.rpc<LakehouseSettings>(
      'pipeline_lakehouse_settings',
      { p_workspace_id: workspaceId },
    )

    return JSON.stringify({
      area: input.area,
      items: [settings],
      returned: 1,
      page: '/settings/workspace/open-data',
    })
  }

  const open = input.openOnly ? '&state=in.(submitted,running)' : ''

  const rows = await client.list<RemoteJobListRow>(
    'pipeline_remote_jobs',
    `?select=id,run_id,step_name,connection_key,queue,state,reason,message,limit_minutes,deadline_at,result_rows,submitted_at,finished_at${open}&order=submitted_at.desc&limit=${input.limit ?? 20}`,
  )

  return JSON.stringify({
    area: input.area,
    items: rows,
    returned: rows.length,
    page: '/pipelines',
  })
}

export async function runPipelineRemoteReadTool(
  _name: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw tool input is immediately checked by pipelineRemoteReadSchema before use.
  args: unknown,
  context: LabToolContext,
): Promise<{ text: string; isError: boolean }> {
  const parsed = pipelineRemoteReadSchema.safeParse(args)

  if (!parsed.success) return { text: invalid(parsed.error), isError: true }

  try {
    return {
      text: await listPipelineRemoteArea(parsed.data, context),
      isError: false,
    }
  } catch {
    return { text: 'That could not be read just now.', isError: true }
  }
}
