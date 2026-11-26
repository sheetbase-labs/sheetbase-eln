/** The analysis cards in the browser: which actions are ours, how they run, their words. */
import { cardWordKeys } from '#/lib/assistant-rpc-cards'

import { defineAssistant } from '../define'
import { ANALYSIS_CARDS, isAnalysisCardsAction } from './cards'
import type { AnalysisCardsAction, AnalysisCardsProposeToolName } from './cards'

export const assistant = defineAssistant<
  AnalysisCardsAction,
  AnalysisCardsProposeToolName
>()({
  isAction: isAnalysisCardsAction,
  async run(client, action) {
    // Loaded only when a card's button is pressed.
    const { runAnalysisCardsAction } = await import('./cards-run')

    return runAnalysisCardsAction(client, action)
  },
  cardWords: cardWordKeys('analysisCards', ANALYSIS_CARDS),
})
