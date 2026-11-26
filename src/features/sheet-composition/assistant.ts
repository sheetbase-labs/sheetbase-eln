/** The sheet cards in the browser. */
import { defineAssistant } from '../define'
import { isSheetCompositionAction } from './cards'
import type {
  SheetCompositionAction,
  SheetCompositionProposeToolName,
} from './cards'

export const assistant = defineAssistant<
  SheetCompositionAction,
  SheetCompositionProposeToolName
>()({
  isAction: isSheetCompositionAction,
  async run(client, action) {
    const { runSheetCompositionAction } = await import('./cards-run')

    return runSheetCompositionAction(client, action)
  },
  cardWords: {
    'sheet.materialize': 'features.sheetComposition.cards.materialize',
    'sheet.adopt_layout_version': 'features.sheetComposition.cards.adopt',
  },
})
