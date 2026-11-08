/**
 * The browser's way of asking the server to run a plugin's screen, column or
 * action. One POST to `/api/plugins/run`; a refusal carries a sentence a person
 * can read, which is thrown as an `Error` for the caller to show.
 */
import type { ActionResult, ScreenResult } from './screens'
import type { ExtensionColumnValueType } from './hooks'

export type PluginHookBody =
  | {
      kind: 'screen'
      extensionKey: string
      point: 'blocks' | 'panels'
      itemId: string
      context: Record<string, unknown>
      state?: unknown
      event?: { action: string; values: Record<string, unknown> } | null
    }
  | {
      kind: 'column'
      extensionKey: string
      itemId: string
      rows: Array<Record<string, unknown>>
    }
  | {
      kind: 'column-action'
      extensionKey: string
      itemId: string
      actionId: string
      rows: Array<Record<string, unknown>>
    }
  | {
      kind: 'row-action'
      extensionKey: string
      itemId: string
      rows: Array<Record<string, unknown>>
    }
  | {
      kind: 'operation'
      extensionKey: string
      operationId: string
      input: Record<string, unknown>
    }

export type PluginHookAnswer =
  | ({ kind: 'screen'; durationMs: number } & ScreenResult)
  | {
      kind: 'column'
      values: Array<string | number | boolean | null>
      value: ExtensionColumnValueType
      durationMs: number
    }
  | ({ kind: 'action'; durationMs: number } & ActionResult)

export async function runPluginHook<T = PluginHookAnswer>(
  body: PluginHookBody,
  fetcher: typeof fetch = fetch,
): Promise<T> {
  const response = await fetcher('/api/plugins/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const answer = (await response.json().catch(() => null)) as
    (Record<string, unknown> & { error?: string }) | null
  if (!response.ok || !answer)
    throw new Error(
      typeof answer?.error === 'string'
        ? answer.error
        : 'The plugin could not do that.',
    )
  return answer as T
}

/**
 * A plugin screen's way into the app: any tool the MCP server has, by its MCP
 * name, as the signed-in person. `confirmed` says the person was asked, which
 * the server requires for `sheetbase.lab.act` calls that change something.
 */
export async function runPluginHost(
  body: {
    extensionKey: string
    point: string
    name: string
    arguments: Record<string, unknown>
    confirmed: boolean
  },
  fetcher: typeof fetch = fetch,
): Promise<unknown> {
  const response = await fetcher('/api/plugins/host', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const answer = (await response.json().catch(() => null)) as {
    result?: unknown
    error?: { message?: string; code?: string } | string
  } | null
  if (!response.ok || !answer) {
    const error = answer?.error
    throw Object.assign(
      new Error(
        typeof error === 'string'
          ? error
          : (error?.message ?? 'The plugin could not do that.'),
      ),
      { code: typeof error === 'object' ? error.code : undefined },
    )
  }
  return answer.result ?? null
}
