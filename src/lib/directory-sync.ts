/**
 * Directory sync (SCIM): the tokens an identity provider uses to add, change
 * and suspend people, and a short account of what it has done so far.
 */
import type { DataClient } from './data-client'

export interface ScimTokenWire {
  id: string
  workspace_id: string
  label: string
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
}

export interface ScimToken {
  id: string
  label: string
  createdAt: string
  lastUsedAt: string | null
}

export interface DirectorySyncStatus {
  activeTokens: number
  lastCalledAt: string | null
  peopleManaged: number
  peopleSwitchedOff: number
  groups: number
  groupsGivingARole: number
}

interface StatusWire {
  active_tokens: number
  last_called_at: string | null
  people_managed: number
  people_switched_off: number
  groups: number
  groups_giving_a_role: number
}

export const directorySyncKeys = {
  tokens: (workspaceId: string) =>
    ['directory-sync', 'tokens', workspaceId] as const,
  status: (workspaceId: string) =>
    ['directory-sync', 'status', workspaceId] as const,
}

export async function fetchScimTokens(
  c: DataClient,
  workspaceId: string,
): Promise<ScimToken[]> {
  const rows = await c.list<ScimTokenWire>(
    'scim_tokens',
    `?workspace_id=eq.${encodeURIComponent(workspaceId)}&revoked_at=is.null&order=created_at.desc&select=id,workspace_id,label,created_at,last_used_at,revoked_at`,
  )

  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
  }))
}

export async function fetchDirectorySyncStatus(
  c: DataClient,
  workspaceId: string,
): Promise<DirectorySyncStatus> {
  const r = await c.rpc<StatusWire>('directory_sync_status', {
    p_workspace_id: workspaceId,
  })

  return {
    activeTokens: r.active_tokens,
    lastCalledAt: r.last_called_at,
    peopleManaged: r.people_managed,
    peopleSwitchedOff: r.people_switched_off,
    groups: r.groups,
    groupsGivingARole: r.groups_giving_a_role,
  }
}

/** Makes a token. The secret comes back once and is never stored in the clear. */
export async function createScimToken(
  c: DataClient,
  workspaceId: string,
  label: string,
): Promise<string> {
  const made = await c.rpc<{ token: string; secret: string }>(
    'create_scim_token',
    { p_workspace_id: workspaceId, p_label: label },
  )

  return made.secret
}

export function revokeScimToken(c: DataClient, id: string): Promise<void> {
  return c.rpc<void>('revoke_scim_token', { p_id: id })
}

/** Where the identity provider is pointed. */
export function scimBaseUrl(origin: string): string {
  return `${origin.replace(/\/+$/, '')}/api/scim/v2`
}
