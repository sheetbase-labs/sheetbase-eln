import type { DataClient } from '#/lib/data-client'

import type { FeatureActionResult } from '../features/define'

/**
 * The shared shape of the people, project and workspace-settings cards: one
 * ordinary RPC, run as the person when they press the button. The action
 * carries only the arguments. Which RPC a card runs is fixed in the browser
 * from its kind (see `runRpcAction`), so a card cannot name another function.
 */

export type RpcParam =
  | string
  | number
  | boolean
  | null
  | readonly string[]
  | readonly number[]
  | Readonly<Record<string, string>>
  | Readonly<Record<string, boolean>>

export interface RpcCardAction<TKind extends string = string> {
  kind: TKind
  params: Readonly<Record<string, RpcParam>>
  /** The page to open afterwards. */
  openHref: string | null
}

/** Runs one card: calls the RPC its kind maps to, with the card's arguments. */
export async function runRpcAction<TKind extends string>(
  client: Pick<DataClient, 'rpc'>,
  rpcs: Readonly<Record<TKind, string>>,
  action: RpcCardAction<TKind>,
): Promise<FeatureActionResult | undefined> {
  await client.rpc(rpcs[action.kind], { ...action.params })

  return action.openHref ? { openHref: action.openHref } : undefined
}
