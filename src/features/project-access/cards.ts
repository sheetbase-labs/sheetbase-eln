import { z } from 'zod'

import type { RpcCardAction } from '#/lib/assistant-admin-cards'

/**
 * Project access from the assistant. Each is a card: the server finds the
 * project and the person or group, the card says what will change, and
 * nothing happens until the person presses it. The button calls the ordinary
 * RPC as them, so the project's own rules decide whether it is allowed.
 *
 * Add a person with the grant card (`sheetbase.project_access.grant`); these
 * set an exact level or the finer permissions the project page offers.
 */

export const PROJECT_SET_MEMBER_TOOL = 'sheetbase.project.set_member'
export const PROJECT_REMOVE_MEMBER_TOOL = 'sheetbase.project.remove_member'
export const PROJECT_SET_RULE_TOOL = 'sheetbase.project.set_access_rule'
export const PROJECT_REMOVE_RULE_TOOL = 'sheetbase.project.remove_access_rule'
export const PROJECT_SET_DEFAULTS_TOOL = 'sheetbase.project.set_access_defaults'

export const PROJECT_SET_REVIEW_RULES_TOOL =
  'sheetbase.project.set_review_rules'

export const PROJECT_REQUEST_EDIT_TOOL = 'sheetbase.project.request_edit_access'

export const PROJECT_ACCESS_PROPOSE_TOOL_NAMES: readonly string[] = [
  PROJECT_SET_MEMBER_TOOL,
  PROJECT_REMOVE_MEMBER_TOOL,
  PROJECT_SET_RULE_TOOL,
  PROJECT_REMOVE_RULE_TOOL,
  PROJECT_SET_DEFAULTS_TOOL,
  PROJECT_SET_REVIEW_RULES_TOOL,
  PROJECT_REQUEST_EDIT_TOOL,
]

export type ProjectAccessProposeToolName =
  | typeof PROJECT_SET_MEMBER_TOOL
  | typeof PROJECT_REMOVE_MEMBER_TOOL
  | typeof PROJECT_SET_RULE_TOOL
  | typeof PROJECT_REMOVE_RULE_TOOL
  | typeof PROJECT_SET_DEFAULTS_TOOL
  | typeof PROJECT_SET_REVIEW_RULES_TOOL
  | typeof PROJECT_REQUEST_EDIT_TOOL

/** The RPC each card runs. */
export const PROJECT_ACCESS_RPC = {
  'project_access.set_member': 'set_project_member',
  'project_access.remove_member': 'remove_project_member',
  'project_access.set_rule': 'set_project_access_rule',
  'project_access.remove_rule': 'remove_project_access_rule',
  'project_access.set_defaults': 'set_project_access_defaults',
  'project_access.set_review_rules': 'update_project_settings',
  'project_access.request_edit': 'request_project_edit_access',
} as const

export type ProjectAccessAction = RpcCardAction<keyof typeof PROJECT_ACCESS_RPC>

const ACTIONS: ReadonlySet<string> = new Set(Object.keys(PROJECT_ACCESS_RPC))

export function isProjectAccessAction(action: {
  kind: string
}): action is ProjectAccessAction {
  return ACTIONS.has(action.kind)
}

const title = z.string().min(1).max(120)
const summary = z.string().min(1).max(400)

const projectRef = z
  .string()
  .min(1)
  .max(200)
  .describe('The project, by its ID (PRJ-0008), key or name.')

const personRef = z.string().min(1).max(200).describe('The person, by name.')

export const ACCESS_LEVELS = ['owner', 'editor', 'reviewer', 'viewer'] as const

export const proposeProjectSetMemberSchema = z.strictObject({
  title,
  summary,
  project: projectRef,
  person: personRef,
  level: z
    .enum(ACCESS_LEVELS)
    .describe(
      'owner: manages the project. editor: edits. reviewer: reviews. viewer: reads.',
    ),
})

export const proposeProjectRemoveMemberSchema = z.strictObject({
  title,
  summary,
  project: projectRef,
  person: personRef,
})

export const proposeProjectSetRuleSchema = z.strictObject({
  title,
  summary,
  project: projectRef,
  who: z
    .string()
    .min(1)
    .max(200)
    .describe('The person or the group the rule is for, by name.'),
  whoIs: z
    .enum(['person', 'group'])
    .default('person')
    .describe('Whether `who` is a person or a group.'),
  canView: z.boolean().optional().describe('Can open the project.'),
  canEdit: z.boolean().optional().describe('Can change its records.'),
  canReview: z.boolean().optional().describe('Can review its records.'),
  clientPortal: z
    .boolean()
    .optional()
    .describe('Can see it in the client portal.'),
  canManage: z.boolean().optional().describe('Can manage its access.'),
})

export const proposeProjectRemoveRuleSchema = z.strictObject({
  title,
  summary,
  project: projectRef,
  who: z
    .string()
    .min(1)
    .max(200)
    .describe('The person or the group whose rule goes, by name.'),
})

export const proposeProjectSetDefaultsSchema = z.strictObject({
  title,
  summary,
  group: z
    .string()
    .max(200)
    .nullable()
    .describe(
      'The group that can view every project for quality checks, by name. null for none.',
    ),
})

export const proposeProjectReviewRulesSchema = z.strictObject({
  title,
  summary,
  project: projectRef,
  requireEffectiveProtocol: z
    .boolean()
    .optional()
    .describe('Experiments in it must follow a protocol in effect.'),
  requireIndependentReviewer: z
    .boolean()
    .optional()
    .describe('Someone other than the author must review its records.'),
  autoShareToClient: z
    .boolean()
    .optional()
    .describe('Records are shared with the client when they are signed off.'),
})

export const proposeProjectRequestEditSchema = z.strictObject({
  title,
  summary,
  project: projectRef,
  reason: z.string().min(1).max(500).describe('Why edit access is needed.'),
})
