import { cardCopy } from '#/lib/assistant-rpc-cards'

import { DATASET_CARDS } from './cards'

/** Words on the dataset cards, read as `t('features.datasetCards.…')`. */
export const copy = {
  cards: cardCopy(DATASET_CARDS),
} as const
