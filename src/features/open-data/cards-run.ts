import { runRpcAction } from '#/lib/assistant-admin-cards'
import type { DataClient } from '#/lib/data-client'

import type { FeatureActionResult } from '../define'
import { OPEN_DATA_RPC } from './cards'
import type { OpenDataAction } from './cards'

/** Runs the card in the person's own session, so their access applies. */
export function runOpenDataAction(
  client: Pick<DataClient, 'rpc'>,
  action: OpenDataAction,
): Promise<FeatureActionResult | undefined> {
  return runRpcAction(client, OPEN_DATA_RPC, action)
}
