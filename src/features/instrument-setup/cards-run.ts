import { runRpcCard } from '#/lib/assistant-call-cards'
import type { DataClient } from '#/lib/data-client'

import type { FeatureActionResult } from '../define'
import { INSTRUMENT_SETUP_CARDS } from './cards'
import type { InstrumentSetupAction } from './cards'

/** Runs the card in the person's own session, so their access applies. */
export async function runInstrumentSetupAction(
  client: Pick<DataClient, 'rpc'>,
  action: InstrumentSetupAction,
): Promise<FeatureActionResult | undefined> {
  return runRpcCard(client, INSTRUMENT_SETUP_CARDS, action)
}
