import { runRpcAction } from '#/lib/assistant-rpc-cards'
import type { DataClient } from '#/lib/data-client'

import type { FeatureActionResult } from '../define'
import { DATASET_CARDS } from './cards'
import type { DatasetCardsAction } from './cards'

/** Runs the card in the person's own session, so their access applies. */
export function runDatasetCardsAction(
  client: Pick<DataClient, 'rpc'>,
  action: DatasetCardsAction,
): Promise<FeatureActionResult | undefined> {
  return runRpcAction(client, DATASET_CARDS, action)
}
