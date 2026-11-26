import type { ProviderToolDef } from '#/lib/ai-providers/types'
import {
  NOTE,
  adminCard,
  fail,
  onOff,
} from '#/lib/assistant-admin-cards.server'
import { invalid, likeValue, toolDef } from '#/lib/assistant-lab-tools.server'
import type { LabToolContext } from '#/lib/assistant-lab-tools.server'
import type { ProposalChange } from '#/lib/assistant-proposals'
import { pick } from '#/lib/assistant-upkeep.server'
import { SETTINGS_AREA_LABELS, settingsLevelFor } from '#/lib/settings-access'

import type { FeatureProposalOutcome } from '../define.server'
import {
  GROUP_ROLE_ADOPT_TOOL,
  ONTOLOGY_LOOKUP_TOOL,
  OPEN_TABLES_REFRESH_TOOL,
  OPEN_TABLES_REVOKE_TOOL,
  PLUGIN_POINT_TOOL,
  SCHEDULER_HOURS_TOOL,
  SETTINGS_ACCESS_TOOL,
  WEEKDAYS,
  WORKSPACE_AI_TOOL,
  WORKSPACE_DATA_ACCESS_TOOL,
  WORKSPACE_ID_PREFIXES_TOOL,
  WORKSPACE_PUBLISHING_TOOL,
  WORKSPACE_RULES_TOOL,
  WORKSPACE_SETTINGS_PROPOSE_TOOL_NAMES,
  proposeGroupRoleAdoptSchema,
  proposeOntologyLookupSchema,
  proposeOpenTablesRefreshSchema,
  proposeOpenTablesRevokeSchema,
  proposePluginPointSchema,
  proposeSchedulerHoursSchema,
  proposeSettingsAccessSchema,
  proposeWorkspaceAiSchema,
  proposeWorkspaceDataAccessSchema,
  proposeWorkspaceIdPrefixesSchema,
  proposeWorkspacePublishingSchema,
  proposeWorkspaceRulesSchema,
} from './cards'
import type { WorkspaceSettingsProposeToolName } from './cards'

/**
 * The workspace settings cards (see `cards.ts`). Each builder reads the
 * current setting under the signed-in person's own access and returns a card
 * that shows it before and after. Nothing is written here.
 */

export function isWorkspaceSettingsProposalTool(
  name: string,
): name is WorkspaceSettingsProposeToolName {
  return WORKSPACE_SETTINGS_PROPOSE_TOOL_NAMES.includes(name)
}

export function workspaceSettingsProposalDefs(): ProviderToolDef[] {
  return [
    toolDef(
      WORKSPACE_RULES_TOOL,
      `Propose the workspace's rules: who can join, whether records go through review, how long the audit trail is kept, whether a change needs a reason, whether signing locks a record, and whether devices may edit offline. Name only what changes. ${NOTE}`,
      proposeWorkspaceRulesSchema,
    ),
    toolDef(
      WORKSPACE_AI_TOOL,
      `Propose the workspace AI settings: on or off, the provider profile and model, whether lab data may go to outside AI services, and the per-call limits. Name only what changes. ${NOTE}`,
      proposeWorkspaceAiSchema,
    ),
    toolDef(
      WORKSPACE_ID_PREFIXES_TOOL,
      `Propose the prefix of the IDs of a record type, such as EXP for experiments. ${NOTE}`,
      proposeWorkspaceIdPrefixesSchema,
    ),
    toolDef(
      WORKSPACE_DATA_ACCESS_TOOL,
      `Propose which roles get data access: the technical view of the workspace and a personal read-only SQL login. Replaces the list of roles. ${NOTE}`,
      proposeWorkspaceDataAccessSchema,
    ),
    toolDef(
      WORKSPACE_PUBLISHING_TOOL,
      `Propose whether publishing to an outside repository needs approval first. ${NOTE}`,
      proposeWorkspacePublishingSchema,
    ),
    toolDef(
      SCHEDULER_HOURS_TOOL,
      `Propose the working hours, days and time zone the scheduler plans within. Name only what changes. ${NOTE}`,
      proposeSchedulerHoursSchema,
    ),
    toolDef(
      SETTINGS_ACCESS_TOOL,
      `Propose what some roles can do in one settings area (none, view or manage). ${NOTE}`,
      proposeSettingsAccessSchema,
    ),
    toolDef(
      GROUP_ROLE_ADOPT_TOOL,
      `Propose letting sign-in groups decide the role of everyone already in the workspace, from their next sign-in. Owners and client accounts are left out. ${NOTE}`,
      proposeGroupRoleAdoptSchema,
    ),
    toolDef(
      OPEN_TABLES_REFRESH_TOOL,
      `Propose refreshing the open tables now, instead of waiting for the next run. ${NOTE}`,
      proposeOpenTablesRefreshSchema,
    ),
    toolDef(
      OPEN_TABLES_REVOKE_TOOL,
      `Propose revoking a SQL login for the open tables, so it stops working. ${NOTE}`,
      proposeOpenTablesRevokeSchema,
    ),
    toolDef(
      ONTOLOGY_LOOKUP_TOOL,
      `Propose turning ontology term lookup on or off, and which ontologies it searches. ${NOTE}`,
      proposeOntologyLookupSchema,
    ),
    toolDef(
      PLUGIN_POINT_TOOL,
      `Propose switching one runner point of a plugin on or off: its pipeline and assistant actions, or its analysis kinds. ${NOTE}`,
      proposePluginPointSchema,
    ),
  ]
}

