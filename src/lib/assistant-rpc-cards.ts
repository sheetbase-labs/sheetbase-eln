import type { DataClient } from './data-client'

/**
 * Cards that run one ordinary database call as the person, for the sheet,
 * dataset, analysis and contract cards. The model names things the way the
 * lab does, the server finds them and sends back a card; nothing happens until
 * the person presses its button, which calls the same RPC the screen would.
 *
 * Every card of a family shares one action shape. The kind is the tool name
 * (so it is unique and carries its own button words), and the run step only
 * calls an RPC the tool is declared to cover.
 */

export type RpcJson =
  string | number | boolean | null | RpcJson[] | { [key: string]: RpcJson }

export type RpcArgs = { [key: string]: RpcJson }

export interface RpcAction<TKind extends string = string> {
  kind: TKind
  /** The database call the button runs. */
  rpc: string
  args: RpcArgs
  /** A page to open once it is done. */
  openHref: string | null
}

/** What the browser needs to know about a card: its tool and the calls it may run. */
export interface RpcCardInfo<TTool extends string = string> {
  tool: TTool
  /** The write calls this tool does (they go on `ASSISTANT_COVERED`). */
  covers: readonly string[]
  /** The button, while it runs, and once done: "Create sheet", "Creating…", "Sheet created". */
  words: readonly [apply: string, applying: string, applied: string]
  /** What the card does, in plain words after "a card to": "create a sheet". */
  does: string
}

/** The copy group of a card's button words: `sheetbase.sheet.create` is `sheet_create`. */
export function wordsKeyOf(tool: string): string {
  return tool.replace(/^sheetbase\./, '').replaceAll('.', '_')
}

export function isRpcActionOf<TKind extends string>(
  infos: ReadonlyArray<RpcCardInfo<TKind>>,
) {
  const kinds = new Set<string>(infos.map((info) => info.tool))

  return (action: { kind: string }): action is RpcAction<TKind> =>
    kinds.has(action.kind)
}

/** Runs the card in the person's own session, so their access applies. */
export async function runRpcAction(
  client: Pick<DataClient, 'rpc'>,
  infos: ReadonlyArray<RpcCardInfo>,
  action: RpcAction,
): Promise<{ openHref?: string } | undefined> {
  const info = infos.find((each) => each.tool === action.kind)

  if (!info?.covers.includes(action.rpc)) {
    throw new Error('This card cannot run that change.')
  }

  const result = await client.rpc<{ status?: string } | null>(
    action.rpc,
    action.args,
  )

  // An upgrade that needs a person's choices answers `deferred` and changes nothing.
  if (result?.status === 'deferred') {
    throw new Error('It needs choices first. Open it and decide them there.')
  }

  return action.openHref ? { openHref: action.openHref } : undefined
}

/** The copy group of each card's words, by tool, for a feature's `cardWords`. */
export function cardWordKeys<TTool extends string>(
  feature: string,
  infos: ReadonlyArray<RpcCardInfo<TTool>>,
): Record<TTool, string> {
  // SAFETY: built from the same tool list the type is taken from, so every tool has its key.
  return Object.fromEntries(
    infos.map((info) => [
      info.tool,
      `features.${feature}.cards.${wordsKeyOf(info.tool)}`,
    ]),
  ) as Record<TTool, string>
}

/** The cards' words as the copy catalogue holds them (`copy.ts` of the feature). */
export function cardCopy(
  infos: ReadonlyArray<RpcCardInfo>,
): Record<string, { apply: string; applying: string; applied: string }> {
  return Object.fromEntries(
    infos.map(({ tool, words: [apply, applying, applied] }) => [
      wordsKeyOf(tool),
      { apply, applying, applied },
    ]),
  )
}
