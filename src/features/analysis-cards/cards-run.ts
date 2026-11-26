import { runRpcAction } from '#/lib/assistant-rpc-cards'
import type { DataClient } from '#/lib/data-client'

import type { FeatureActionResult } from '../define'
import { ANALYSIS_CARDS } from './cards'
import type { AnalysisCardsAction } from './cards'

/** Runs the card in the person's own session, so their access applies. */
export function runAnalysisCardsAction(
  client: Pick<DataClient, 'rpc'>,
  action: AnalysisCardsAction,
): Promise<FeatureActionResult | undefined> {
  return runRpcAction(client, ANALYSIS_CARDS, action)
}
