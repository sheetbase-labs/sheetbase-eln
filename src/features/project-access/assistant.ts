/** The project access cards in the browser: which actions are ours, how they run, their words. */
import { defineAssistant } from '../define'
import { isProjectAccessAction } from './cards'
import type { ProjectAccessAction, ProjectAccessProposeToolName } from './cards'

export const assistant = defineAssistant<
  ProjectAccessAction,
  ProjectAccessProposeToolName
>()({
  isAction: isProjectAccessAction,
  async run(client, action) {
    // Loaded only when a card's button is pressed.
    const { runProjectAccessAction } = await import('./cards-run')

    return runProjectAccessAction(client, action)
  },
  cardWords: {
    'project_access.set_member': 'features.projectAccess.cards.setMember',
    'project_access.remove_member': 'features.projectAccess.cards.removeMember',
    'project_access.set_rule': 'features.projectAccess.cards.setRule',
    'project_access.remove_rule': 'features.projectAccess.cards.removeRule',
    'project_access.set_defaults': 'features.projectAccess.cards.setDefaults',
    'project_access.set_review_rules': 'features.projectAccess.cards.setRules',
    'project_access.request_edit': 'features.projectAccess.cards.requestEdit',
  },
})
