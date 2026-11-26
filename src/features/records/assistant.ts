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
    'material.stock': 'features.records.cards.stock',
    'sample.edit': 'features.records.cards.edit',
    'sample.restore': 'features.records.cards.restore',
    'storage.update_location': 'features.records.cards.edit',
    'storage.archive_location': 'features.records.cards.archive',
    'dataset.archive': 'features.records.cards.archive',
    'dataset.restore': 'features.records.cards.restore',
    'sheet.archive': 'features.records.cards.archive',
    'sheet.restore': 'features.records.cards.restore',
    'sheet.duplicate': 'features.records.cards.duplicate',
  },
})
