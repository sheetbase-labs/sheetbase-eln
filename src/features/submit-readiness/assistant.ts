/** The readiness card in the browser: which action is ours, how it runs, its words. */
import { defineAssistant } from '../define'
import { isSubmitReadinessAction } from './cards'
import type {
  SubmitReadinessAction,
  SubmitReadinessProposeToolName,
} from './cards'

export const assistant = defineAssistant<
  SubmitReadinessAction,
  SubmitReadinessProposeToolName
>()({
  isAction: isSubmitReadinessAction,
  async run(client, action) {
    // Loaded only when the card's button is pressed.
    const { runSubmitReadinessAction } = await import('./cards-run')

    return runSubmitReadinessAction(client, action)
  },
  cardWords: {
    'submit_readiness.set': 'features.submitReadiness.cards.set',
  },
})
