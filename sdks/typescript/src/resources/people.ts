/**
 * People and continuity: hand over work, out of office, sign-in group roles.
 * Personal tokens only (`people:read` / `people:write`); the token acts as its
 * member, so their own permissions apply.
 */
import type { HttpTransport } from '../http.js'

export class PeopleResource {
  constructor(private transport: HttpTransport) {}

  async listAbsences(options?: {
    params?: Record<string, string | number | undefined>
  }): Promise<Record<string, unknown>[]> {
    return this.transport.get('/api/db/member_absences', options)
  }

  async listGroupMappings(options?: {
    params?: Record<string, string | number | undefined>
  }): Promise<Record<string, unknown>[]> {
    return this.transport.get('/api/db/idp_group_mappings', options)
  }

  /** Directory sync (SCIM) tokens; the secret is never returned. */
  async listDirectorySyncTokens(options?: {
    params?: Record<string, string | number | undefined>
  }): Promise<Record<string, unknown>[]> {
    return this.transport.get('/api/db/scim_tokens', options)
  }

  async listDirectorySyncGroups(options?: {
    params?: Record<string, string | number | undefined>
  }): Promise<Record<string, unknown>[]> {
    return this.transport.get('/api/db/scim_groups', options)
  }

  async directorySyncStatus(params: { workspaceId: string }): Promise<unknown> {
    return this.transport.post('/api/db/rpc/directory_sync_status', {
      jsonBody: { p_workspace_id: params.workspaceId },
    })
  }

  async revokeDirectorySyncToken(params: {
    tokenId: string
  }): Promise<unknown> {
    return this.transport.post('/api/db/rpc/revoke_scim_token', {
      jsonBody: { p_id: params.tokenId },
    })
  }

  async previewHandover(params: {
    workspaceId: string
    userId: string
  }): Promise<unknown> {
    return this.transport.post('/api/db/rpc/preview_member_handover', {
      jsonBody: {
        p_workspace_id: params.workspaceId,
        p_user_id: params.userId,
      },
    })
  }

  async handOverWork(params: {
    workspaceId: string
    fromUserId: string
    toUserId: string
    selection: string[]
  }): Promise<unknown> {
    return this.transport.post('/api/db/rpc/hand_over_member_work', {
      jsonBody: {
        p_workspace_id: params.workspaceId,
        p_from_user_id: params.fromUserId,
        p_to_user_id: params.toUserId,
        p_selection: params.selection,
      },
    })
  }

  async setAbsence(params: {
    workspaceId: string
    startsOn: string
    endsOn: string
    delegateUserId?: string | null
    note?: string
    userId?: string
  }): Promise<unknown> {
    const body: Record<string, unknown> = {
      p_workspace_id: params.workspaceId,
      p_starts_on: params.startsOn,
      p_ends_on: params.endsOn,
      p_delegate_user_id: params.delegateUserId ?? null,
    }
    if (params.note !== undefined) body.p_note = params.note
    if (params.userId !== undefined) body.p_user_id = params.userId
    return this.transport.post('/api/db/rpc/set_member_absence', {
      jsonBody: body,
    })
  }

  async cancelAbsence(params: { absenceId: string }): Promise<unknown> {
    return this.transport.post('/api/db/rpc/cancel_member_absence', {
      jsonBody: { p_absence_id: params.absenceId },
    })
  }

  async setGroupMapping(params: {
    workspaceId: string
    groupName: string
    role: string
  }): Promise<unknown> {
    return this.transport.post('/api/db/rpc/set_idp_group_mapping', {
      jsonBody: {
        p_workspace_id: params.workspaceId,
        p_group_name: params.groupName,
        p_role: params.role,
      },
    })
  }

  async removeGroupMapping(params: { mappingId: string }): Promise<unknown> {
    return this.transport.post('/api/db/rpc/remove_idp_group_mapping', {
      jsonBody: { p_id: params.mappingId },
    })
  }

  async adoptGroupRoles(params: { workspaceId: string }): Promise<unknown> {
    return this.transport.post('/api/db/rpc/adopt_group_roles', {
      jsonBody: { p_workspace_id: params.workspaceId },
    })
  }
}
