import { z } from 'zod'

import type { DataClient } from './data-client'

const permissionsSchema = z.object({
  can_view: z.boolean(),
  can_edit: z.boolean(),
  can_review: z.boolean(),
  client_portal: z.boolean(),
  can_manage: z.boolean(),
})
export type ProjectPermissions = z.infer<typeof permissionsSchema>

const assignmentSchema = permissionsSchema.extend({
  project_id: z.uuid(),
  access_level: z.enum(['owner', 'editor', 'reviewer', 'viewer']),
})
export type ProjectAssignment = z.infer<typeof assignmentSchema>

const onboardingSchema = z.object({
  user_id: z.string(),
  workspace_role: z.string(),
  joined_at: z.string(),
  invitation_accepted_at: z.string().nullable(),
})
export type MyOnboardingState = z.infer<typeof onboardingSchema>

const defaultsSchema = z.object({
  private_to_lead: z.literal(true),
  qa_view_group_id: z.uuid().nullable(),
  client_portal_off: z.literal(true),
})

const ruleSchema = permissionsSchema
  .extend({
    id: z.uuid(),
    project_id: z.uuid(),
    user_id: z.string().nullable(),
    group_id: z.uuid().nullable(),
    principal_name: z.string(),
  })
  .refine((rule) => (rule.user_id === null) !== (rule.group_id === null), {
    message: 'A project rule must name exactly one user or group.',
  })
export type ProjectAccessRule = z.infer<typeof ruleSchema>

const groupSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  member_ids: z.array(z.string()),
})
export type WorkspaceGroup = z.infer<typeof groupSchema>

const memberStatusSchema = z.object({
  user_id: z.string(),
  last_active_at: z.string().nullable(),
  training_required: z.number().int().nonnegative(),
  training_overdue: z.number().int().nonnegative(),
})
export type WorkspaceMemberStatus = z.infer<typeof memberStatusSchema>

const accessRequestSchema = z.object({
  id: z.uuid(),
  project_id: z.uuid(),
  user_id: z.string(),
  name: z.string(),
  reason: z.string(),
  status: z.enum(['pending', 'approved', 'denied']),
  created_at: z.string(),
})
export type ProjectAccessRequest = z.infer<typeof accessRequestSchema>

export const workspaceAccessKeys = {
  all: (workspaceId: string) => ['workspace-access', workspaceId] as const,
  groups: (workspaceId: string) =>
    ['workspace-access', workspaceId, 'groups'] as const,
  rules: (workspaceId: string) =>
    ['workspace-access', workspaceId, 'rules'] as const,
  requests: (workspaceId: string) =>
    ['workspace-access', workspaceId, 'requests'] as const,
  members: (workspaceId: string) =>
    ['workspace-access', workspaceId, 'members'] as const,
  assignments: (workspaceId: string, userId: string) =>
    ['workspace-access', workspaceId, 'assignments', userId] as const,
  onboarding: (workspaceId: string, userId: string) =>
    ['workspace-access', workspaceId, 'onboarding', userId] as const,
  defaults: (workspaceId: string) =>
    ['workspace-access', workspaceId, 'defaults'] as const,
}

export async function fetchProjectAccessDefaults(client: DataClient) {
  return z
    .array(defaultsSchema)
    .length(1)
    .parse(await client.rpc('project_access_defaults', {}))[0]
}

export async function setProjectAccessDefaults(
  client: DataClient,
  groupId: string | null,
): Promise<void> {
  await client.rpc('set_project_access_defaults', {
    p_qa_view_group_id: groupId,
  })
}

export async function fetchMyOnboardingState(
  client: DataClient,
): Promise<MyOnboardingState | null> {
  const rows = z
    .array(onboardingSchema)
    .max(1)
    .parse(await client.rpc('my_onboarding_state', {}))
  return rows[0] ?? null
}

export async function fetchMyProjectAssignments(
  client: DataClient,
): Promise<ProjectAssignment[]> {
  return z
    .array(assignmentSchema)
    .parse(await client.rpc('my_project_permissions', {}))
}

export async function fetchWorkspaceGroups(
  client: DataClient,
): Promise<WorkspaceGroup[]> {
  return z
    .array(groupSchema)
    .parse(await client.rpc('workspace_groups_list', {}))
}

export async function fetchWorkspaceAccessRules(
  client: DataClient,
): Promise<ProjectAccessRule[]> {
  return z
    .array(ruleSchema)
    .parse(await client.rpc('workspace_project_access_rules', {}))
}

export async function fetchWorkspaceMemberStatus(
  client: DataClient,
): Promise<WorkspaceMemberStatus[]> {
  return z
    .array(memberStatusSchema)
    .parse(await client.rpc('workspace_member_status', {}))
}

export async function fetchProjectPermissions(
  client: DataClient,
  projectId: string,
): Promise<ProjectPermissions> {
  const rows = z
    .array(permissionsSchema)
    .length(1)
    .parse(
      await client.rpc('project_permissions', {
        p_project_id: projectId,
      }),
    )
  return rows[0]
}

export async function createWorkspaceGroup(
  client: DataClient,
  name: string,
): Promise<void> {
  await client.rpc('create_workspace_group', { p_name: name.trim() })
}

export async function deleteWorkspaceGroup(
  client: DataClient,
  groupId: string,
): Promise<void> {
  await client.rpc('delete_workspace_group', { p_group_id: groupId })
}

export async function setWorkspaceGroupMember(
  client: DataClient,
  input: {
    groupId: string
    userId: string
    isMember: boolean
  },
): Promise<void> {
  await client.rpc('set_workspace_group_member', {
    p_group_id: input.groupId,
    p_user_id: input.userId,
    p_is_member: input.isMember,
  })
}

export async function setProjectAccessRule(
  client: DataClient,
  input: ProjectPermissions & {
    projectId: string
    principal:
      { kind: 'user'; userId: string } | { kind: 'group'; groupId: string }
  },
): Promise<void> {
  await client.rpc('set_project_access_rule', {
    p_project_id: input.projectId,
    p_user_id: input.principal.kind === 'user' ? input.principal.userId : null,
    p_group_id:
      input.principal.kind === 'group' ? input.principal.groupId : null,
    p_can_view: input.can_view,
    p_can_edit: input.can_edit,
    p_can_review: input.can_review,
    p_client_portal: input.client_portal,
    p_can_manage: input.can_manage,
  })
}

export async function removeProjectAccessRule(
  client: DataClient,
  ruleId: string,
): Promise<void> {
  await client.rpc('remove_project_access_rule', { p_rule_id: ruleId })
}

export async function fetchProjectAccessRequests(
  client: DataClient,
): Promise<ProjectAccessRequest[]> {
  return z
    .array(accessRequestSchema)
    .parse(await client.rpc('project_access_requests_list', {}))
}

export async function requestProjectEditAccess(
  client: DataClient,
  input: {
    projectId: string
    reason: string
  },
): Promise<void> {
  await client.rpc('request_project_edit_access', {
    p_project_id: input.projectId,
    p_reason: input.reason.trim(),
  })
}

export async function decideProjectAccessRequest(
  client: DataClient,
  input: {
    requestId: string
    approve: boolean
  },
): Promise<void> {
  await client.rpc('decide_project_access_request', {
    p_request_id: input.requestId,
    p_approve: input.approve,
  })
}
