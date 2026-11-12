import type { ProviderToolDef } from '#/lib/ai-providers/types'
import { likeValue, toolDef } from '#/lib/assistant-lab-tools.server'
import type { LabToolContext } from '#/lib/assistant-lab-tools.server'
import type { AssistantProposal } from '#/lib/assistant-proposals'
import { parse, pick } from '#/lib/assistant-upkeep.server'
import type { Lookup } from '#/lib/assistant-upkeep.server'
import type { DataClient } from '#/lib/data-client'

import {
  PARAMETER_SET_DELETE_TOOL,
  PARAMETER_SET_PROPOSE_TOOL_NAMES,
  PARAMETER_SET_SAVE_TOOL,
  proposeParameterSetDeleteSchema,
  proposeParameterSetSaveSchema,
} from './cards'
import type { ParameterSetAction, ParameterSetProposeToolName } from './cards'

/**
 * Cards for parameter sets (see `cards.ts`). Each builder finds the set the
 * model named under the signed-in person's own access and returns a card that
 * says what changes. Nothing is written here; the button runs the RPC.
 */

type Outcome =
  { ok: true; proposal: AssistantProposal } | { ok: false; message: string }

const NOTE =
  'The person sees a card and presses a button to do it; nothing changes until they do.'

const PAGE = '/pipelines/parameter-sets'

interface SetRow {
  id: string
  key: string
  name: string
  parameters: Array<{ name: string }>
}

export function isParameterSetProposalTool(
  name: string,
): name is ParameterSetProposeToolName {
  return PARAMETER_SET_PROPOSE_TOOL_NAMES.includes(name)
}

export function parameterSetProposalDefs(): ProviderToolDef[] {
  return [
    toolDef(
      PARAMETER_SET_SAVE_TOOL,
      `Propose saving a reusable parameter set: a named list of parameters (name, type, default) that pipelines include by key. A set with that key is replaced; versions already saved keep their copy. For stewards, admins and owners. ${NOTE}`,
      proposeParameterSetSaveSchema,
    ),
    toolDef(
      PARAMETER_SET_DELETE_TOOL,
      `Propose deleting a parameter set. Versions that included it keep their copy. ${NOTE}`,
      proposeParameterSetDeleteSchema,
    ),
  ]
}

async function findSet(
  client: DataClient,
  text: string,
): Promise<Lookup<SetRow>> {
  const like = likeValue(text)

  const rows = await client.list<SetRow>(
    'pipeline_parameter_sets',
    `?or=(name.ilike.${like},key.ilike.${like})&select=id,key,name,parameters&order=key.asc&limit=6`,
  )

  const lower = text.trim().toLowerCase()

  return pick(
    rows,
    text,
    'parameter set',
    (row) => `${row.name} (${row.key})`,
    (row) => row.key === lower || row.name.toLowerCase() === lower,
  )
}

const names = (parameters: Array<{ name: string }>) =>
  parameters.length ? parameters.map((p) => p.name).join(', ') : 'None'

export async function buildParameterSetProposal(
  name: ParameterSetProposeToolName,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Each tool case parses raw input before using it or accessing data.
  args: unknown,
  context: LabToolContext,
): Promise<Outcome> {
  const { client, workspaceId } = context

  switch (name) {
    case PARAMETER_SET_SAVE_TOOL: {
      const parsed = parse(proposeParameterSetSaveSchema, args)

      if (!parsed.ok) return { ok: false, message: parsed.message }
      const input = parsed.data

      const existing = await client.list<SetRow>(
        'pipeline_parameter_sets',
        `?key=eq.${encodeURIComponent(input.key)}&select=id,key,name,parameters&limit=1`,
      )

      const action: ParameterSetAction = {
        kind: 'parameter_set.save',
        workspaceId,
        key: input.key,
        name: input.name,
        description: input.description ?? null,
        parameters: input.parameters,
      }

      return {
        ok: true,
        proposal: {
          tool: name,
          title: input.title,
          summary: input.summary,
          target: `${input.name} (${input.key})`,
          deepLink: PAGE,
          changes: [
            {
              label: 'Parameters',
              before: existing[0] ? names(existing[0].parameters) : 'New set',
              after: names(input.parameters),
            },
          ],
          action,
        },
      }
    }

    case PARAMETER_SET_DELETE_TOOL: {
      const parsed = parse(proposeParameterSetDeleteSchema, args)

      if (!parsed.ok) return { ok: false, message: parsed.message }
      const found = await findSet(client, parsed.data.set)

      if (!found.ok) return { ok: false, message: found.message }

      return {
        ok: true,
        proposal: {
          tool: name,
          title: parsed.data.title,
          summary: parsed.data.summary,
          target: `${found.value.name} (${found.value.key})`,
          deepLink: PAGE,
          changes: [
            {
              label: 'Parameter set',
              before: names(found.value.parameters),
              after: 'Deleted',
            },
          ],
          action: {
            kind: 'parameter_set.delete',
            workspaceId,
            setId: found.value.id,
          },
        },
      }
    }
  }
}
