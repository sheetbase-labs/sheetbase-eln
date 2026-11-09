import type { DataClient } from './data-client'
import { generateReport } from './reports'
import {
  createStudyDeliverable,
  createStudyTask,
  deleteStudyTask,
  editStudyTask,
  moveStudyTaskDue,
} from './planner'
import { archivePlateDesign } from './plate-designer'
import { deleteAnalysisDefinition } from './analysis-definitions-data'
import { deleteAnalysisView } from './analysis-studio-data'
import type { StudiesAction, StudiesActionResult } from './assistant-studies'

/** Runs a planning or reporting card's action. Loaded only in the browser, when a button is pressed. */
export async function runStudiesAction(
  client: DataClient,
  action: StudiesAction,
): Promise<StudiesActionResult | undefined> {
  switch (action.kind) {
    case 'study.task_add': {
      const task = await createStudyTask(client, action.workspaceId, {
        title: action.title,
        taskType: action.taskType,
        projectId: action.projectId,
        dueAt: action.dueAt,
        priority: action.priority ?? undefined,
        description: action.description,
      })
      return {
        openHref: task.project_id
          ? `/projects/${task.project_id}/milestones`
          : '/projects',
      }
    }
    case 'study.task_update': {
      let version = action.expectedMetadataVersion
      if (Object.keys(action.edit).length > 0) {
        const edited = await editStudyTask(client, {
          taskId: action.taskId,
          ...action.edit,
          expectedMetadataVersion: version,
        })
        version = edited.metadata_version
      }
      if (action.move) {
        await moveStudyTaskDue(client, {
          taskId: action.taskId,
          expectedMetadataVersion: version,
          dueAt: action.move.dueAt,
          reason: action.move.reason,
        })
      }
      return undefined
    }
    case 'study.deliverable_add':
      await createStudyDeliverable(client, {
        taskId: action.taskId,
        name: action.name,
        dueAt: action.dueAt,
      })
      return undefined
    case 'report.generate':
      await generateReport(client, {
        workspaceId: action.workspaceId,
        definitionId: action.reportId,
      })
      return { openHref: `/reports/${action.reportId}` }
    case 'plate_design.archive':
      await archivePlateDesign(client, {
        designId: action.designId,
        expectedMetadataVersion: action.expectedMetadataVersion,
      })
      return { openHref: '/plates' }
    case 'study.task_delete':
      await deleteStudyTask(client, action.taskId)
      return undefined
    case 'analysis_view.delete':
      await deleteAnalysisView(client, action.viewId)
      return { openHref: '/analysis' }
    case 'analysis_definition.delete':
      await deleteAnalysisDefinition(client, action.definitionId)
      return { openHref: '/analysis' }
  }
}
