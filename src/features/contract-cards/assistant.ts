/** The contract cards in the browser: which actions are ours, how they run, their words. */
import { cardWordKeys } from '#/lib/assistant-rpc-cards'

import { defineAssistant } from '../define'
import { CONTRACT_CARDS, isContractCardsAction } from './cards'
import type { ContractCardsAction, ContractCardsProposeToolName } from './cards'

export const assistant = defineAssistant<
  ContractCardsAction,
  ContractCardsProposeToolName
>()({
  isAction: isContractCardsAction,
  async run(client, action) {
    // Loaded only when a card's button is pressed.
    const { runContractCardsAction } = await import('./cards-run')

    return runContractCardsAction(client, action)
  },
  cardWords: cardWordKeys('contractCards', CONTRACT_CARDS),
})
