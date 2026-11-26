import { z } from 'zod'

import { updateAiSettingsSchema } from '#/lib/ai-settings'
import type { RpcCardAction } from '#/lib/assistant-admin-cards'
import { SETTINGS_ACCESS_ROLES, SETTINGS_AREAS } from '#/lib/settings-access'

/**
 * Workspace settings from the assistant. Each is a card that says what will
 * change and does nothing until the person presses it; the button calls the
 * ordinary RPC as them, so the settings area's own access rules decide.
 */

export const WORKSPACE_RULES_TOOL = 'sheetbase.workspace.set_rules'
export const WORKSPACE_AI_TOOL = 'sheetbase.workspace.set_ai'
export const WORKSPACE_ID_PREFIXES_TOOL = 'sheetbase.workspace.set_id_prefixes'
export const WORKSPACE_DATA_ACCESS_TOOL = 'sheetbase.workspace.set_data_access'
export const WORKSPACE_PUBLISHING_TOOL = 'sheetbase.workspace.set_publishing'
export const SCHEDULER_HOURS_TOOL = 'sheetbase.scheduler.set_hours'
export const SETTINGS_ACCESS_TOOL = 'sheetbase.settings_access.set'
export const GROUP_ROLE_ADOPT_TOOL = 'sheetbase.group_role.adopt'
export const OPEN_TABLES_REFRESH_TOOL = 'sheetbase.open_tables.refresh'
export const OPEN_TABLES_REVOKE_TOOL = 'sheetbase.open_tables.revoke_login'
export const ONTOLOGY_LOOKUP_TOOL = 'sheetbase.ontology.set_lookup'
export const PLUGIN_POINT_TOOL = 'sheetbase.plugin.set_point'

export const WORKSPACE_SETTINGS_PROPOSE_TOOL_NAMES: readonly string[] = [
  WORKSPACE_RULES_TOOL,
  WORKSPACE_AI_TOOL,
  WORKSPACE_ID_PREFIXES_TOOL,
  WORKSPACE_DATA_ACCESS_TOOL,
  WORKSPACE_PUBLISHING_TOOL,
  SCHEDULER_HOURS_TOOL,
  SETTINGS_ACCESS_TOOL,
  GROUP_ROLE_ADOPT_TOOL,
  OPEN_TABLES_REFRESH_TOOL,
  OPEN_TABLES_REVOKE_TOOL,
  ONTOLOGY_LOOKUP_TOOL,
  PLUGIN_POINT_TOOL,
]

export type WorkspaceSettingsProposeToolName =
  | typeof WORKSPACE_RULES_TOOL
  | typeof WORKSPACE_AI_TOOL
  | typeof WORKSPACE_ID_PREFIXES_TOOL
  | typeof WORKSPACE_DATA_ACCESS_TOOL
  | typeof WORKSPACE_PUBLISHING_TOOL
  | typeof SCHEDULER_HOURS_TOOL
  | typeof SETTINGS_ACCESS_TOOL
  | typeof GROUP_ROLE_ADOPT_TOOL
  | typeof OPEN_TABLES_REFRESH_TOOL
  | typeof OPEN_TABLES_REVOKE_TOOL
  | typeof ONTOLOGY_LOOKUP_TOOL
  | typeof PLUGIN_POINT_TOOL

/**
 * The RPC each card runs. The AI card goes through the app's own server
 * function instead (it checks the provider and keeps the audit record), and
 * the roles card runs one RPC per role; both are handled in `cards-run.ts`.
 */
export const WORKSPACE_SETTINGS_RPC = {
  'workspace_settings.rules': 'update_workspace_settings',
  'workspace_settings.ai': 'update_workspace_ai_settings',
  'workspace_settings.id_prefixes': 'update_workspace_id_prefixes',
  'workspace_settings.data_access': 'update_workspace_data_access_roles',
  'workspace_settings.publishing': 'update_workspace_publication_policy',
  'workspace_settings.hours': 'set_scheduler_settings',
  'workspace_settings.access': 'set_settings_access',
  'workspace_settings.adopt_groups': 'adopt_group_roles',
  'workspace_settings.refresh_tables': 'request_lake_refresh',
  'workspace_settings.revoke_login': 'revoke_lake_credential',
  'workspace_settings.ontology': 'set_ontology_settings',
  'workspace_settings.plugin_point': 'set_extension_point_enabled',
} as const

export type WorkspaceSettingsAction = RpcCardAction<
  keyof typeof WORKSPACE_SETTINGS_RPC
>

const ACTIONS: ReadonlySet<string> = new Set(
  Object.keys(WORKSPACE_SETTINGS_RPC),
)

export function isWorkspaceSettingsAction(action: {
  kind: string
}): action is WorkspaceSettingsAction {
  return ACTIONS.has(action.kind)
}

