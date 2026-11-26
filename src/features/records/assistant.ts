/** The record cards in the browser: which actions are ours, how they run, their words. */
import { defineAssistant } from '../define'
import { isRecordsAction } from './cards'
import type { RecordsAction, RecordsProposeToolName } from './cards'

export const assistant = defineAssistant<
  RecordsAction,
  RecordsProposeToolName
>()({
  isAction: isRecordsAction,
  async run(client, action) {
    // Loaded only when a card's button is pressed.
    const { runRecordsAction } = await import('./cards-run')

    return runRecordsAction(client, action)
  },
  cardWords: {
    'records.create': 'features.records.cards.create',
    'records.archive': 'features.records.cards.archive',
    'records.restore': 'features.records.cards.restore',
    'records.link': 'features.records.cards.link',
    'material.add_lot': 'features.records.cards.addLot',
  },
})
