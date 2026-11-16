import type { DataClient } from '#/lib/data-client'

import type { FeatureActionResult } from '../define'
import type { SubmitReadinessAction } from './cards'

/** Runs the card in the person's own session, so their access applies. */
export async function runSubmitReadinessAction(
  client: Pick<DataClient, 'rpc'>,
  action: SubmitReadinessAction,
): Promise<FeatureActionResult | undefined> {
  await client.rpc('set_submit_readiness_mode', {
    p_workspace_id: action.workspaceId,
    p_mode: action.mode,
  })

  return { openHref: '/settings/workspace/signatures' }
}