const title = z.string().min(1).max(120)
const summary = z.string().min(1).max(400)

export const proposeWorkspaceRulesSchema = z.strictObject({
  title,
  summary,
  registrationMode: z
    .enum(['open', 'invitation_only'])
    .optional()
    .describe('Who can join: anyone with the address, or only the invited.'),
  reviewWorkflow: z
    .boolean()
    .optional()
    .describe('Whether records go through review.'),
  auditRetentionDays: z
    .number()
    .int()
    .min(1)
    .max(36_500)
    .optional()
    .describe('How many days the audit trail is kept.'),
  requireChangeReason: z
    .boolean()
    .optional()
    .describe('A changed value needs a reason.'),
  lockOnSign: z
    .boolean()
    .optional()
    .describe('An approving signature locks the record.'),
  allowOfflineEditing: z
    .boolean()
    .optional()
    .describe('Devices may hold unsynced drafts.'),
})

export const proposeWorkspaceAiSchema = z.strictObject({
  title,
  summary,
  enabled: z.boolean().optional().describe('Turn the AI assistant on or off.'),
  providerProfile: z
    .string()
    .min(1)
    .max(80)
    .nullable()
    .optional()
    .describe('The AI provider profile, by its id; null for the built-in one.'),
  model: updateAiSettingsSchema.shape.model.optional(),
  allowCloud: z
    .boolean()
    .optional()
    .describe(
      'Allow sending lab data to outside AI services. Only set it when the person asked for it.',
    ),
  maxTokensPerCall: z.number().int().min(1).optional(),
  maxCostMicrousdPerCall: z.number().int().min(0).optional(),
})

export const proposeWorkspaceIdPrefixesSchema = z.strictObject({
  title,
  summary,
  prefixes: z
    .record(
      z
        .string()
        .regex(/^[a-z][a-z0-9_]{0,59}$/)
        .describe('The record type key, such as experiment or material.'),
      z
        .string()
        .regex(/^[A-Z][A-Z0-9]{0,9}$/)
        .describe('Its ID prefix, such as EXP or MAT.'),
    )
    .describe('The prefixes to set. Types left out keep theirs.'),
})

export const DATA_ACCESS_ROLES = [
  'owner',
  'admin',
  'steward',
  'scientist',
  'analyst',
  'reviewer',
  'viewer',
] as const

export const proposeWorkspaceDataAccessSchema = z.strictObject({
  title,
  summary,
  roles: z
    .array(z.enum(DATA_ACCESS_ROLES))
    .max(DATA_ACCESS_ROLES.length)
    .describe(
      'Every role that gets data access: the technical view and a personal read-only SQL login. Replaces the list.',
    ),
})

export const proposeWorkspacePublishingSchema = z.strictObject({
  title,
  summary,
  approvalRequired: z
    .boolean()
    .describe('Whether publishing to an outside repository needs approval.'),
})

const clock = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/)
  .describe('A time of day, HH:MM.')

export const WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const

export const proposeSchedulerHoursSchema = z.strictObject({
  title,
  summary,
  timezone: z
    .string()
    .min(1)
    .max(80)
    .optional()
    .describe('A time zone name, such as Europe/London.'),
  workStart: clock.optional(),
  workEnd: clock.optional(),
  workDays: z.array(z.enum(WEEKDAYS)).min(1).optional(),
})

export const proposeSettingsAccessSchema = z.strictObject({
  title,
  summary,
  area: z
    .enum(SETTINGS_AREAS)
    .describe('The settings area, such as ai, members or integrations.'),
  roles: z.array(z.enum(SETTINGS_ACCESS_ROLES)).min(1),
  level: z
    .enum(['none', 'view', 'manage'])
    .describe('What those roles can do in the area.'),
})

export const proposeGroupRoleAdoptSchema = z.strictObject({
  title,
  summary,
})

export const proposeOpenTablesRefreshSchema = z.strictObject({
  title,
  summary,
})

export const proposeOpenTablesRevokeSchema = z.strictObject({
  title,
  summary,
  login: z
    .string()
    .min(1)
    .max(200)
    .describe('The SQL login to revoke, by its name or username.'),
})

export const proposeOntologyLookupSchema = z.strictObject({
  title,
  summary,
  enabled: z.boolean().describe('Whether term lookup is on.'),
  ontologies: z
    .array(z.string().min(1).max(40))
    .max(30)
    .optional()
    .describe(
      'Which ontologies to search, by id (obi, chebi). Keeps the current list if left out.',
    ),
})

export const proposePluginPointSchema = z.strictObject({
  title,
  summary,
  plugin: z.string().min(1).max(200).describe('The plugin, by name or key.'),
  point: z
    .enum(['operations', 'analysis-kinds'])
    .describe(
      'The runner point: its pipeline and assistant actions, or its analysis kinds.',
    ),
  enabled: z.boolean(),
})
