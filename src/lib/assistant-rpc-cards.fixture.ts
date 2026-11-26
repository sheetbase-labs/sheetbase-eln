import type { core } from 'zod'

import type { LabToolContext } from './assistant-lab-tools.server'
import { rpcFamily } from './assistant-rpc-cards.server'
import type { RpcCard } from './assistant-rpc-cards.server'
import type { RpcAction } from './assistant-rpc-cards'
import { createDataClient } from './data-client'

/**
 * Test support for the RPC cards: a lab whose tables answer from a fixture, and
 * a way to ask a family for a card and read the action it would run.
 */

type Rows = core.util.JSONType[]

export type Tables = Record<string, Rows | ((url: URL) => Rows)>

const urlOf = (input: Parameters<typeof fetch>[0]): URL =>
  input instanceof Request ? new URL(input.url) : new URL(input, 'http://x')

/** Answers each table by name; anything not listed is empty. */
export function context(tables: Tables): LabToolContext {
  const fetchFixture: typeof fetch = async (input) => {
    const url = urlOf(input)

    const name = url.pathname.split('/').at(-1) ?? ''
    const answer = Object.hasOwn(tables, name) ? tables[name] : []

    return Response.json(Array.isArray(answer) ? answer : answer(url))
  }

  return {
    client: createDataClient(fetchFixture),
    workspaceId: 'ws',
    userId: 'me',
    timeZone: 'Europe/London',
  }
}

const base = { title: 'T', summary: 'S' }

export interface Asked {
  ok: boolean
  message?: string
  action?: RpcAction
  changes?: Array<{ label: string; before: string | null; after: string }>
  target?: string
}

/** Asks the family for one card the way the model would, and reads the outcome. */
export async function ask(
  cards: readonly RpcCard[],
  tool: string,
  input: Record<string, core.util.JSONType>,
  tables: Tables,
): Promise<Asked> {
  const result = await rpcFamily(cards).build(
    tool,
    { ...base, ...input },
    context(tables),
  )

  if (!result.ok) return { ok: false, message: result.message }

  const { action, changes, target } = result.proposal

  return {
    ok: true,
    // SAFETY: the cards under test only ever build RPC actions.
    action: action as RpcAction | undefined,
    changes,
    target,
  }
}
