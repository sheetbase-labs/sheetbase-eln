/**
 * The browser's way of asking the server to run a plugin's screen, column or
 * action. One POST to `/api/plugins/run`; a refusal carries a sentence a person
 * can read, which is thrown as an `Error` for the caller to show.
 */
import { z } from 'zod'

import type { JsonObject, JsonValue } from '#/lib/workspace-admin'
import type { PluginRowBag, PluginValueBag } from './plugin-values'
import type { ActionResult, ScreenResult } from './screens'
import type { ExtensionColumnValueType } from './hooks'

export type PluginHookBody =
  | {
      kind: 'screen'
      extensionKey: string
      point: 'blocks' | 'panels'
      itemId: string
      context: PluginValueBag
      state?: unknown
      event?: { action: string; values: PluginValueBag } | null
    }
  | {
      kind: 'column'
      extensionKey: string
      itemId: string
      rows: PluginRowBag[]
    }
  | {
      kind: 'column-action'
      extensionKey: string
      itemId: string
      actionId: string
      rows: PluginRowBag[]
    }
  | {
      kind: 'row-action'
      extensionKey: string
      itemId: string
      rows: PluginRowBag[]
    }
  | {
      kind: 'operation'
      extensionKey: string
      operationId: string
      input: PluginValueBag
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

/** The run routes' failure envelope: a sentence a person can read. */
const failureBodySchema = z.object({ error: z.string().optional() })

/** Any answer body: every route answers with one JSON object. */
const answerBodySchema = z.record(z.string(), z.json())

/** The JSON object a route answered with, or null when the body is not one. */
async function readAnswer(response: Response): Promise<JsonObject | null> {
  return (
    answerBodySchema.safeParse(await response.json().catch(() => null)).data ??
    null
  )
}

/** The sentence a refusal carries, or the generic one. */
function refusalSentence(answer: JsonObject | null): string {
  return (
    failureBodySchema.safeParse(answer).data?.error ??
    'The plugin could not do that.'
  )
}

export async function runPluginHook<T = PluginHookAnswer>(
  body: PluginHookBody,
  fetcher: typeof fetch = fetch,
): Promise<T> {
  const response = await fetcher('/api/plugins/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  const answer = await readAnswer(response)

  if (!response.ok || !answer) throw new Error(refusalSentence(answer))

  // SAFETY: the route answers only after `parseScreenResult`/`parseActionResult`
  // accept the shape, or after a column's values are counted against its rows;
  // `T` is the caller's chosen member of `PluginHookAnswer`.
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
    arguments: PluginValueBag
    confirmed: boolean
  },
  fetcher: typeof fetch = fetch,
): Promise<JsonValue> {
  const response = await fetcher('/api/plugins/host', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  const answer = hostAnswerSchema.safeParse(
    await response.json().catch(() => null),
  ).data

  if (!response.ok || !answer) {
    const refusal = hostRefusalSchema.safeParse(answer?.error).data

    throw Object.assign(
      new Error(refusal?.message ?? 'The plugin could not do that.'),
      { code: refusal?.code },
    )
  }

  return answer.result ?? null
}

/** A host call's answer: the tool's JSON result, or the refusal it carried. */
const hostAnswerSchema = z.object({
  result: z.json().optional(),
  error: z.json().optional(),
})

/**
 * A host call's refusal: a sentence, or a message with a machine code the
 * screen branches on.
 */
const hostRefusalSchema = z.union([
  z.string().transform((sentence) => ({ message: sentence, code: undefined })),
  z.object({ message: z.string().optional(), code: z.string().optional() }),
])

export interface HostConfirmation {
  /** Which call in the operation's run this is. */
  index: number
  name: string
  /** For `sheetbase.lab.act`, the action. */
  action: string | null
  /** What the action does, in words. */
  summary: string | null
}

/** The window the server opens when a call inside an operation would change something. */
const confirmationSchema = z.object({
  index: z.number(),
  name: z.string(),
  action: z.string().nullable(),
  summary: z.string().nullable(),
})

/** An operation's answer: its output, a confirmation window, or a refusal. */
const operationAnswerSchema = z.object({
  error: z.string().optional(),
  confirm: confirmationSchema.optional(),
  hostResults: z.array(z.json()).optional(),
})

/**
 * Runs a plugin's operation. If it calls into the app (`host_call` in the
 * plugin's Python) and a call would change something, the server stops and
 * says which; `ask` puts that to the person, and the run carries on from where
 * it stopped if they say yes. A no throws `declined`.
 */
export async function runPluginOperation<T = { output: unknown }>(
  body: {
    extensionKey: string
    operationId: string
    input: PluginValueBag
  },
  ask: (confirmation: HostConfirmation) => Promise<boolean>,
  declined: string,
  fetcher: typeof fetch = fetch,
): Promise<T> {
  let hostResults: JsonValue[] | undefined
  const approved: number[] = []

  for (;;) {
    const request: PluginValueBag = { kind: 'operation', ...body }

    if (hostResults) request.hostResults = hostResults

    if (approved.length > 0) request.approved = approved

    const response = await fetcher('/api/plugins/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    })

    const answer = operationAnswerSchema.safeParse(
      await response.json().catch(() => null),
    ).data

    if (response.status === 409 && answer?.confirm) {
      if (!(await ask(answer.confirm))) throw new Error(declined)

      hostResults = answer.hostResults
      approved.push(answer.confirm.index)
      continue
    }

    if (!response.ok || !answer)
      throw new Error(answer?.error ?? 'The plugin could not do that.')

    // SAFETY: the operation answer carries the values the plugin declared and
    // its run time; `T` is the caller's chosen shape for them.
    return answer as T
  }
}
