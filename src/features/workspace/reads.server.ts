import { z } from 'zod'

import { WORKSPACE_READ_TOOL } from './cards'
import { invalid, toolDef } from '#/lib/assistant-lab-tools.server'
import type { LabToolContext } from '#/lib/assistant-lab-tools.server'
import type { ProviderToolDef } from '#/lib/ai-providers/types'

/**
 * What the assistant can read about the workspace's set-up, as areas of
 * `sheetbase.workspace.read`. Each reads through the same calls as the app,
 * as the signed-in person.
 */
export const WORKSPACE_READ_AREAS = {
  join_domains:
    'The email domains whose people can join the workspace themselves, and the role they join as',
  capabilities:
    'What the person may do here, such as editing tables or managing pipelines',
  cell_conflicts:
    'Sheet cells that changed in two places while one was offline, with both values (openOnly: only those not settled yet)',
  vocabularies:
    'Every category field and its terms (query narrows by field or term)',
  configuration_changes:
    'Configuration changes made in bulk, newest first, with who made them',
} as const

export type WorkspaceReadArea = keyof typeof WORKSPACE_READ_AREAS

const AREA_NAMES = Object.keys(WORKSPACE_READ_AREAS) as [
  WorkspaceReadArea,
  ...WorkspaceReadArea[],
]

export const workspaceReadSchema = z
  .object({
    area: z.enum(AREA_NAMES).describe(
      Object.entries(WORKSPACE_READ_AREAS)
        .map(([key, text]) => `${key}: ${text}`)
        .join('. '),
    ),
    query: z.string().max(200).optional(),
    openOnly: z.boolean().optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict()

export function workspaceReadDefs(): ProviderToolDef[] {
  return [
    toolDef(
      WORKSPACE_READ_TOOL,
      'Read the workspace set-up: join domains, what the person may do, sheet cell conflicts, category fields and their terms, or bulk configuration changes.',
      workspaceReadSchema,
    ),
  ]
}

export const isWorkspaceReadTool = (name: string): boolean =>
  name === WORKSPACE_READ_TOOL

const words = (query: string | undefined) =>
  (query ?? '').toLowerCase().split(/\s+/).filter(Boolean)

export async function listWorkspaceArea(
  input: z.infer<typeof workspaceReadSchema>,
  context: LabToolContext,
): Promise<string> {
  const { client, workspaceId } = context
  const limit = input.limit ?? 20
  const answer = (items: unknown[], page: string, note?: string) =>
    JSON.stringify({
      area: input.area,
      items,
      returned: items.length,
      page,
      ...(note ? { note } : {}),
    })
  switch (input.area) {
    case 'join_domains': {
      const rows = await client.list<{ domain: string; role: string }>(
        'workspace_join_domains',
        '?select=domain,role&order=domain.asc',
      )
      return answer(rows, '/settings/workspace/members')
    }
    case 'capabilities': {
      const rows = await client.rpc<string[]>('list_capabilities', {
        p_workspace_id: workspaceId,
      })
      return answer(rows, '/settings/account')
    }
    case 'cell_conflicts': {
      const state = input.openOnly ? '&state=eq.open' : ''
      const rows = await client.list<Record<string, unknown>>(
        'sheet_cell_conflicts',
        `?select=id,sheet_instance_id,row_key,field_id,local_value,local_at,remote_value,remote_at,state,resolved_value,reason${state}&order=created_at.desc&limit=${limit}`,
      )
      return answer(
        rows,
        '/sheets',
        'Settle one with sheetbase.sheet.resolve_conflict, by its id.',
      )
    }
    case 'vocabularies': {
      const page = await client.rpc<{ items?: unknown[] }>(
        'list_configuration_vocabularies',
        { p_workspace_id: workspaceId, p_limit: 200, p_offset: 0 },
      )
      const wanted = words(input.query)
      const items = (page.items ?? [])
        .filter((item) => {
          const text = JSON.stringify(item).toLowerCase()
          return wanted.every((word) => text.includes(word))
        })
        .slice(0, limit)
      return answer(items, '/models')
    }
    case 'configuration_changes': {
      const rows = await client.list<Record<string, unknown>>(
        'configuration_change_log',
        `?select=id,kind,actor_user_id,created_at,result&order=created_at.desc&limit=${limit}`,
      )
      return answer(rows, '/settings/workspace/audit')
    }
  }
}

export async function runWorkspaceReadTool(
  _name: string,
  args: unknown,
  context: LabToolContext,
): Promise<{ text: string; isError: boolean }> {
  const parsed = workspaceReadSchema.safeParse(args)
  if (!parsed.success) return { text: invalid(parsed.error), isError: true }
  try {
    return {
      text: await listWorkspaceArea(parsed.data, context),
      isError: false,
    }
  } catch {
    return { text: 'That could not be read just now.', isError: true }
  }
}
