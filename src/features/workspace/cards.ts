import { z } from 'zod'

import { WORKSPACE_OPERATIONS } from './operations'
import { assistantToolsFrom } from '#/lib/operations/descriptor'

/**
 * Workspace cards from the assistant: add starter tables, set the join
 * domains, switch the regulated-lab rules, settle a sheet cell conflict and
 * file planner work under a study. The model names things the way the lab
 * does, the server finds them and sends back a card, and nothing happens
 * until the person presses the button, which calls the ordinary RPC as them.
 */

export const STARTER_TABLES_TOOL = 'sheetbase.workspace.add_starter_tables'
export const JOIN_DOMAINS_TOOL = 'sheetbase.workspace.join_domains'
export const REGULATED_LAB_TOOL = 'sheetbase.workspace.regulated_lab'
export const RESOLVE_CONFLICT_TOOL = 'sheetbase.sheet.resolve_conflict'
export const STUDY_ASSIGN_TOOL = 'sheetbase.study.assign_item'

/** The tool names come from the operation declarations, so they cannot drift. */
export const WORKSPACE_PROPOSE_TOOL_NAMES: readonly string[] =
  assistantToolsFrom(WORKSPACE_OPERATIONS, 'propose')

export type WorkspaceProposeToolName =
  | typeof STARTER_TABLES_TOOL
  | typeof JOIN_DOMAINS_TOOL
  | typeof REGULATED_LAB_TOOL
  | typeof RESOLVE_CONFLICT_TOOL
  | typeof STUDY_ASSIGN_TOOL

/** The read tool: join domains, capabilities, conflicts, vocabularies, bulk changes. */
export const WORKSPACE_READ_TOOL = 'sheetbase.workspace.read'
export const WORKSPACE_READ_TOOL_NAMES = [WORKSPACE_READ_TOOL] as const

export const STARTER_TABLE_KEYS = [
  'plate_reader',
  'qpcr',
  'chromatography',
  'cell_counts',
  'general',
] as const

export const JOIN_ROLES = [
  'scientist',
  'analyst',
  'reviewer',
  'viewer',
] as const

const title = z.string().min(1).max(120)
const summary = z.string().min(1).max(400)

export const proposeStarterTablesSchema = z.strictObject({
  title,
  summary,
  tables: z
    .array(z.enum(STARTER_TABLE_KEYS))
    .min(1)
    .max(STARTER_TABLE_KEYS.length)
    .optional()
    .describe('Which starter tables. Leave out for all of them.'),
})

export const proposeJoinDomainsSchema = z.strictObject({
  title,
  summary,
  domains: z
    .array(z.string().min(3).max(200))
    .max(20)
    .describe(
      'The whole list of email domains, such as example.com. An empty list turns joining by domain off.',
    ),
  role: z
    .enum(JOIN_ROLES)
    .optional()
    .describe('The role people join as. Scientist if left out.'),
})

export const proposeRegulatedLabSchema = z.strictObject({
  title,
  summary,
  regulated: z.boolean().describe('True turns the rules on.'),
})

export const proposeResolveConflictSchema = z.strictObject({
  title,
  summary,
  conflict: z
    .string()
    .uuid()
    .describe('The conflict id, from the cell_conflicts area.'),
  keep: z
    .enum(['mine', 'theirs', 'other'])
    .describe(
      'mine keeps the edit made offline, theirs the one already saved, other the value given.',
    ),
  value: z
    .union([z.string().max(2000), z.number(), z.boolean(), z.null()])
    .optional()
    .describe('The value to keep, when keep is other.'),
  reason: z.string().min(1).max(2000).describe('Why this value.'),
})

export const proposeStudyAssignSchema = z.strictObject({
  title,
  summary,
  study: z.string().min(1).max(200).describe('The study, by its ID or title.'),
  workstream: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe('A workstream, by name. Give this or a task.'),
  task: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe('A planner task, by title. Give this or a workstream.'),
})

export type WorkspaceAction =
  | {
      kind: 'workspace.starter_tables'
      workspaceId: string
      keys: string[] | null
    }
  | {
      kind: 'workspace.join_domains'
      workspaceId: string
      domains: string[]
      role: string
    }
  | { kind: 'workspace.regulated_lab'; workspaceId: string; regulated: boolean }
  | {
      kind: 'sheet.resolve_conflict'
      conflictId: string
      value: unknown
      reason: string
      sheetId: string
    }
  | {
      kind: 'study.assign_item'
      studyRecordId: string
      workstreamId: string | null
      taskId: string | null
    }

const KINDS: readonly string[] = [
  'workspace.starter_tables',
  'workspace.join_domains',
  'workspace.regulated_lab',
  'sheet.resolve_conflict',
  'study.assign_item',
]

export function isWorkspaceAction(action: {
  kind: string
}): action is WorkspaceAction {
  return KINDS.includes(action.kind)
}
