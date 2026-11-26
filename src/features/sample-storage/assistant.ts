/** The sample and storage cards in the browser: which actions are ours, how they run, their words. */
import { defineAssistant } from '../define'
import { isSampleStorageAction } from './cards'
import type { SampleStorageAction, SampleStorageProposeToolName } from './cards'

export const assistant = defineAssistant<
  SampleStorageAction,
  SampleStorageProposeToolName
>()({
  isAction: isSampleStorageAction,
  async run(client, action) {
    // Loaded only when a card's button is pressed.
    const { runSampleStorageAction } = await import('./cards-run')

    return runSampleStorageAction(client, action)
  },
  cardWords: {
    'sample.withdraw': 'features.sampleStorage.cards.withdraw',
    'sample.label_printed': 'features.sampleStorage.cards.labelPrinted',
    'sample.match_locations': 'features.sampleStorage.cards.matchLocations',
    'storage.position_status': 'features.sampleStorage.cards.positionStatus',
    'stocktake.scan': 'features.sampleStorage.cards.scan',
    'stocktake.resolve': 'features.sampleStorage.cards.resolve',
    'stocktake.cancel': 'features.sampleStorage.cards.cancel',
    'shipment.dispatch': 'features.sampleStorage.cards.dispatch',
    'shipment.update': 'features.sampleStorage.cards.save',
    'material.safety': 'features.sampleStorage.cards.save',
    'sample_workflow.save': 'features.sampleStorage.cards.save',
    'sample_workflow.set_status': 'features.sampleStorage.cards.save',
    'release_rules.set': 'features.sampleStorage.cards.save',
  },
})
