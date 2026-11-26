/** The plate cards in the browser: which actions are ours, how they run, their words. */
import { defineAssistant } from '../define'
import { isPlateAssaysAction } from './cards'
import type { PlateAssaysAction, PlateAssaysProposeToolName } from './cards'

export const assistant = defineAssistant<
  PlateAssaysAction,
  PlateAssaysProposeToolName
>()({
  isAction: isPlateAssaysAction,
  async run(client, action) {
    // Loaded only when a card's button is pressed.
    const { runPlateAssaysAction } = await import('./cards-run')

    return runPlateAssaysAction(client, action)
  },
  cardWords: {
    'plate_run.create': 'features.plateAssays.cards.createRun',
    'plate_run.update': 'features.plateAssays.cards.save',
    'plate_run.archive': 'features.plateAssays.cards.archive',
    'plate_design.create': 'features.plateAssays.cards.createDesign',
    'plate_design.fill': 'features.plateAssays.cards.fill',
    'plate_layout.save': 'features.plateAssays.cards.saveLayout',
    'plate_design.track_qc': 'features.plateAssays.cards.trackQc',
    'worklist.cancel': 'features.plateAssays.cards.cancelWorklist',
    'worklist.complete': 'features.plateAssays.cards.completeWorklist',
  },
})
