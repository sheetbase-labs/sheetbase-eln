/** Start-rule cards in the browser: which action is ours, how it runs, its words. */
import { defineAssistant } from '../define'
import { isPipelineStartsAction } from './cards'
import type {
  PipelineStartsAction,
  PipelineStartsProposeToolName,
} from './cards'

export const assistant = defineAssistant<
  PipelineStartsAction,
  PipelineStartsProposeToolName
>()({
  isAction: isPipelineStartsAction,
  async run(client, action) {
    // Loaded only when the card's button is pressed.
    const { runPipelineStartsAction } = await import('./cards-run')

    return runPipelineStartsAction(client, action)
  },
  cardWords: {
    'pipeline.start_rules': 'features.pipelineStarts.cards.setStartRules',
  },
})
