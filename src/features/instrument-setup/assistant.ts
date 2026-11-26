/** The instrument set-up cards in the browser: which actions are ours, how they run, their words. */
import { rpcActionGuard } from '#/lib/assistant-rpc-cards'

import { defineAssistant } from '../define'
import { INSTRUMENT_SETUP_CARDS } from './cards'
import type {
  InstrumentSetupAction,
  InstrumentSetupProposeToolName,
} from './cards'

export const assistant = defineAssistant<
  InstrumentSetupAction,
  InstrumentSetupProposeToolName
>()({
  isAction: rpcActionGuard(INSTRUMENT_SETUP_CARDS),
  async run(client, action) {
    // Loaded only when a card's button is pressed.
    const { runInstrumentSetupAction } = await import('./cards-run')

    return runInstrumentSetupAction(client, action)
  },
  cardWords: {
    'instrument.job_queue': 'features.instrumentSetup.cards.jobQueue',
    'instrument.job_start': 'features.instrumentSetup.cards.jobStart',
    'instrument.job_cancel': 'features.instrumentSetup.cards.jobCancel',
    'instrument.robot_set': 'features.instrumentSetup.cards.save',
    'instrument.robot_clear': 'features.instrumentSetup.cards.remove',
    'instrument.feed_limits': 'features.instrumentSetup.cards.save',
    'instrument.feed_remove': 'features.instrumentSetup.cards.remove',
    'instrument.gate_mode': 'features.instrumentSetup.cards.save',
    'instrument.intake_method': 'features.instrumentSetup.cards.save',
    'instrument.connection': 'features.instrumentSetup.cards.save',
    'instrument.qualification_request':
      'features.instrumentSetup.cards.requestQualification',
    'instrument.qualification_dismiss':
      'features.instrumentSetup.cards.dismiss',
    'booking.duplicate': 'features.instrumentSetup.cards.copyBooking',
    'resource.create': 'features.instrumentSetup.cards.add',
    'connector.register': 'features.instrumentSetup.cards.add',
    'connector.update': 'features.instrumentSetup.cards.save',
    'parser.create_converter': 'features.instrumentSetup.cards.addParser',
    'parser.create_webhook': 'features.instrumentSetup.cards.addParser',
    'parser.create_version': 'features.instrumentSetup.cards.addParser',
    'parser.save_mapping': 'features.instrumentSetup.cards.save',
    'parser.request_update': 'features.instrumentSetup.cards.requestUpdate',
  },
})
