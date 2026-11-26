/** The study and planner cards in the browser: which actions are ours, how they run, their words. */
import { defineAssistant } from '../define'
import { isStudiesAction } from './cards'
import type { StudiesAction, StudiesProposeToolName } from './cards'

export const assistant = defineAssistant<
  StudiesAction,
  StudiesProposeToolName
>()({
  isAction: isStudiesAction,
  async run(client, action) {
    // Loaded only when a card's button is pressed.
    const { runStudiesAction } = await import('./cards-run')

    return runStudiesAction(client, action)
  },
  cardWords: {
    'study.create': 'features.studies.cards.create',
    'study.edit': 'features.studies.cards.edit',
    'study.add_experiment': 'features.studies.cards.addExperiment',
    'study.add_project': 'features.studies.cards.addProject',
    'study.plan_snapshot': 'features.studies.cards.snapshot',
    'study.workstream_add': 'features.studies.cards.addWorkstream',
    'study.task_move_due': 'features.studies.cards.moveDue',
    'study.task_share': 'features.studies.cards.share',
    'study.dependency_add': 'features.studies.cards.addDependency',
    'study.dependency_remove': 'features.studies.cards.removeDependency',
    'study.task_book': 'features.studies.cards.book',
    'study.deliverable_update': 'features.studies.cards.edit',
    'study.deliverable_reorder': 'features.studies.cards.reorder',
    'study.deliverable_evidence': 'features.studies.cards.attach',
  },
})
