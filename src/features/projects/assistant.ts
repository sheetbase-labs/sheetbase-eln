/** Projects cards in the browser: which actions are ours, how they run, their words. */
import { isProjectsAction } from './cards'
import type { ProjectsAction, ProjectsProposeToolName } from './cards'
import { defineAssistant } from '../define'

const words = (key: string) => `features.projects.cards.${key}`

export const assistant = defineAssistant<
  ProjectsAction,
  ProjectsProposeToolName
>()({
  isAction: isProjectsAction,
  async run(client, action) {
    // Project and folder jobs load only when a card's button is pressed.
    const { runProjectsAction } = await import('./cards-run')
    return runProjectsAction(client, action)
  },
  cardWords: {
    'project.update': words('updateProject'),
    'project.archive': words('archiveProject'),
    'project.restore': words('restoreProject'),
    'project.copy': words('copyProject'),
    'project.copy_plan': words('copyPlan'),
    'record.move_project': words('moveRecord'),
    'folder.create': words('createFolder'),
    'folder.rename': words('renameFolder'),
    'folder.delete': words('deleteFolder'),
    'folder.move_records': words('fileInFolder'),
    'folder.move_items': words('fileInFolder'),
    'record.follow': words('followRecord'),
    'record.unfollow': words('unfollowRecord'),
    'audit.verify': words('verifyAudit'),
    'sql_login.revoke': words('revokeSqlLogin'),
  },
})
