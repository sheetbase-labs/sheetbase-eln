import { cardCopy } from '#/lib/assistant-rpc-cards'

import { CONTRACT_CARDS } from './cards'

/** Words on the contract cards, read as `t('features.contractCards.…')`. */
export const copy = {
  cards: cardCopy(CONTRACT_CARDS),
} as const
