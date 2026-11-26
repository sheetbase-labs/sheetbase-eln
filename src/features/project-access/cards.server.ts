import type { ProviderToolDef } from '#/lib/ai-providers/types'
import {
  NOTE,
  adminCard,
  fail,
  findGroup,
  findMember,
  onOff,
} from '#/lib/assistant-admin-cards.server'
import { invalid, toolDef } from '#/lib/assistant-lab-tools.server'
import type { LabToolContext } from '#/lib/assistant-lab-tools.server'
import { findProject } from '#/lib/assistant-labwork.server'
import { pick } from '#/lib/assistant-upkeep.server'
import type { ProposalChange } from '#/lib/assistant-proposals'

import type { FeatureProposalOutcome } from '../define.server'
import {
  PROJECT_ACCESS_PROPOSE_TOOL_NAMES,
  PROJECT_REMOVE_MEMBER_TOOL,
  PROJECT_REMOVE_RULE_TOOL,
  PROJECT_REQUEST_EDIT_TOOL,
  PROJECT_SET_DEFAULTS_TOOL,
  PROJECT_SET_MEMBER_TOOL,
  PROJECT_SET_REVIEW_RULES_TOOL,
  PROJECT_SET_RULE_TOOL,
  proposeProjectRemoveMemberSchema,
  proposeProjectRemoveRuleSchema,
  proposeProjectRequestEditSchema,
  proposeProjectReviewRulesSchema,
  proposeProjectSetDefaultsSchema,
  proposeProjectSetMemberSchema,
  proposeProjectSetRuleSchema,
} from './cards'
import type { ProjectAccessProposeToolName } from './cards'

/**
 * The project access cards (see `cards.ts`). Each builder finds what the
 * model named under the signed-in person's own access and returns a card
 * that says exactly what will change. Nothing is written here.
 */

export function isProjectAccessProposalTool(
  name: string,
): name is ProjectAccessProposeToolName {
  return PROJECT_ACCESS_PROPOSE_TOOL_NAMES.includes(name)
}

export function projectAccessProposalDefs(): ProviderToolDef[] {
  return [
    toolDef(
      PROJECT_SET_MEMBER_TOOL,
      `Propose setting one person's access level on a project: owner, editor, reviewer or viewer. Replaces what they had. ${NOTE}`,
      proposeProjectSetMemberSchema,
    ),
    toolDef(
      PROJECT_REMOVE_MEMBER_TOOL,
      `Propose taking a person off a project, so they keep no direct access to it. ${NOTE}`,
      proposeProjectRemoveMemberSchema,
    ),
    toolDef(
      PROJECT_SET_RULE_TOOL,
      `Propose the exact permissions a person or a group has on a project: view, edit, review, client portal, manage. Leave a permission out to keep what it is. ${NOTE}`,
      proposeProjectSetRuleSchema,
    ),
    toolDef(
      PROJECT_REMOVE_RULE_TOOL,
      `Propose removing the access rule a person or a group has on a project. ${NOTE}`,
      proposeProjectRemoveRuleSchema,
    ),
    toolDef(
      PROJECT_SET_DEFAULTS_TOOL,
      `Propose choosing which group can view every project for quality checks, or none. ${NOTE}`,
      proposeProjectSetDefaultsSchema,
    ),
    toolDef(
      PROJECT_SET_REVIEW_RULES_TOOL,
      `Propose a project's review rules: whether a protocol in effect is required, whether review must be independent, and whether records are shared with the client automatically. ${NOTE}`,
      proposeProjectReviewRulesSchema,
    ),
    toolDef(
      PROJECT_REQUEST_EDIT_TOOL,
      `Propose asking a project's managers for edit access, with the reason. Use it when a change was refused because the person can only view the project. ${NOTE}`,
      proposeProjectRequestEditSchema,
    ),
  ]
}

interface RuleRow {
  id: string
  project_id: string
  user_id: string | null
  group_id: string | null
  principal_name: string
  can_view: boolean
  can_edit: boolean
  can_review: boolean
  client_portal: boolean
  can_manage: boolean
}

const projectHref = (id: string): string => `/projects/${id}`

async function rulesFor(
  client: LabToolContext['client'],
  projectId: string,
): Promise<RuleRow[]> {
  const rules = await client.rpc<RuleRow[]>(
    'workspace_project_access_rules',
    {},
  )

  return rules.filter((rule) => rule.project_id === projectId)
}

const permissionLabels = [
  ['can_view', 'Can view'],
  ['can_edit', 'Can edit'],
  ['can_review', 'Can review'],
  ['client_portal', 'Client portal'],
  ['can_manage', 'Can manage'],
] as const

