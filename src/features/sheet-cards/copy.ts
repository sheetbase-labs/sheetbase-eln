import { cardCopy } from '#/lib/assistant-rpc-cards'

import { SHEET_CARDS } from './cards'

/** Words on the sheet cards, read as `t('features.sheetCards.…')`. */
export const copy = {
  cards: cardCopy(SHEET_CARDS),
} as const
