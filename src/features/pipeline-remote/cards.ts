import { z } from 'zod'

import { PIPELINE_REMOTE_OPERATIONS } from './operations'
import { assistantToolsFrom } from '#/lib/operations/descriptor'

/**
 * Cards from the assistant for the lakehouse SQL switch. The model names what
 * the person wants, the server sends back a card, and nothing happens until the
 * person presses the button, which calls the ordinary RPC as them.
 */

export const LAKEHOUSE_SQL_TOOL = 'sheetbase.pipeline_remote.lakehouse_sql'

/** The tool names come from the operation declarations, so they cannot drift. */
export const PIPELINE_REMOTE_PROPOSE_TOOL_NAMES: readonly string[] =
  assistantToolsFrom(PIPELINE_REMOTE_OPERATIONS, 'propose')

export type PipelineRemoteProposeToolName = typeof LAKEHOUSE_SQL_TOOL

/** The read tool: remote jobs and the lakehouse switch. */
export const PIPELINE_REMOTE_READ_TOOL = 'sheetbase.pipeline_remote.read'

export const PIPELINE_REMOTE_READ_TOOL_NAMES = [
  PIPELINE_REMOTE_READ_TOOL,
] as const

export const proposeLakehouseSqlSchema = z.strictObject({
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(400),
  enabled: z
    .boolean()
    .describe('True lets pipeline steps read open tables with SQL.'),
})

export type PipelineRemoteAction = {
  kind: 'pipeline.lakehouse_sql'
  workspaceId: string
  enabled: boolean
}

const KINDS: readonly string[] = ['pipeline.lakehouse_sql']

export function isPipelineRemoteAction(action: {
  kind: string
}): action is PipelineRemoteAction {
  return KINDS.includes(action.kind)
}
