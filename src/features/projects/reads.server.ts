import { z } from 'zod'

import { PROJECTS_READ_TOOL } from './cards'
import { invalid, toolDef } from '#/lib/assistant-lab-tools.server'
import type { LabToolContext } from '#/lib/assistant-lab-tools.server'
import type { ProviderToolDef } from '#/lib/ai-providers/types'
import type { DataClient } from '#/lib/data-client'

/**
 * What the assistant can read about projects, folders, follows, the audit log
 * and SQL logins, as areas of `sheetbase.projects.read`. Each reads through the
 * same calls as the app, as the signed-in person.
 */
export const PROJECTS_LAB_AREAS = {
  projects:
    'Projects with their client, lead, how many records and experiments each holds and when it last changed (openOnly: only those not archived; query narrows by name, key or client)',
  folders:
    'Folders in projects, with the folder each sits in (query narrows by folder name)',
  followed_records:
    'The records the person follows, whose changes show in their Inbox',
  audit_log:
    'The audit log: who changed what and when, newest first (query looks in what changed). Admin entries are for owners, admins and stewards',
  sql_logins:
    'Read-only SQL logins: the person’s own, or everyone’s for an owner or admin, with their status (openOnly: only those that still work). Never passwords',
} as const

export type ProjectsLabArea = keyof typeof PROJECTS_LAB_AREAS

const isProjectsArea = (area: string): area is ProjectsLabArea =>
  Object.hasOwn(PROJECTS_LAB_AREAS, area)

const words = (query: string | undefined) =>
  (query ?? '').toLowerCase().split(/\s+/).filter(Boolean)

const matches = (text: string, query: string | undefined) =>
  words(query).every((word) => text.toLowerCase().includes(word))

/** Lists one of this area's reads, or null when the area is not one of them. */
export async function listProjectsArea(
  input: { area: string; query?: string; openOnly?: boolean; limit?: number },
  context: { client: DataClient; workspaceId: string },
): Promise<string | null> {
  if (!isProjectsArea(input.area)) return null
  const { client, workspaceId } = context
  const limit = input.limit ?? 20

  const answer = (items: unknown[], page: string, note?: string) => {
    const result = {
      area: input.area,
      items,
      returned: items.length,
      page,
    }

    if (note) return JSON.stringify({ ...result, note })

    return JSON.stringify(result)
  }

  switch (input.area) {
    case 'projects': {
      const rows = await client.rpc<
        Array<{
          id: string
          display_id: string | null
          key: string
          title: string
          client_name: string | null
          lead_name: string | null
          archived_at: string | null
          record_count: number
          experiment_count: number
          last_activity_at: string | null
        }>
      >('project_list_summary', {})

      const items = rows
        .filter((row) => !input.openOnly || row.archived_at === null)
        .filter((row) =>
          matches(
            `${row.title} ${row.key} ${row.display_id ?? ''} ${row.client_name ?? ''}`,
            input.query,
          ),
        )
        .slice(0, limit)
        .map((row) => ({
          id: row.id,
          display_id: row.display_id,
          title: row.title,
          client: row.client_name,
          lead: row.lead_name,
          archived: row.archived_at !== null,
          records: row.record_count,
          experiments: row.experiment_count,
          last_activity_at: row.last_activity_at,
        }))

      return answer(items, '/projects')
    }

    case 'folders': {
      const rows = await client.list<{
        id: string
        project_id: string
        parent_id: string | null
        name: string
      }>(
        'folders',
        '?archived_at=is.null&select=id,project_id,parent_id,name&order=name.asc&limit=200',
      )

      const items = rows
        .filter((row) => matches(row.name, input.query))
        .slice(0, limit)

      return answer(items, '/projects')
    }

    case 'followed_records': {
      const rows = await client.list<{ record_id: string; created_at: string }>(
        'work_item_follows',
        `?select=record_id,created_at&order=created_at.desc&limit=${limit}`,
      )

      return answer(
        rows,
        '/inbox',
        'Each item names a record: read more with the record tools, or open it.',
      )
    }

    case 'audit_log': {
      const page = await client.rpc<{ events: unknown[] }>('audit_events', {
        p_search: input.query ?? null,
        p_limit: limit,
      })

      return answer(page.events, '/settings/workspace/audit')
    }

    case 'sql_logins': {
      const rows = await client.rpc<
        Array<{ name: string; username: string; status: string }>
      >('list_sql_logins', { p_workspace_id: workspaceId })

      const items = rows
        .filter((row) => !input.openOnly || row.status === 'active')
        .filter((row) => matches(`${row.name} ${row.username}`, input.query))
        .slice(0, limit)

      return answer(items, '/settings/account/api')
    }
  }
}

// SAFETY: The literal above has only these string keys and is non-empty.
const AREA_NAMES = Object.keys(PROJECTS_LAB_AREAS) as [
  ProjectsLabArea,
  ...ProjectsLabArea[],
]

export const projectsReadSchema = z.strictObject({
  area: z.enum(AREA_NAMES).describe(
    Object.entries(PROJECTS_LAB_AREAS)
      .map(([key, text]) => `${key}: ${text}`)
      .join('. '),
  ),
  query: z.string().max(200).optional(),
  openOnly: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).optional(),
})

export function projectsReadDefs(): ProviderToolDef[] {
  return [
    toolDef(
      PROJECTS_READ_TOOL,
      'Read projects, folders, the records the person follows, the audit log or read-only SQL logins.',
      projectsReadSchema,
    ),
  ]
}

export const isProjectsReadTool = (name: string): boolean =>
  name === PROJECTS_READ_TOOL

export async function runProjectsReadTool(
  _name: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw tool input is immediately checked by projectsReadSchema before use.
  args: unknown,
  context: LabToolContext,
): Promise<{ text: string; isError: boolean }> {
  const parsed = projectsReadSchema.safeParse(args)

  if (!parsed.success) return { text: invalid(parsed.error), isError: true }

  try {
    const text = await listProjectsArea(parsed.data, context)

    return { text: text ?? 'Unknown area.', isError: text === null }
  } catch {
    return { text: 'That could not be read just now.', isError: true }
  }
}
