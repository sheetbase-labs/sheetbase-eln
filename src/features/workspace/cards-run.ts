import type { DataClient } from '#/lib/data-client'
import type { WorkspaceAction } from './cards'
import type { FeatureActionResult } from '../define'

/** Runs a workspace card's action. Loaded only in the browser, when a button is pressed. */
export async function runWorkspaceAction(
  client: DataClient,
  action: WorkspaceAction,
): Promise<FeatureActionResult | undefined> {
  switch (action.kind) {
    case 'workspace.starter_tables':
      await client.rpc('install_starter_structures', {
        p_workspace_id: action.workspaceId,
        p_keys: action.keys,
      })
      return { openHref: '/models' }
    case 'workspace.join_domains':
      await client.rpc('set_join_domains', {
        p_workspace_id: action.workspaceId,
        p_domains: action.domains,
        p_role: action.role,
      })
      return { openHref: '/settings/workspace/members' }
    case 'workspace.regulated_lab':
      await client.rpc('set_regulated_lab', {
        p_workspace_id: action.workspaceId,
        p_regulated: action.regulated,
      })
      return { openHref: '/settings/workspace' }
    case 'sheet.resolve_conflict':
      await client.rpc('resolve_cell_conflict', {
        p_conflict_id: action.conflictId,
        p_value: action.value,
        p_reason: action.reason,
      })
      return { openHref: `/sheets/${action.sheetId}` }
    case 'study.assign_item':
      await client.rpc('assign_planner_item_to_study', {
        p_study_record_id: action.studyRecordId,
        p_workstream_id: action.workstreamId,
        p_task_id: action.taskId,
      })
      return { openHref: `/records/${action.studyRecordId}` }
  }
}
