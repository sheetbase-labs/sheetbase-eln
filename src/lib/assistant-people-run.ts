import type { DataClient } from './data-client'
import { createInvitation, invitationLink } from './workspace-admin'
import type { WorkspaceRole } from './workspace-admin'
import type { PeopleAction, PeopleActionResult } from './assistant-people'

/** Runs a people card's action. Loaded only in the browser, when a button is pressed. */

const MEMBERS = '/settings/workspace/members'

export async function runPeopleAction(
  client: DataClient,
  action: PeopleAction,
): Promise<PeopleActionResult | undefined> {
  switch (action.kind) {
    case 'member.invite': {
      const made = await createInvitation(client, {
        workspaceId: action.workspaceId,
        email: action.email,
        role: action.role as WorkspaceRole,
        expiresAfterDays: 7,
        clientId: action.clientId,
        projectGrants: action.projectGrants as never,
      })

      return {
        openHref: MEMBERS,
        note: invitationLink(window.location.origin, made.token),
      }
    }

    case 'invitation.revoke':
      await client.rpc('revoke_invitation', {
        p_workspace_id: action.workspaceId,
        p_invitation_id: action.invitationId,
      })

      return { openHref: MEMBERS }
    case 'member.role':
      await client.rpc('change_member_role', {
        p_workspace_id: action.workspaceId,
        p_user_id: action.userId,
        p_new_role: action.role,
        p_client_id: action.clientId,
      })

      return { openHref: MEMBERS }
    case 'member.suspend':
      await client.rpc('suspend_member', {
        p_workspace_id: action.workspaceId,
        p_user_id: action.userId,
      })

      return { openHref: MEMBERS }
    case 'member.reinstate':
      await client.rpc('reinstate_member', {
        p_workspace_id: action.workspaceId,
        p_user_id: action.userId,
      })

      return { openHref: MEMBERS }
    case 'member.remove':
      await client.rpc('remove_member', {
        p_workspace_id: action.workspaceId,
        p_user_id: action.userId,
      })

      return { openHref: MEMBERS }
    case 'access.grant':
      await client.rpc('grant_project_access', {
        p_workspace_id: action.workspaceId,
        p_project_id: action.projectId,
        p_user_id: action.userId,
        p_access_level: action.level,
      })

      return { openHref: `/projects/${action.projectId}` }
    case 'access.revoke':
      await client.rpc('revoke_project_access', {
        p_workspace_id: action.workspaceId,
        p_project_id: action.projectId,
        p_user_id: action.userId,
      })

      return { openHref: `/projects/${action.projectId}` }
    case 'access.decide':
      await client.rpc('decide_project_access_request', {
        p_request_id: action.requestId,
        p_approve: action.approve,
      })

      return { openHref: `/projects/${action.projectId}` }
    case 'group.create':
      await client.rpc('create_workspace_group', { p_name: action.name })

      return { openHref: MEMBERS }
    case 'group.delete':
      await client.rpc('delete_workspace_group', { p_group_id: action.groupId })

      return { openHref: MEMBERS }
    case 'group.member':
      await client.rpc('set_workspace_group_member', {
        p_group_id: action.groupId,
        p_user_id: action.userId,
        p_is_member: action.isMember,
      })

      return { openHref: MEMBERS }
    case 'workspace.rename':
      await client.rpc('update_workspace_name', {
        p_workspace_id: action.workspaceId,
        p_name: action.name,
      })

      return { openHref: '/settings/workspace' }
    case 'workspace.general':
      await client.rpc('update_workspace_general', {
        p_workspace_id: action.workspaceId,
        p_site: action.site,
        p_timezone: action.timezone,
        p_date_format: action.dateFormat,
        p_number_format: action.numberFormat,
      })

      return { openHref: '/settings/workspace' }
    case 'client.create':
      await client.rpc('create_client', { p_name: action.name })

      return { openHref: '/settings/workspace/clients' }
    case 'client.share':
      await client.rpc(
        action.share
          ? 'share_record_with_client'
          : 'unshare_record_with_client',
        { p_client_id: action.clientId, p_record_id: action.recordId },
      )

      return { openHref: `/records/${action.recordId}` }
  }
}
