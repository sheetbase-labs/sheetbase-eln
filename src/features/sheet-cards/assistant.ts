/** The sheet cards in the browser: which actions are ours, how they run, their words. */
import { cardWordKeys } from '#/lib/assistant-rpc-cards'

import { defineAssistant } from '../define'
import { isSheetCardsAction, SHEET_CARDS } from './cards'
import type { SheetCardsAction, SheetCardsProposeToolName } from './cards'

export const assistant = defineAssistant<
  SheetCardsAction,
  SheetCardsProposeToolName
>()({
  isAction: isSheetCardsAction,
  async run(client, action) {
    // Loaded only when a card's button is pressed.
    const { runSheetCardsAction } = await import('./cards-run')

    return runSheetCardsAction(client, action)
  },
  cardWords: cardWordKeys('sheetCards', SHEET_CARDS),
})
