import { z } from 'zod'

import { PROJECTS_OPERATIONS } from './operations'
import { assistantToolsFrom } from '#/lib/operations/descriptor'

/**
 * Projects, folders, following, the audit check and SQL logins from the
 * assistant: edit, archive, restore or copy a project, make, rename or delete a
 * folder and file work in it, move a record to another project, follow a
 * record, check the audit log now, revoke a SQL login.
 *
 * Like the other cards, the model names things the way the lab does, the
 * server finds them and sends back a card, and nothing happens until the
 * person presses the button, which calls the ordinary RPC as them.
 */

export const PROJECT_UPDATE_TOOL = 'sheetbase.project.update'
export const PROJECT_ARCHIVE_TOOL = 'sheetbase.project.archive'
export const PROJECT_RESTORE_TOOL = 'sheetbase.project.restore'
export const PROJECT_COPY_TOOL = 'sheetbase.project.copy_structure'
export const PROJECT_COPY_PLAN_TOOL = 'sheetbase.project.copy_plan'
export const RECORD_MOVE_PROJECT_TOOL = 'sheetbase.record.move_project'
export const FOLDER_CREATE_TOOL = 'sheetbase.folder.create'
export const FOLDER_RENAME_TOOL = 'sheetbase.folder.rename'
export const FOLDER_DELETE_TOOL = 'sheetbase.folder.delete'
export const FOLDER_MOVE_RECORDS_TOOL = 'sheetbase.folder.move_records'
export const FOLDER_MOVE_ITEMS_TOOL = 'sheetbase.folder.move_items'
export const RECORD_FOLLOW_TOOL = 'sheetbase.record.follow'
export const RECORD_UNFOLLOW_TOOL = 'sheetbase.record.unfollow'
export const AUDIT_VERIFY_TOOL = 'sheetbase.audit.verify'
export const SQL_LOGIN_REVOKE_TOOL = 'sheetbase.sql_login.revoke'

/** The tool names come from the operation declarations, so they cannot drift. */
export const PROJECTS_PROPOSE_TOOL_NAMES = assistantToolsFrom(
  PROJECTS_OPERATIONS,
  'propose',
) as readonly string[]

export type ProjectsProposeToolName =
  | typeof PROJECT_UPDATE_TOOL
  | typeof PROJECT_ARCHIVE_TOOL
  | typeof PROJECT_RESTORE_TOOL
  | typeof PROJECT_COPY_TOOL
  | typeof PROJECT_COPY_PLAN_TOOL
  | typeof RECORD_MOVE_PROJECT_TOOL
  | typeof FOLDER_CREATE_TOOL
  | typeof FOLDER_RENAME_TOOL
  | typeof FOLDER_DELETE_TOOL
  | typeof FOLDER_MOVE_RECORDS_TOOL
  | typeof FOLDER_MOVE_ITEMS_TOOL
  | typeof RECORD_FOLLOW_TOOL
  | typeof RECORD_UNFOLLOW_TOOL
  | typeof AUDIT_VERIFY_TOOL
  | typeof SQL_LOGIN_REVOKE_TOOL

const title = z.string().min(1).max(120)
const summary = z.string().min(1).max(400)
const projectRef = z
  .string()
  .min(1)
  .max(200)
  .describe('The project, by name, key or ID such as PRJ-3.')
const recordRef = z
  .string()
  .min(1)
  .max(200)
  .describe('The record, by its ID such as EXP-12 or its title.')
const folderRef = z.string().min(1).max(200).describe('The folder, by name.')
const person = z
  .string()
  .min(1)
  .max(200)
  .describe('The person, by the name people use for them.')
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe('A date, YYYY-MM-DD.')

const details = {
  client: z
    .string()
    .max(200)
    .optional()
    .describe('The client the work is for, by name or code.'),
  modality: z.string().max(100).optional(),
  stage: z.string().max(100).optional(),
  lead: person.optional().describe('The project lead.'),
  reviewer: person.optional().describe('Who reviews by default.'),
  agreement: z
    .string()
    .max(200)
    .optional()
    .describe('The agreement or contract reference.'),
  startedOn: date.optional().describe('When the work started.'),
}

export const proposeProjectUpdateSchema = z
  .object({
    title,
    summary,
    project: projectRef,
    name: z.string().min(1).max(200).optional().describe('A new name.'),
    ...details,
  })
  .strict()

export const proposeProjectStateSchema = z
  .object({ title, summary, project: projectRef })
  .strict()

export const proposeProjectCopySchema = z
  .object({
    title,
    summary,
    source: projectRef.describe('The project whose plan is copied.'),
    name: z.string().min(1).max(200).describe('The new project’s name.'),
    ...details,
  })
  .strict()

