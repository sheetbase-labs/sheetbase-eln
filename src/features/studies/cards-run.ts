import type { DataClient } from '#/lib/data-client'

import type { FeatureActionResult } from '../define'
import type { StudiesAction } from './cards'

/** Runs the card in the person's own session, so their access applies. */
export async function runStudiesAction(
  client: Pick<DataClient, 'rpc'>,
  action: StudiesAction,
): Promise<FeatureActionResult | undefined> {
  switch (action.kind) {
    case 'study.create':
      await client.rpc('create_study', {
        p_workspace_id: action.workspaceId,
        p_title: action.title,
        p_home_project_id: action.projectId,
        p_summary: action.description,
        p_starts_on: action.startsOn,
        p_ends_on: action.endsOn,
        p_custom_fields: {},
      })

      return undefined

    case 'study.edit':
      await client.rpc('edit_study', {
        p_study_record_id: action.id,
        p_expected_metadata_version: action.metadataVersion,
        p_title: action.title,
        p_status: action.status,
        p_summary: action.description,
        p_starts_on: action.startsOn,
        p_ends_on: action.endsOn,
        p_custom_fields: null,
      })

      return { openHref: `/records/${action.id}` }

    case 'study.add_experiment':
      await client.rpc('link_study_experiment', {
        p_study_record_id: action.studyId,
        p_experiment_record_id: action.experimentId,
        p_relationship: action.relationship ?? 'member',
      })

      return { openHref: `/records/${action.studyId}` }

    case 'study.add_project':
      await client.rpc('link_study_project', {
        p_study_record_id: action.studyId,
        p_project_id: action.projectId,
        p_relationship: action.relationship ?? 'participating',
      })

      return { openHref: `/records/${action.studyId}` }

    case 'study.plan_snapshot':
      await client.rpc('snapshot_study_plan', {
        p_study_record_id: action.studyId,
        p_reason: action.reason,
      })

      return { openHref: `/records/${action.studyId}` }

    case 'study.workstream_add':
      await client.rpc('create_study_workstream', {
        p_workspace_id: action.workspaceId,
        p_name: action.name,
        p_project_id: action.projectId,
        p_color: action.color,
        p_position: 0,
      })

      return undefined

    case 'study.task_move_due':
      await client.rpc('move_study_task_due', {
        p_task_id: action.taskId,
        p_expected_metadata_version: action.metadataVersion,
        p_due_at: action.dueAt,
        p_reason: action.reason,
        p_notify_client: action.notifyClient,
      })

      return undefined

    case 'study.task_share':
      await client.rpc('set_study_task_client_visible', {
        p_task_id: action.taskId,
        p_expected_metadata_version: action.metadataVersion,
        p_client_visible: action.visible,
        p_reason: action.reason,
      })

      return undefined

    case 'study.dependency_add':
      await client.rpc('create_dependency', {
        p_workspace_id: action.workspaceId,
        p_predecessor_id: action.predecessorId,
        p_successor_id: action.successorId,
        p_dependency_type: action.dependencyType,
        p_lag_days: action.lagDays,
        p_is_external: false,
      })

      return undefined

    case 'study.dependency_remove':
      await client.rpc('delete_dependency', {
        p_dependency_id: action.dependencyId,
      })

      return undefined

    case 'study.task_book':
      await client.rpc('assign_task_resource', {
        p_workspace_id: action.workspaceId,
        p_task_id: action.taskId,
        p_calendar_resource_id: action.resourceId,
        p_starts_at: action.startsAt,
        p_ends_at: action.endsAt,
        p_notes: action.notes,
      })

      return undefined

    case 'study.deliverable_update':
      await client.rpc('update_study_deliverable', {
        p_id: action.id,
        p_name: action.name,
        p_description: action.description,
        p_status: action.status,
        p_due_at: action.dueAt,
      })

      return undefined

    case 'study.deliverable_reorder':
      await client.rpc('reorder_study_deliverables', {
        p_task_id: action.taskId,
        p_ids: action.ids,
      })

      return undefined

    case 'study.deliverable_evidence':
      await client.rpc('link_study_deliverable_evidence', {
        p_id: action.id,
        p_record_id: action.recordId,
      })

      return undefined
  }
}
