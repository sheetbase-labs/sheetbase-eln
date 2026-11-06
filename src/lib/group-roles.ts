/**
 * Roles from sign-in groups (migration 0092): which identity-provider group
 * gives which role, and handing a workspace's roles over to its groups.
 */
import type { DataClient } from './data-client'

export const GROUP_ROLES = [
  'admin',
  'steward',
  'scientist',
  'analyst',
  'reviewer',
  'viewer',
] as const
export type GroupRole = (typeof GROUP_ROLES)[number]

export interface GroupMappingWire {
  id: string
  workspace_id: string
  group_name: string
  role: GroupRole
  created_at: string
}

export interface GroupMapping {
  id: string
  groupName: string
  role: GroupRole
}

export const groupRoleKeys = {
  all: (workspaceId: string) => ['group-roles', workspaceId] as const,
}

export async function fetchGroupMappings(
  c: DataClient,
  workspaceId: string,
): Promise<GroupMapping[]> {
  const rows = await c.list<GroupMappingWire>(
    'idp_group_mappings',
    `?workspace_id=eq.${encodeURIComponent(workspaceId)}&order=group_name.asc&select=id,workspace_id,group_name,role,created_at`,
  )
  return rows.map((r) => ({ id: r.id, groupName: r.group_name, role: r.role }))
}

export function setGroupMapping(
  c: DataClient,
  input: { workspaceId: string; groupName: string; role: GroupRole },
): Promise<GroupMappingWire> {
  return c.rpc<GroupMappingWire>('set_idp_group_mapping', {
    p_workspace_id: input.workspaceId,
    p_group_name: input.groupName,
    p_role: input.role,
  })
}

export function removeGroupMapping(c: DataClient, id: string): Promise<void> {
  return c.rpc<void>('remove_idp_group_mapping', { p_id: id })
}

/** Let groups decide everyone's role from their next sign-in. Returns how many people. */
export function adoptGroupRoles(
  c: DataClient,
  workspaceId: string,
): Promise<number> {
  return c.rpc<number>('adopt_group_roles', { p_workspace_id: workspaceId })
}
