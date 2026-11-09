import type { DataClient } from '#/lib/data-client'
import type { ProjectsAction } from './cards'
import type { FeatureActionResult } from '../define'

/** Runs a projects card's action. Loaded only in the browser, when a button is pressed. */
export async function runProjectsAction(
  client: DataClient,
  action: ProjectsAction,
): Promise<FeatureActionResult | undefined> {
  const project = (id: string) => `/projects/${id}`
  switch (action.kind) {
    case 'project.update':
      await client.rpc('update_project_details', {
        p_project_id: action.projectId,
        p_expected_revision: action.expectedRevision,
        ...action.fields,
      })
      return { openHref: project(action.projectId) }
    case 'project.archive':
    case 'project.restore':
      await client.rpc(
        action.kind === 'project.archive'
          ? 'archive_project'
          : 'unarchive_project',
        { p_project_id: action.projectId },
      )
      return { openHref: project(action.projectId) }
    case 'project.copy': {
      const made = await client.rpc<{ id: string }>(
        'create_project_from_structure',
        {
          p_source_project_id: action.sourceId,
          p_expected_source_revision: action.expectedRevision,
          p_title: action.name,
          ...action.fields,
        },
      )
      return { openHref: project(made.id) }
    }
    case 'project.copy_plan':
      await client.rpc('create_plan_from_project', {
        p_target_project_id: action.targetId,
        p_source_project_id: action.sourceId,
        p_start_date: action.startDate,
      })
      return { openHref: project(action.targetId) }
    case 'record.move_project':
      await client.rpc('move_record_to_project', {
        p_record_id: action.recordId,
        p_project_id: action.projectId,
        p_expected_metadata_version: action.expectedMetadataVersion,
      })
      return { openHref: `/records/${action.recordId}` }
    case 'folder.create':
      await client.rpc('create_project_folder', {
        p_project_id: action.projectId,
        p_name: action.name,
        p_parent_id: action.parentId,
      })
      return { openHref: project(action.projectId) }
    case 'folder.rename':
      await client.rpc('rename_project_folder', {
        p_folder_id: action.folderId,
        p_name: action.name,
      })
      return { openHref: project(action.projectId) }
    case 'folder.delete':
      await client.rpc('delete_project_folder', {
        p_folder_id: action.folderId,
      })
      return { openHref: project(action.projectId) }
    case 'folder.move_records':
      await client.rpc('move_records_to_folder', {
        p_project_id: action.projectId,
        p_record_ids: action.recordIds,
        p_folder_id: action.folderId,
      })
      return { openHref: project(action.projectId) }
    case 'folder.move_items':
      await client.rpc('move_to_folder', {
        p_items: action.items,
        p_folder_id: action.folderId,
      })
      return { openHref: project(action.projectId) }
    case 'record.follow':
    case 'record.unfollow':
      await client.rpc(
        action.kind === 'record.follow' ? 'follow_record' : 'unfollow_record',
        {
          p_record_id: action.recordId,
        },
      )
      return { openHref: `/records/${action.recordId}` }
    case 'audit.verify':
      await client.rpc('run_audit_verification', {
        p_workspace_id: action.workspaceId,
      })
      return { openHref: '/settings/workspace/audit' }
    case 'sql_login.revoke':
      await client.rpc('revoke_sql_login', {
        p_workspace_id: action.workspaceId,
        p_login_id: action.loginId,
      })
      return { openHref: '/settings/account/api' }
  }
}
