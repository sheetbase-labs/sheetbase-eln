/**
 * Confirm cards that run one database function as the person. Several
 * features need the same shape (find what the model named, say what will
 * change, call one RPC when the button is pressed), so the action is plain
 * data: which card, the arguments, and the page to open afterwards. The
 * function a card calls is fixed in the feature's browser half, never read
 * from the card.
 */
import { z } from 'zod'

import type { DataClient } from './data-client'

export type RpcArgument =
  | string
  | number
  | boolean
  | null
  | readonly RpcArgument[]
  | { readonly [key: string]: RpcArgument }

export interface RpcCardAction<TKind extends string = string> {
  kind: TKind
  params: { readonly [name: string]: RpcArgument }
  openHref: string | null
}

/** Which function each card calls, by the card's kind. */
export type RpcTable<TKind extends string> = Readonly<
  Record<TKind, { readonly rpc: string }>
>

export function rpcActionGuard<TKind extends string>(
  table: RpcTable<TKind>,
): (action: { kind: string }) => action is RpcCardAction<TKind> {
  const kinds = new Set<string>(Object.keys(table))

  return (action): action is RpcCardAction<TKind> => kinds.has(action.kind)
}

export async function runRpcCard<TKind extends string>(
  client: Pick<DataClient, 'rpc'>,
  table: RpcTable<TKind>,
  action: RpcCardAction<TKind>,
): Promise<{ openHref: string } | undefined> {
  await client.rpc(table[action.kind].rpc, { ...action.params })

  return action.openHref ? { openHref: action.openHref } : undefined
}

/** The two lines every card opens with, which the model writes. */
export const cardWords = {
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(400),
}
