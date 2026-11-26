/** The experiment edit cards in the browser: which actions are ours, how they run, their words. */
import { defineAssistant } from '../define'
import { isExperimentEditsAction } from './cards'
import type {
  ExperimentEditKind,
  ExperimentEditsAction,
  ExperimentEditsProposeToolName,
} from './cards'

const words = (key: string) => `features.experimentEdits.cards.${key}`

const WORDS: Record<ExperimentEditKind, string> = {
  'experiment_edits.fields': words('save'),
  'experiment_edits.transition': words('move'),
  'experiment_edits.favourite': words('save'),
  'experiment_edits.hold_add': words('hold'),
  'experiment_edits.sign_off': words('save'),
  'experiment_edits.part_move': words('move'),
  'experiment_edits.part_delete': words('delete'),
  'experiment_edits.part_amend': words('reopen'),
  'experiment_edits.part_gate': words('save'),
  'experiment_edits.part_plan': words('save'),
  'experiment_edits.part_slip': words('slip'),
  'experiment_edits.part_split': words('split'),
  'experiment_edits.part_block': words('move'),
  'experiment_edits.part_link': words('move'),
  'experiment_edits.block_move': words('move'),
  'experiment_edits.block_delete': words('delete'),
  'experiment_edits.qc_create': words('create'),
  'experiment_edits.qc_update': words('save'),
  'experiment_edits.qc_delete': words('delete'),
  'experiment_edits.qc_point': words('record'),
  'experiment_edits.series_start': words('start'),
  'experiment_edits.series_dissolve': words('dissolve'),
  'experiment_edits.series_move': words('move'),
  'experiment_edits.series_day': words('save'),
  'experiment_edits.model_reparent': words('save'),
  'experiment_edits.version_discard': words('discard'),
  'experiment_edits.version_upgrade': words('upgrade'),
  'experiment_edits.version_migrate': words('upgrade'),
  'experiment_edits.protocol_import': words('import'),
  'experiment_edits.version_edit': words('save'),
}

export const assistant = defineAssistant<
  ExperimentEditsAction,
  ExperimentEditsProposeToolName
>()({
  isAction: isExperimentEditsAction,
  async run(client, action) {
    // Loaded only when a card's button is pressed.
    const { runExperimentEditsAction } = await import('./cards-run')

    return runExperimentEditsAction(client, action)
  },
  cardWords: WORDS,
})
