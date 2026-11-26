import type { DataClient } from '#/lib/data-client'

import type { FeatureActionResult } from '../define'
import { EDIT_RPCS } from './cards'
import type { ExperimentEditsAction } from './cards'

/** Runs the card in the person's own session, so their access applies. */
export async function runExperimentEditsAction(
  client: Pick<DataClient, 'rpc'>,
  action: ExperimentEditsAction,
): Promise<FeatureActionResult | undefined> {
  await client.rpc(EDIT_RPCS[action.kind], action.params)

  return action.href ? { openHref: action.href } : undefined
}
