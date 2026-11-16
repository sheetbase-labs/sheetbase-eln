/** The sheet card in the browser: which action is ours, how it runs, its words. */
import { defineAssistant } from '../define'
import { isDataInAction } from './cards'
import type { DataInAction, DataInProposeToolName } from './cards'

export const assistant = defineAssistant<DataInAction, DataInProposeToolName>()(
  {
    isAction: isDataInAction,
    async run(client, action) {
      // Loaded only when the card's button is pressed, in the person's session.
      const { runDataInAction } = await import('./cards-run')

      return runDataInAction(client, action)
    },
    cardWords: {
      'sheet.open_dataset': 'features.dataIn.cards.openDataset',
    },
  },
)
