/**
 * What the assistant can list about pipeline connections: their names,
 * addresses, status and the names of their secrets (never the values).
 */
import { z } from 'zod'

import type { ProviderToolDef } from '#/lib/ai-providers/types'
import { invalid, likeValue, toolDef } from '#/lib/assistant-lab-tools.server'
import type { LabToolContext } from '#/lib/assistant-lab-tools.server'

import { CONNECTIONS_READ_TOOL } from './cards'

const readSchema = z.strictObject({
  query: z.string().max(120).optional().describe('Words in the name or key.'),
  openOnly: z.boolean().optional().describe('Only connections switched on.'),
  limit: z.number().int().min(1).max(50).optional(),
})

export function pipelineConnectionsReadDefs(): ProviderToolDef[] {
  return [
    toolDef(
      CONNECTIONS_READ_TOOL,
      'List the addresses pipeline web calls may reach: name, key, https address, whether each is on and the names of its stored secrets (never their values).',
      readSchema,
    ),
  ]
}

export function isPipelineConnectionsReadTool(name: string): boolean {
  return name === CONNECTIONS_READ_TOOL
}

export async function runPipelineConnectionsReadTool(
  _name: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw tool input is immediately checked by readSchema before use.
  args: unknown,
  context: LabToolContext,
): Promise<{ text: string; isError: boolean }> {
  const parsed = readSchema.safeParse(args)

  if (!parsed.success) return { text: invalid(parsed.error), isError: true }
  const input = parsed.data

  const params = [
    'select=id,key,name,description,base_url,status,secret_names,updated_at',
    'order=name.asc',
    `limit=${input.limit ?? 20}`,
  ]

  if (input.query) {
    const like = likeValue(input.query)
    params.push(`or=(name.ilike.${like},key.ilike.${like})`)
  }

  if (input.openOnly) params.push('status=eq.active')

  try {
    const items = await context.client.list<z.core.util.JSONType>(
      'pipeline_connections',
      `?${params.join('&')}`,
    )

    return {
      text: JSON.stringify({
        items,
        returned: items.length,
        page: '/settings/workspace/integrations',
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
