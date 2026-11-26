/** The ontology and publishing cards in the browser: which actions are ours, how they run, their words. */
import { defineAssistant } from '../define'
import { isOpenDataAction } from './cards'
import type { OpenDataAction, OpenDataProposeToolName } from './cards'

const words = (key: string) => `features.openData.cards.${key}`

export const assistant = defineAssistant<
  OpenDataAction,
  OpenDataProposeToolName
>()({
  isAction: isOpenDataAction,
  async run(client, action) {
    // Loaded only when a card's button is pressed.
    const { runOpenDataAction } = await import('./cards-run')

    return runOpenDataAction(client, action)
  },
  cardWords: {
    'open_data.link_term': words('linkTerm'),
    'open_data.unlink_term': words('unlinkTerm'),
    'open_data.save_target': words('saveTarget'),
    'open_data.delete_target': words('deleteTarget'),
    'open_data.discard': words('discard'),
    'open_data.retry': words('retry'),
  },
})
