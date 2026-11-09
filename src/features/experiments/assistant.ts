/** Experiment, alias and label template cards in the browser: which actions are ours, how they run, their words. */
import { isExperimentAction } from '#/lib/assistant-experiments'
import type {
  ExperimentAction,
  ExperimentProposeToolName,
} from '#/lib/assistant-experiments'
import { defineAssistant } from '../define'

const words = (key: string) => `features.experiments.cards.${key}`

export const assistant = defineAssistant<
  ExperimentAction,
  ExperimentProposeToolName
>()({
  isAction: isExperimentAction,
  async run(client, action) {
    // Experiment jobs load only when a card's button is pressed.
    const { runExperimentAction } =
      await import('#/lib/assistant-experiments-run')

    return runExperimentAction(client, action)
  },
  cardWords: {
    'experiments.start': words('startExperiment'),
    'experiments.status': words('setExperimentStatus'),
    'experiments.outcome': words('recordOutcome'),
    'experiments.delete_draft': words('deleteDraft'),
    'experiments.alias_add': words('addAlias'),
    'experiments.alias_remove': words('removeAlias'),
    'experiments.label_archive': words('archiveLabelTemplate'),
  },
})
