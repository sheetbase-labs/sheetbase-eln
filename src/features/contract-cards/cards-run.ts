import { runRpcAction } from '#/lib/assistant-rpc-cards'
import type { DataClient } from '#/lib/data-client'

import type { FeatureActionResult } from '../define'
import { CONTRACT_CARDS } from './cards'
import type { ContractCardsAction } from './cards'

/** Runs the card in the person's own session, so their access applies. */
export function runContractCardsAction(
  client: Pick<DataClient, 'rpc'>,
  action: ContractCardsAction,
): Promise<FeatureActionResult | undefined> {
  return runRpcAction(client, CONTRACT_CARDS, action)
}