const SETTINGS_HREF = '/settings/workspace'

interface SettingsRow {
  registration_mode: string
  review_workflow_enabled: boolean
  audit_retention_days: number
  require_change_reason: boolean
  lock_on_sign: boolean
  allow_offline_editing: boolean
  publication_approval_required: boolean
  id_prefixes: Record<string, string> | null
  data_access_roles: string[] | null
  ai_enabled: boolean
  ai_provider_profile: string | null
  ai_model: string
  ai_cloud_egress_enabled: boolean
  ai_max_tokens_per_call: number
  ai_max_cost_microusd_per_call: number
}

async function settingsRow(
  context: LabToolContext,
): Promise<SettingsRow | undefined> {
  return (
    await context.client.list<SettingsRow>(
      'workspace_settings',
      `?workspace_id=eq.${encodeURIComponent(context.workspaceId)}&select=*&limit=1`,
    )
  ).at(0)
}

/** Lines that changed, in the card's before and after. */
function diff(
  rows: ReadonlyArray<
    readonly [
      string,
      string | number | null | undefined,
      string | number | null | undefined,
    ]
  >,
): ProposalChange[] {
  return rows.flatMap(([label, before, after]) =>
    after === undefined || after === before
      ? []
      : [
          {
            label,
            before: before === undefined ? null : String(before ?? '') || null,
            after: String(after),
          },
        ],
  )
}

const minutesOf = (clock: string): number => {
  const [hours, minutes] = clock.split(':').map(Number)

  return hours * 60 + minutes
}

const clockOf = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

const dayNames = (days: readonly number[]): string =>
  days.map((day) => WEEKDAYS[day - 1] ?? String(day)).join(', ')

