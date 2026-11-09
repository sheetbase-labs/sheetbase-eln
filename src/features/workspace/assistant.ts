/** Workspace cards in the browser: which actions are ours, how they run, their words. */
import { isWorkspaceAction } from './cards'
import type { WorkspaceAction, WorkspaceProposeToolName } from './cards'
import { defineAssistant } from '../define'

const words = (key: string) => `features.workspace.cards.${key}`

export const assistant = defineAssistant<
  WorkspaceAction,
  WorkspaceProposeToolName
>()({
  isAction: isWorkspaceAction,
  async run(client, action) {
    // Workspace jobs load only when a card's button is pressed.
    const { runWorkspaceAction } = await import('./cards-run')

    return runWorkspaceAction(client, action)
  },
  cardWords: {
    'workspace.starter_tables': words('addStarterTables'),
    'workspace.join_domains': words('saveJoinDomains'),
    'workspace.regulated_lab': words('switchRegulatedLab'),
    'sheet.resolve_conflict': words('resolveConflict'),
    'study.assign_item': words('assignToStudy'),
  },
})
