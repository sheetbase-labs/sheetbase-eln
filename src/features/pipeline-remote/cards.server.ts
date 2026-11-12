import {
  LAKEHOUSE_SQL_TOOL,
  PIPELINE_REMOTE_PROPOSE_TOOL_NAMES,
  proposeLakehouseSqlSchema,
} from './cards'
import type { PipelineRemoteProposeToolName } from './cards'
import { toolDef } from '#/lib/assistant-lab-tools.server'
import type { LabToolContext } from '#/lib/assistant-lab-tools.server'
import { parse } from '#/lib/assistant-upkeep.server'
import type { AssistantProposal } from '#/lib/assistant-proposals'
import type { LakehouseSettings } from '#/lib/pipelines/remote/client'
import type { ProviderToolDef } from '#/lib/ai-providers/types'

export type PipelineRemoteOutcome =
  { ok: true; proposal: AssistantProposal } | { ok: false; message: string }

const NOTE =
  'The person sees a card and presses a button to do it; nothing changes until they do.'

export function isPipelineRemoteProposalTool(
  name: string,
): name is PipelineRemoteProposeToolName {
  return PIPELINE_REMOTE_PROPOSE_TOOL_NAMES.includes(name)
}

export function pipelineRemoteProposalDefs(): ProviderToolDef[] {
  return [
    toolDef(
      LAKEHOUSE_SQL_TOOL,
      `Propose letting pipeline steps read the open tables with SQL, or stopping them. For data stewards. ${NOTE}`,
      proposeLakehouseSqlSchema,
    ),
  ]
}

export async function buildPipelineRemoteProposal(
  name: PipelineRemoteProposeToolName,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Each tool case parses raw input before using it or accessing data.
  args: unknown,
  context: LabToolContext,
): Promise<PipelineRemoteOutcome> {
  const { client, workspaceId } = context
  const parsed = parse(proposeLakehouseSqlSchema, args)

  if (!parsed.ok) return { ok: false, message: parsed.message }
  const input = parsed.data

  const settings = await client.rpc<LakehouseSettings>(
    'pipeline_lakehouse_settings',
    { p_workspace_id: workspaceId },
  )

  if (settings.enabled === input.enabled)
    return {
      ok: false,
      message: `SQL over open tables is already ${settings.enabled ? 'on' : 'off'} for pipelines.`,
    }

  return {
    ok: true,
    proposal: {
      tool: name,
      title: input.title,
      summary: input.summary,
      target: 'Lakehouse SQL in pipelines',
      deepLink: '/settings/workspace/open-data',
      changes: [
        {
          label: 'Pipelines can read open tables with SQL',
          before: settings.enabled ? 'On' : 'Off',
          after: input.enabled ? 'On' : 'Off',
        },
      ],
      action: {
        kind: 'pipeline.lakehouse_sql',
        workspaceId,
        enabled: input.enabled,
      },
    },
  }
}