export async function buildWorkspaceSettingsProposal(
  name: WorkspaceSettingsProposeToolName,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw external tool arguments; parsed with the tool's schema before any field is read.
  args: unknown,
  context: LabToolContext,
): Promise<FeatureProposalOutcome> {
  const { client, workspaceId } = context

  switch (name) {
    case WORKSPACE_RULES_TOOL: {
      const parsed = proposeWorkspaceRulesSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const row = await settingsRow(context)

      const changes = diff([
        ['Who can join', row?.registration_mode, input.registrationMode],
        [
          'Review workflow',
          onOff(row?.review_workflow_enabled),
          input.reviewWorkflow === undefined
            ? undefined
            : onOff(input.reviewWorkflow),
        ],
        [
          'Audit trail kept (days)',
          row?.audit_retention_days,
          input.auditRetentionDays,
        ],
        [
          'Change reason required',
          onOff(row?.require_change_reason),
          input.requireChangeReason === undefined
            ? undefined
            : onOff(input.requireChangeReason),
        ],
        [
          'Signing locks the record',
          onOff(row?.lock_on_sign),
          input.lockOnSign === undefined ? undefined : onOff(input.lockOnSign),
        ],
        [
          'Offline editing',
          onOff(row?.allow_offline_editing),
          input.allowOfflineEditing === undefined
            ? undefined
            : onOff(input.allowOfflineEditing),
        ],
      ])

      if (changes.length === 0) {
        return fail('The workspace already has those rules, or none was named.')
      }

      return adminCard(input, {
        tool: name,
        target: 'Workspace rules',
        deepLink: SETTINGS_HREF,
        changes,
        action: {
          kind: 'workspace_settings.rules',
          params: {
            p_workspace_id: workspaceId,
            p_registration_mode: input.registrationMode ?? null,
            p_review_workflow_enabled: input.reviewWorkflow ?? null,
            p_audit_retention_days: input.auditRetentionDays ?? null,
            p_require_change_reason: input.requireChangeReason ?? null,
            p_lock_on_sign: input.lockOnSign ?? null,
            p_allow_offline_editing: input.allowOfflineEditing ?? null,
          },
          openHref: SETTINGS_HREF,
        },
      })
    }

    case WORKSPACE_AI_TOOL: {
      const parsed = proposeWorkspaceAiSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const row = await settingsRow(context)

      const next = {
        enabled: input.enabled ?? row?.ai_enabled ?? false,
        providerProfile:
          input.providerProfile === undefined
            ? (row?.ai_provider_profile ?? null)
            : input.providerProfile,
        model: input.model ?? row?.ai_model ?? 'sheetbase-assist-1',
        cloudEgressEnabled:
          input.allowCloud ?? row?.ai_cloud_egress_enabled ?? false,
        maxTokensPerCall:
          input.maxTokensPerCall ?? row?.ai_max_tokens_per_call ?? 4000,
        maxCostMicrousdPerCall:
          input.maxCostMicrousdPerCall ??
          row?.ai_max_cost_microusd_per_call ??
          0,
      }

      const changes = diff([
        ['AI assistant', onOff(row?.ai_enabled), onOff(next.enabled)],
        [
          'Provider',
          row?.ai_provider_profile ?? 'Built in',
          next.providerProfile ?? 'Built in',
        ],
        ['Model', row?.ai_model, next.model],
        [
          'Outside AI services',
          row?.ai_cloud_egress_enabled ? 'Allowed' : 'Not allowed',
          next.cloudEgressEnabled ? 'Allowed' : 'Not allowed',
        ],
        ['Tokens per call', row?.ai_max_tokens_per_call, next.maxTokensPerCall],
        [
          'Cost per call (µUSD)',
          row?.ai_max_cost_microusd_per_call,
          next.maxCostMicrousdPerCall,
        ],
      ])

      if (changes.length === 0) {
        return fail('The AI settings already are that, or none was named.')
      }

      return adminCard(input, {
        tool: name,
        target: 'AI settings',
        deepLink: `${SETTINGS_HREF}/ai`,
        changes,
        action: {
          kind: 'workspace_settings.ai',
          params: {
            workspaceId,
            enabled: next.enabled,
            providerProfile: next.providerProfile,
            model: next.model,
            cloudEgressEnabled: next.cloudEgressEnabled,
            maxTokensPerCall: next.maxTokensPerCall,
            maxCostMicrousdPerCall: next.maxCostMicrousdPerCall,
          },
          openHref: `${SETTINGS_HREF}/ai`,
        },
      })
    }

    case WORKSPACE_ID_PREFIXES_TOOL: {
      const parsed = proposeWorkspaceIdPrefixesSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const row = await settingsRow(context)
      const current = row?.id_prefixes ?? {}

      const changes = diff(
        Object.entries(input.prefixes).map(
          ([key, prefix]) => [key, current[key] ?? null, prefix] as const,
        ),
      )

      if (changes.length === 0) {
        return fail('Those record types already have those prefixes.')
      }

      return adminCard(input, {
        tool: name,
        target: 'ID prefixes',
        deepLink: SETTINGS_HREF,
        changes,
        action: {
          kind: 'workspace_settings.id_prefixes',
          params: {
            p_workspace_id: workspaceId,
            p_prefixes: { ...current, ...input.prefixes },
          },
          openHref: SETTINGS_HREF,
        },
      })
    }

    case WORKSPACE_DATA_ACCESS_TOOL: {
      const parsed = proposeWorkspaceDataAccessSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const row = await settingsRow(context)
      const current = row?.data_access_roles ?? ['steward']
      const roles = [...new Set(input.roles)].sort()

      return adminCard(input, {
        tool: name,
        target: 'Data access',
        deepLink: SETTINGS_HREF,
        changes: [
          {
            label: 'Roles with data access',
            before: [...current].sort().join(', ') || 'None',
            after: roles.join(', ') || 'None',
          },
        ],
        action: {
          kind: 'workspace_settings.data_access',
          params: { p_workspace_id: workspaceId, p_roles: roles },
          openHref: SETTINGS_HREF,
        },
      })
    }

    case WORKSPACE_PUBLISHING_TOOL: {
      const parsed = proposeWorkspacePublishingSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const row = await settingsRow(context)

      return adminCard(input, {
        tool: name,
        target: 'Publishing policy',
        deepLink: `${SETTINGS_HREF}/open-data`,
        changes: [
          {
            label: 'Approval before publishing',
            before: onOff(row?.publication_approval_required),
            after: input.approvalRequired ? 'Required' : 'Not required',
          },
        ],
        action: {
          kind: 'workspace_settings.publishing',
          params: {
            p_workspace_id: workspaceId,
            p_required: input.approvalRequired,
          },
          openHref: `${SETTINGS_HREF}/open-data`,
        },
      })
    }

    case SCHEDULER_HOURS_TOOL: {
      const parsed = proposeSchedulerHoursSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data

      const row = (
        await client.list<{
          timezone: string
          work_start_minute: number
          work_end_minute: number
          work_days: number[]
        }>('scheduler_settings', '?select=*&limit=1')
      ).at(0) ?? {
        timezone: 'Europe/London',
        work_start_minute: 540,
        work_end_minute: 1020,
        work_days: [1, 2, 3, 4, 5],
      }

      const start = input.workStart
        ? minutesOf(input.workStart)
        : row.work_start_minute

      const end = input.workEnd ? minutesOf(input.workEnd) : row.work_end_minute

      if (end <= start) return fail('Working hours must end after they start.')

      const days = input.workDays
        ? [
            ...new Set(input.workDays.map((day) => WEEKDAYS.indexOf(day) + 1)),
          ].sort()
        : row.work_days

      const timezone = input.timezone ?? row.timezone

      const changes = diff([
        ['Time zone', row.timezone, timezone],
        ['Starts', clockOf(row.work_start_minute), clockOf(start)],
        ['Ends', clockOf(row.work_end_minute), clockOf(end)],
        ['Working days', dayNames(row.work_days), dayNames(days)],
      ])

      if (changes.length === 0)
        return fail('Those are already the working hours.')

      return adminCard(input, {
        tool: name,
        target: 'Scheduler working hours',
        deepLink: SETTINGS_HREF,
        changes,
        action: {
          kind: 'workspace_settings.hours',
          params: {
            p_workspace_id: workspaceId,
            p_timezone: timezone,
            p_work_start_minute: start,
            p_work_end_minute: end,
            p_work_days: days,
          },
          openHref: SETTINGS_HREF,
        },
      })
    }

    case SETTINGS_ACCESS_TOOL: {
      const parsed = proposeSettingsAccessSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data

      const stored = await client.list<{
        area: string
        role: string
        level: string
      }>('settings_access', '?select=area,role,level')

      // The scientist column also holds the plain member role.
      const roles = [
        ...new Set(
          input.roles.flatMap((role) =>
            role === 'scientist' ? ['member', 'scientist'] : [role],
          ),
        ),
      ]

      const changes: ProposalChange[] = input.roles.flatMap((role) => {
        const before = settingsLevelFor(input.area, role, stored)

        return before === input.level
          ? []
          : [{ label: role, before, after: input.level }]
      })

      if (changes.length === 0) {
        return fail('Those roles already have that level there.')
      }

      return adminCard(input, {
        tool: name,
        target: SETTINGS_AREA_LABELS[input.area],
        deepLink: `${SETTINGS_HREF}/roles`,
        changes,
        action: {
          kind: 'workspace_settings.access',
          params: {
            p_workspace_id: workspaceId,
            p_area: input.area,
            p_level: input.level,
            roles,
          },
          openHref: `${SETTINGS_HREF}/roles`,
        },
      })
    }

    case GROUP_ROLE_ADOPT_TOOL: {
      const parsed = proposeGroupRoleAdoptSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))

      return adminCard(parsed.data, {
        tool: name,
        target: 'Sign-in groups',
        deepLink: `${SETTINGS_HREF}/members`,
        changes: [
          {
            label: 'Roles',
            before: 'Set by hand',
            after: 'Decided by sign-in groups',
          },
        ],
        action: {
          kind: 'workspace_settings.adopt_groups',
          params: { p_workspace_id: workspaceId },
          openHref: `${SETTINGS_HREF}/members`,
        },
      })
    }

    case OPEN_TABLES_REFRESH_TOOL: {
      const parsed = proposeOpenTablesRefreshSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))

      return adminCard(parsed.data, {
        tool: name,
        target: 'Open tables',
        deepLink: `${SETTINGS_HREF}/open-data`,
        changes: [{ label: 'Open tables', before: null, after: 'Refresh now' }],
        action: {
          kind: 'workspace_settings.refresh_tables',
          params: { p_workspace_id: workspaceId },
          openHref: `${SETTINGS_HREF}/open-data`,
        },
      })
    }

    case OPEN_TABLES_REVOKE_TOOL: {
      const parsed = proposeOpenTablesRevokeSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data

      const logins = await client.rpc<
        Array<{ id: string; name: string; username: string; status: string }>
      >('list_lake_credentials', { p_workspace_id: workspaceId })

      const lower = input.login.trim().toLowerCase()

      const found = pick(
        logins.filter(
          (login) =>
            login.status === 'active' &&
            (login.name.toLowerCase().includes(lower) ||
              login.username.toLowerCase().includes(lower)),
        ),
        input.login,
        'SQL login',
        (row) => `${row.name} (${row.username})`,
        (row) =>
          row.name.toLowerCase() === lower ||
          row.username.toLowerCase() === lower,
      )

      if (!found.ok) return fail(found.message)

      return adminCard(input, {
        tool: name,
        target: `${found.value.name} (${found.value.username})`,
        deepLink: `${SETTINGS_HREF}/open-data`,
        changes: [
          { label: found.value.name, before: 'Active', after: 'Revoked' },
        ],
        action: {
          kind: 'workspace_settings.revoke_login',
          params: {
            p_workspace_id: workspaceId,
            p_credential_id: found.value.id,
          },
          openHref: `${SETTINGS_HREF}/open-data`,
        },
      })
    }

    case ONTOLOGY_LOOKUP_TOOL: {
      const parsed = proposeOntologyLookupSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data

      const current = await client.rpc<{
        enabled: boolean
        ontologies: string[]
      }>('ontology_settings', { p_workspace_id: workspaceId })

      const ontologies = input.ontologies?.map((id) => id.toLowerCase())

      const changes = diff([
        ['Term lookup', onOff(current.enabled), onOff(input.enabled)],
        [
          'Ontologies',
          current.ontologies.join(', ') || 'None',
          ontologies ? ontologies.join(', ') || 'None' : undefined,
        ],
      ])

      if (changes.length === 0) return fail('Term lookup already is that.')

      return adminCard(input, {
        tool: name,
        target: 'Ontology lookup',
        deepLink: `${SETTINGS_HREF}/open-data`,
        changes,
        action: {
          kind: 'workspace_settings.ontology',
          params: {
            p_workspace_id: workspaceId,
            p_enabled: input.enabled,
            p_ontologies: ontologies ?? null,
          },
          openHref: `${SETTINGS_HREF}/open-data`,
        },
      })
    }

    case PLUGIN_POINT_TOOL: {
      const parsed = proposePluginPointSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const like = likeValue(input.plugin)

      const rows = await client.list<{
        id: string
        key: string
        name: string
        disabled_points: string[] | null
      }>(
        'extensions',
        `?or=(name.ilike.${like},key.ilike.${like})&select=id,key,name,disabled_points&order=name.asc&limit=6`,
      )

      const lower = input.plugin.trim().toLowerCase()

      const found = pick(
        rows,
        input.plugin,
        'plugin',
        (row) => row.name,
        (row) =>
          row.name.toLowerCase() === lower || row.key.toLowerCase() === lower,
      )

      if (!found.ok) return fail(found.message)

      const wasOn = !(found.value.disabled_points ?? []).includes(input.point)

      if (wasOn === input.enabled) {
        return fail(
          `${found.value.name} already has ${input.point} ${input.enabled ? 'on' : 'off'}.`,
        )
      }

      return adminCard(input, {
        tool: name,
        target: found.value.name,
        deepLink: `${SETTINGS_HREF}/plugins`,
        changes: [
          {
            label: input.point,
            before: onOff(wasOn),
            after: input.enabled ? 'On' : 'Off',
          },
        ],
        action: {
          kind: 'workspace_settings.plugin_point',
          params: {
            p_workspace_id: workspaceId,
            p_extension_id: found.value.id,
            p_point: input.point,
            p_enabled: input.enabled,
          },
          openHref: `${SETTINGS_HREF}/plugins`,
        },
      })
    }
  }
}
