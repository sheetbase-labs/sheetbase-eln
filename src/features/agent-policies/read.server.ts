/**
 * What the assistant can list about agents: the agents themselves, what each
 * action is set to, the signed policy history and the operation policies.
 * Requests and checks are on `sheetbase.lab.list`.
 */
import { z } from 'zod'

import { invalid, likeValue, toolDef } from '#/lib/assistant-lab-tools.server'
import type { LabToolContext } from '#/lib/assistant-lab-tools.server'
import type { ProviderToolDef } from '#/lib/ai-providers/types'

import { AGENTS_READ_TOOL } from './feature'

const AREAS = {
  agents:
    'The agents on the Agents page: name, AG- number, what starts them and whether each is on (openOnly: only those switched on)',
  agent_permissions:
    'What agents may do on their own: each lab action set to Auto, Ask or Never for everyone, a role or one service credential. An action that is not listed is Ask',
  agent_policy_history:
    'The numbered, signed changes to the agents’ policy: what changed, why and when',
  agent_operation_policies:
    'Policies that let one service credential run one kind of draft on its own, within limits (openOnly: only those still on)',
} as const

type Area = keyof typeof AREAS

const OPEN_ONLY: Partial<Record<Area, string>> = {
  agents: 'enabled=is.true',
  agent_operation_policies: 'enabled=is.true',
}

const SPECS: Record<
  Area,
  {
    table: string
    select: string
    order: string
    search: string[]
    page: string
  }
> = {
  agents: {
    table: 'agent_definitions',
    select:
      'id,display_id,name,kind,description,trigger_label,owner_user_id,enabled,updated_at',
    order: 'display_id.asc',
    search: ['name', 'display_id', 'description'],
    page: '/pipelines/agents',
  },
  agent_permissions: {
    table: 'agent_action_policies',
    select: 'id,action_key,subject_kind,role,credential_id,level,updated_at',
    order: 'action_key.asc',
    search: ['action_key'],
    page: '/settings/workspace/ai',
  },
  agent_policy_history: {
    table: 'agent_policy_revisions',
    select:
      'id,revision,summary,change_ref,reason,changed_by_user_id,changed_at',
    order: 'revision.desc',
    search: ['summary', 'reason'],
    page: '/pipelines/agents',
  },
  agent_operation_policies: {
    table: 'agent_operation_policies',
    select:
      'id,name,operation_kind,target_type,limits,enabled,credential_id,signed_at',
    order: 'name.asc',
    search: ['name'],
    page: '/pipelines/agents',
  },
}

const agentsReadSchema = z
  .object({
    area: z.enum(Object.keys(AREAS) as [Area, ...Area[]]).describe(
      Object.entries(AREAS)
        .map(([key, text]) => `${key}: ${text}`)
        .join('. '),
    ),
    query: z
      .string()
      .max(120)
      .optional()
      .describe('Words in the name, number or action to narrow the list.'),
    openOnly: z.boolean().optional(),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict()

export function agentsReadDefs(): ProviderToolDef[] {
  return [
    toolDef(
      AGENTS_READ_TOOL,
      'List the agents and what they may do: the agents on the Agents page, what each lab action is set to (Auto, Ask or Never), the signed policy history and the operation policies. Each item has an id to propose a change with.',
      agentsReadSchema,
    ),
  ]
}

export function isAgentsReadTool(name: string): boolean {
  return name === AGENTS_READ_TOOL
}

export async function runAgentsReadTool(
  _name: string,
  args: unknown,
  context: LabToolContext,
): Promise<{ text: string; isError: boolean }> {
  const parsed = agentsReadSchema.safeParse(args)
  if (!parsed.success) return { text: invalid(parsed.error), isError: true }
  const input = parsed.data
  const spec = SPECS[input.area]
  const params = [
    `select=${spec.select}`,
    `order=${spec.order}`,
    `limit=${input.limit ?? 20}`,
  ]
  if (input.query) {
    const like = likeValue(input.query)
    params.push(
      `or=(${spec.search.map((column) => `${column}.ilike.${like}`).join(',')})`,
    )
  }
  const open = OPEN_ONLY[input.area]
  if (input.openOnly && open) params.push(open)
  try {
    const items = await context.client.list<Record<string, unknown>>(
      spec.table,
      `?${params.join('&')}`,
    )
    return {
      text: JSON.stringify({
        area: input.area,
        items,
        returned: items.length,
        page: spec.page,
      }),
      isError: false,
    }
  } catch (error) {
    return {
      text: error instanceof Error ? error.message : 'Could not read that.',
      isError: true,
    }
  }
}
