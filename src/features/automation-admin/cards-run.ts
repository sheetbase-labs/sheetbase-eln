import { runRpcCard } from '#/lib/assistant-rpc-cards'
import type { DataClient } from '#/lib/data-client'

import type { FeatureActionResult } from '../define'
import { AUTOMATION_ADMIN_CARDS } from './cards'
import type { AutomationAdminAction } from './cards'

/** Runs the card in the person's own session, so their access applies. */
export async function runAutomationAdminAction(
  client: Pick<DataClient, 'rpc'>,
  action: AutomationAdminAction,
): Promise<FeatureActionResult | undefined> {
  return runRpcCard(client, AUTOMATION_ADMIN_CARDS, action)
}
