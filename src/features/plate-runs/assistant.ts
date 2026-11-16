/** The plate-in-experiment card in the browser: which action is ours, how it runs, its words. */
import { isPlateExperimentAction } from '#/lib/plate-experiment'
import type {
  PlateExperimentAction,
  PlateExperimentProposeToolName,
} from '#/lib/plate-experiment'
import { defineAssistant } from '../define'

export const assistant = defineAssistant<
  PlateExperimentAction,
  PlateExperimentProposeToolName
>()({
  isAction: isPlateExperimentAction,
  async run(client, action) {
    // The notebook write loads only when the button is pressed.
    const { runPlateExperimentAction } =
      await import('#/lib/plate-experiment-action')

    return runPlateExperimentAction(client, action)
  },
  cardWords: {
    'plate.add_to_experiment': 'features.plateRuns.cards.addToExperiment',
  },
})
