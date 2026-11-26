import { runRpcAction } from '#/lib/assistant-admin-cards'
import type { DataClient } from '#/lib/data-client'

import type { FeatureActionResult } from '../define'
import { PROJECT_ACCESS_RPC } from './cards'
import type { ProjectAccessAction } from './cards'

/** Runs the card in the person's own session, so their access applies. */
export function runProjectAccessAction(
  client: Pick<DataClient, 'rpc'>,
  action: ProjectAccessAction,
): Promise<FeatureActionResult | undefined> {
  return runRpcAction(client, PROJECT_ACCESS_RPC, action)
}