export const proposeProjectCopyPlanSchema = z
  .object({
    title,
    summary,
    source: projectRef.describe('The project whose plan is copied.'),
    target: projectRef.describe('The project the plan goes into.'),
    startDate: date.describe('When the copied plan starts.'),
  })
  .strict()

export const proposeRecordMoveProjectSchema = z
  .object({
    title,
    summary,
    record: recordRef,
    project: projectRef.describe('The project it moves to.'),
  })
  .strict()

export const proposeFolderCreateSchema = z
  .object({
    title,
    summary,
    project: projectRef,
    name: z.string().min(1).max(200).describe('The folder’s name.'),
    parent: folderRef.optional().describe('The folder it goes in, if any.'),
  })
  .strict()

export const proposeFolderRenameSchema = z
  .object({
    title,
    summary,
    project: projectRef,
    folder: folderRef,
    name: z.string().min(1).max(200).describe('The new name.'),
  })
  .strict()

export const proposeFolderDeleteSchema = z
  .object({ title, summary, project: projectRef, folder: folderRef })
  .strict()

export const proposeFolderMoveRecordsSchema = z
  .object({
    title,
    summary,
    project: projectRef,
    records: z.array(recordRef).min(1).max(50),
    folder: folderRef
      .optional()
      .describe('The folder. Leave it out to take them out of their folder.'),
  })
  .strict()

export const FOLDER_ITEM_KINDS = [
  'dataset',
  'sheet_instance',
  'analysis_view',
  'pipeline_definition',
] as const

export const proposeFolderMoveItemsSchema = z
  .object({
    title,
    summary,
    project: projectRef,
    items: z
      .array(
        z
          .object({
            kind: z
              .enum(FOLDER_ITEM_KINDS)
              .describe(
                'dataset, sheet_instance (a sheet), analysis_view or pipeline_definition (a pipeline).',
              ),
            name: z.string().min(1).max(200),
          })
          .strict(),
      )
      .min(1)
      .max(50),
    folder: folderRef
      .optional()
      .describe('The folder. Leave it out to take them out of their folder.'),
  })
  .strict()

export const proposeRecordFollowSchema = z
  .object({ title, summary, record: recordRef })
  .strict()

export const proposeAuditVerifySchema = z.object({ title, summary }).strict()

export const proposeSqlLoginRevokeSchema = z
  .object({
    title,
    summary,
    login: z
      .string()
      .min(1)
      .max(200)
      .describe('The login, by its name or username.'),
  })
  .strict()

export type ProjectsAction =
  | {
      kind: 'project.update'
      projectId: string
      expectedRevision: number
      fields: Record<string, string | null>
    }
  | { kind: 'project.archive' | 'project.restore'; projectId: string }
  | {
      kind: 'project.copy'
      sourceId: string
      expectedRevision: number
      name: string
      fields: Record<string, string | null>
    }
  | {
      kind: 'project.copy_plan'
      sourceId: string
      targetId: string
      startDate: string
    }
  | {
      kind: 'record.move_project'
      recordId: string
      projectId: string
      expectedMetadataVersion: number
    }
  | {
      kind: 'folder.create'
      projectId: string
      name: string
      parentId: string | null
    }
  | { kind: 'folder.rename'; projectId: string; folderId: string; name: string }
  | { kind: 'folder.delete'; projectId: string; folderId: string }
  | {
      kind: 'folder.move_records'
      projectId: string
      recordIds: string[]
      folderId: string | null
    }
  | {
      kind: 'folder.move_items'
      projectId: string
      items: Array<{ kind: (typeof FOLDER_ITEM_KINDS)[number]; id: string }>
      folderId: string | null
    }
  | { kind: 'record.follow' | 'record.unfollow'; recordId: string }
  | { kind: 'audit.verify'; workspaceId: string }
  | { kind: 'sql_login.revoke'; workspaceId: string; loginId: string }

export type ProjectsActionKind = ProjectsAction['kind']

const KINDS: readonly string[] = [
  'project.update',
  'project.archive',
  'project.restore',
  'project.copy',
  'project.copy_plan',
  'record.move_project',
  'folder.create',
  'folder.rename',
  'folder.delete',
  'folder.move_records',
  'folder.move_items',
  'record.follow',
  'record.unfollow',
  'audit.verify',
  'sql_login.revoke',
]

export function isProjectsAction(action: {
  kind: string
}): action is ProjectsAction {
  return KINDS.includes(action.kind)
}

/** The read tool: projects, folders, follows, the audit log and SQL logins. */
export const PROJECTS_READ_TOOL = 'sheetbase.projects.read'
export const PROJECTS_READ_TOOL_NAMES = [PROJECTS_READ_TOOL] as const
