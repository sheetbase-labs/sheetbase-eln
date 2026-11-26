/** The dataset cards in the browser: which actions are ours, how they run, their words. */
import { cardWordKeys } from '#/lib/assistant-rpc-cards'

import { defineAssistant } from '../define'
import { DATASET_CARDS, isDatasetCardsAction } from './cards'
import type { DatasetCardsAction, DatasetCardsProposeToolName } from './cards'

export const assistant = defineAssistant<
  DatasetCardsAction,
  DatasetCardsProposeToolName
>()({
  isAction: isDatasetCardsAction,
  async run(client, action) {
    // Loaded only when a card's button is pressed.
    const { runDatasetCardsAction } = await import('./cards-run')

    return runDatasetCardsAction(client, action)
  },
  cardWords: cardWordKeys('datasetCards', DATASET_CARDS),
})
