import { runRpcAction } from '#/lib/assistant-rpc-cards'
import type { DataClient } from '#/lib/data-client'

import type { FeatureActionResult } from '../define'
import { SHEET_CARDS } from './cards'
import type { SheetCardsAction } from './cards'

/** Runs the card in the person's own session, so their access applies. */
export function runSheetCardsAction(
  client: Pick<DataClient, 'rpc'>,
  action: SheetCardsAction,
): Promise<FeatureActionResult | undefined> {
  return runRpcAction(client, SHEET_CARDS, action)
}