export async function buildProjectAccessProposal(
  name: ProjectAccessProposeToolName,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw external tool arguments; parsed with the tool's schema before any field is read.
  args: unknown,
  context: LabToolContext,
): Promise<FeatureProposalOutcome> {
  const { client } = context

  switch (name) {
    case PROJECT_SET_MEMBER_TOOL: {
      const parsed = proposeProjectSetMemberSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const project = await findProject(client, input.project)

      if (!project.ok) return fail(project.message)
      const member = await findMember(client, input.person)

      if (!member.ok) return fail(member.message)

      const current = await client.list<{ access_level: string }>(
        'project_access',
        `?project_id=eq.${project.value.id}&user_id=eq.${encodeURIComponent(member.value.user_id)}&select=access_level&limit=1`,
      )

      return adminCard(input, {
        tool: name,
        target: `${project.value.title} · ${member.value.name}`,
        deepLink: projectHref(project.value.id),
        changes: [
          {
            label: member.value.name,
            before: current.at(0)?.access_level ?? 'No direct access',
            after: input.level,
          },
        ],
        action: {
          kind: 'project_access.set_member',
          params: {
            p_project_id: project.value.id,
            p_user_id: member.value.user_id,
            p_access_level: input.level,
          },
          openHref: projectHref(project.value.id),
        },
      })
    }

    case PROJECT_REMOVE_MEMBER_TOOL: {
      const parsed = proposeProjectRemoveMemberSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const project = await findProject(client, input.project)

      if (!project.ok) return fail(project.message)
      const member = await findMember(client, input.person)

      if (!member.ok) return fail(member.message)

      const current = await client.list<{ access_level: string }>(
        'project_access',
        `?project_id=eq.${project.value.id}&user_id=eq.${encodeURIComponent(member.value.user_id)}&select=access_level&limit=1`,
      )

      if (current.length === 0) {
        return fail(
          `${member.value.name} has no direct access to ${project.value.title}, so there is nothing to remove.`,
        )
      }

      return adminCard(input, {
        tool: name,
        target: `${project.value.title} · ${member.value.name}`,
        deepLink: projectHref(project.value.id),
        changes: [
          {
            label: member.value.name,
            before: current[0].access_level,
            after: 'Removed',
          },
        ],
        action: {
          kind: 'project_access.remove_member',
          params: {
            p_project_id: project.value.id,
            p_user_id: member.value.user_id,
          },
          openHref: projectHref(project.value.id),
        },
      })
    }

    case PROJECT_SET_RULE_TOOL: {
      const parsed = proposeProjectSetRuleSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const project = await findProject(client, input.project)

      if (!project.ok) return fail(project.message)

      const principal =
        input.whoIs === 'group'
          ? await findGroup(client, input.who)
          : await findMember(client, input.who)

      if (!principal.ok) return fail(principal.message)

      const userId =
        input.whoIs === 'person' && 'user_id' in principal.value
          ? principal.value.user_id
          : null

      const groupId =
        input.whoIs === 'group' && 'id' in principal.value
          ? principal.value.id
          : null

      const label = principal.value.name

      const existing = (await rulesFor(client, project.value.id)).find(
        (rule) =>
          (userId !== null && rule.user_id === userId) ||
          (groupId !== null && rule.group_id === groupId),
      )

      const next = {
        can_view: input.canView ?? existing?.can_view ?? true,
        can_edit: input.canEdit ?? existing?.can_edit ?? false,
        can_review: input.canReview ?? existing?.can_review ?? false,
        client_portal: input.clientPortal ?? existing?.client_portal ?? false,
        can_manage: input.canManage ?? existing?.can_manage ?? false,
      }

      const changes: ProposalChange[] = permissionLabels.flatMap(
        ([key, text]) => {
          const before = existing ? onOff(existing[key]) : 'Off'
          const after = next[key] ? 'On' : 'Off'

          return before === after && existing
            ? []
            : [{ label: text, before, after }]
        },
      )

      if (changes.length === 0) {
        return fail(`${label} already has exactly these permissions.`)
      }

      return adminCard(input, {
        tool: name,
        target: `${project.value.title} · ${label}`,
        deepLink: projectHref(project.value.id),
        changes,
        action: {
          kind: 'project_access.set_rule',
          params: {
            p_project_id: project.value.id,
            p_user_id: userId,
            p_group_id: groupId,
            p_can_view: next.can_view,
            p_can_edit: next.can_edit,
            p_can_review: next.can_review,
            p_client_portal: next.client_portal,
            p_can_manage: next.can_manage,
          },
          openHref: projectHref(project.value.id),
        },
      })
    }

    case PROJECT_REMOVE_RULE_TOOL: {
      const parsed = proposeProjectRemoveRuleSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const project = await findProject(client, input.project)

      if (!project.ok) return fail(project.message)
      const lower = input.who.trim().toLowerCase()

      const matches = (await rulesFor(client, project.value.id)).filter(
        (rule) => rule.principal_name.toLowerCase().includes(lower),
      )

      const rule = pick(
        matches,
        input.who,
        'access rule',
        (row) => row.principal_name,
        (row) => row.principal_name.toLowerCase() === lower,
      )

      if (!rule.ok) return fail(rule.message)

      const held = permissionLabels
        .flatMap(([key, text]) =>
          rule.value[key] ? [text.replace('Can ', '')] : [],
        )
        .join(', ')

      return adminCard(input, {
        tool: name,
        target: `${project.value.title} · ${rule.value.principal_name}`,
        deepLink: projectHref(project.value.id),
        changes: [
          {
            label: rule.value.principal_name,
            before: held || 'No permissions',
            after: 'Rule removed',
          },
        ],
        action: {
          kind: 'project_access.remove_rule',
          params: { p_rule_id: rule.value.id },
          openHref: projectHref(project.value.id),
        },
      })
    }

    case PROJECT_SET_DEFAULTS_TOOL: {
      const parsed = proposeProjectSetDefaultsSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const group = input.group ? await findGroup(client, input.group) : null

      if (group && !group.ok) return fail(group.message)

      const current = await client.rpc<{ qa_view_group_id: string | null }[]>(
        'project_access_defaults',
        {},
      )

      const currentId = current.at(0)?.qa_view_group_id ?? null

      const currentName = currentId
        ? ((
            await client.list<{ name: string }>(
              'workspace_groups',
              `?id=eq.${currentId}&select=name&limit=1`,
            )
          ).at(0)?.name ?? 'A group')
        : 'No group'

      return adminCard(input, {
        tool: name,
        target: 'Project access defaults',
        deepLink: '/settings/workspace/access',
        changes: [
          {
            label: 'Group that can view every project',
            before: currentName,
            after: group?.ok ? group.value.name : 'No group',
          },
        ],
        action: {
          kind: 'project_access.set_defaults',
          params: { p_qa_view_group_id: group?.ok ? group.value.id : null },
          openHref: '/settings/workspace/access',
        },
      })
    }

    case PROJECT_SET_REVIEW_RULES_TOOL: {
      const parsed = proposeProjectReviewRulesSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const project = await findProject(client, input.project)

      if (!project.ok) return fail(project.message)

      const row = (
        await client.list<{
          require_effective_protocol: boolean
          require_independent_reviewer: boolean
          auto_share_to_client: boolean
        }>(
          'projects',
          `?id=eq.${project.value.id}&select=require_effective_protocol,require_independent_reviewer,auto_share_to_client&limit=1`,
        )
      ).at(0)

      const rules = [
        [
          'Protocol in effect required',
          input.requireEffectiveProtocol,
          row?.require_effective_protocol,
        ],
        [
          'Independent reviewer required',
          input.requireIndependentReviewer,
          row?.require_independent_reviewer,
        ],
        [
          'Share with client automatically',
          input.autoShareToClient,
          row?.auto_share_to_client,
        ],
      ] as const

      const changes: ProposalChange[] = rules.flatMap(([label, wanted, was]) =>
        wanted === undefined || wanted === was
          ? []
          : [{ label, before: onOff(was), after: wanted ? 'On' : 'Off' }],
      )

      if (changes.length === 0) {
        return fail(
          `${project.value.title} already has these rules, or none was named.`,
        )
      }

      return adminCard(input, {
        tool: name,
        target: project.value.title,
        deepLink: projectHref(project.value.id),
        changes,
        action: {
          kind: 'project_access.set_review_rules',
          params: {
            p_project_id: project.value.id,
            p_require_effective_protocol:
              input.requireEffectiveProtocol ?? null,
            p_require_independent_reviewer:
              input.requireIndependentReviewer ?? null,
            p_auto_share_to_client: input.autoShareToClient ?? null,
          },
          openHref: projectHref(project.value.id),
        },
      })
    }

    case PROJECT_REQUEST_EDIT_TOOL: {
      const parsed = proposeProjectRequestEditSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const project = await findProject(client, input.project)

      if (!project.ok) return fail(project.message)

      return adminCard(input, {
        tool: name,
        target: project.value.title,
        deepLink: projectHref(project.value.id),
        changes: [
          { label: 'Asks for', before: null, after: 'Edit access' },
          { label: 'Reason', before: null, after: input.reason.trim() },
        ],
        action: {
          kind: 'project_access.request_edit',
          params: {
            p_project_id: project.value.id,
            p_reason: input.reason.trim(),
          },
          openHref: projectHref(project.value.id),
        },
      })
    }
  }
}
