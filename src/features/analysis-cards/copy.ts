import { cardCopy } from '#/lib/assistant-rpc-cards'

import { ANALYSIS_CARDS } from './cards'

/** Words on the analysis cards, read as `t('features.analysisCards.…')`. */
export const copy = {
  cards: cardCopy(ANALYSIS_CARDS),
} as const
