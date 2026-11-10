/**
 * Runs the points that send data out: publishers (a table to another system)
 * and notification channels (a notification to a person's chat). Server-only.
 *
 * Neither can reach the network from the runner, so each works in steps. The
 * plugin says which requests to make, this module makes them (only to hosts the
 * plugin declared, only over HTTPS, never following a redirect) and the plugin
 * reads the answers. What an administrator set for the connection reaches the
 * plugin for the call that needs it, and nothing else does.
 *
 * Both go through the same gate as every plugin call (`withItem`): the plugin is
 * enabled, the part is switched on, the outcome is audited as `extension.invoked`
 * and every failure reaches the person as a plain sentence.
 */
import { z } from 'zod'

import {
  CONNECTOR_MAX_REQUESTS,
  CONNECTOR_TIMEOUT_MS,
  checkConnectorRequest,
  defaultFetch,
  withItem,
} from './data-runtime.server'
import type { ConnectorFetch, ConnectorResponse } from './data-runtime.server'
import {
  ExtensionRunError,
  checkDeclaredValues,
  defaultDeps,
  runPackage,
} from './runtime.server'
import type { ExtensionRuntimeDeps, ResolvedInstall } from './runtime.server'
import type {
  ExtensionNotificationChannelDeclaration,
  ExtensionPublisherDeclaration,
} from './data-points'
import { settingsScope } from './plugin-settings.server'

/** One stored JSON object: a publisher's row or a callable's input. */
const rowSchema = z.record(z.string(), z.unknown())

type Row = z.infer<typeof rowSchema>

/** One request's headers, as the plugin declared them. */
const requestHeadersSchema = z.record(z.string(), z.string())

/** A JSON body: what `JSON.parse` may return. */
const jsonValueSchema = z.json()

interface Caller {
  workspaceId: string
  actorUserId: string
  extensionKey: string
}

const sendPlan = z.strictObject({
  requests: z
    .array(
      z
        .strictObject({
          method: z.enum(['POST', 'PUT', 'PATCH']).default('POST'),
          url: z.string().min(1).max(2000),
          headers: z
            .record(
              z.string().regex(/^[A-Za-z][A-Za-z0-9-]{0,40}$/),
              z.string().max(4000),
            )
            .optional(),
          body: z.string().optional(),
          json: z.unknown().optional(),
        })
        .refine((r) => r.body === undefined || r.json === undefined, {
          message: 'A request has a body or json, not both.',
        }),
    )
    .min(1)
    .max(CONNECTOR_MAX_REQUESTS),
})

const publishAnswer = z.strictObject({
  message: z.string().trim().min(1).max(500),
  link: z
    .string()
    .url()
    .max(500)
    .refine((value) => /^https?:\/\//i.test(value))
    .optional(),
})

const bad = (message: string) => new ExtensionRunError('bad_answer', message)

/** The settings the call needs, or a plain sentence about what is missing. */
function requireSettings(
  declaration: Pick<ExtensionPublisherDeclaration, 'settings'>,
  given: Record<string, string>,
) {
  const out: Record<string, string> = {}

  for (const setting of declaration.settings) {
    // Absent settings are missing from the loaded object, whatever its type says.
    const value = z.string().safeParse(given[setting.name]).data

    if (setting.required && !value?.trim())
      throw new ExtensionRunError(
        'not_set_up',
        `“${setting.label}” isn’t set up yet. An administrator sets it in Settings › Plugins.`,
      )

    if (value !== undefined) out[setting.name] = value
  }

  return out
}

async function plan(
  deps: ExtensionRuntimeDeps,
  workspaceId: string,
  resolved: ResolvedInstall,
  entry: string,
  input: Row,
) {
  const planned = await runPackage(deps, workspaceId, resolved, {
    inputs: {},
    parameters: { kind: 'operation', entry, input },
  })

  const parsed = sendPlan.safeParse(planned.rows.at(0))

  if (!parsed.success)
    throw bad(
      'The plugin’s plan isn’t a list of requests (method, url, optional headers and body or json).',
    )

  return parsed.data.requests
}

/** The answer's JSON body, or null when it is not JSON. */
function jsonBody(text: string): z.infer<typeof jsonValueSchema> | null {
  try {
    return jsonValueSchema.parse(JSON.parse(text))
  } catch {
    return null
  }
}

/** Makes the planned requests, one after another, to the declared hosts only. */
async function send(
  declaration: { hosts: string[] },
  requests: Array<z.infer<typeof sendPlan>['requests'][number]>,
  fetchUrl: ConnectorFetch,
): Promise<ConnectorResponse[]> {
  const checked = requests.map((request) => ({
    method: request.method,
    ...checkConnectorRequest(declaration, request),
    body:
      request.json !== undefined ? JSON.stringify(request.json) : request.body,
    json: request.json !== undefined,
  }))

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CONNECTOR_TIMEOUT_MS)
  const responses: ConnectorResponse[] = []

  try {
    for (const request of checked) {
      const hasType = Object.keys(request.headers).some(
        (name) => name.toLowerCase() === 'content-type',
      )

      const headers: z.infer<typeof requestHeadersSchema> = {
        Accept: 'application/json, text/plain, */*',
      }

      if (request.body !== undefined && !hasType)
        headers['Content-Type'] = request.json
          ? 'application/json'
          : 'text/plain; charset=utf-8'

      Object.assign(headers, request.headers)

      const init: Parameters<ConnectorFetch>[1] = {
        method: request.method,
        headers,
        signal: controller.signal,
      }

      if (request.body !== undefined) init.body = request.body

      // react-doctor-disable-next-line react-doctor/async-await-in-loop -- The publisher's requests go out one after another, in the order the plugin planned them, so a refusal stops the rest instead of racing them.
      const answer = await fetchUrl(request.url, init).catch(
        // oxlint-disable-next-line anti-slop/no-unknown-parameters -- A rejected fetch carries whatever was thrown; only the run error passes through unchanged.
        (error: unknown) => {
          if (error instanceof ExtensionRunError) throw error
          throw new ExtensionRunError(
            'service_unreachable',
            `${request.url.hostname} could not be reached.`,
          )
        },
      )

      const text = new TextDecoder().decode(answer.body)
      const json = jsonBody(text)

      responses.push({
        url: request.url.toString(),
        status: answer.status,
        text,
        json,
      })
    }
  } finally {
    clearTimeout(timer)
  }

  return responses
}

// ---------------------------------------------------------------------------
// Publishers.
// ---------------------------------------------------------------------------

export interface PublishOutcome {
  message: string
  link?: string
  requests: number
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- The callable's rows arrive as unparsed JSON; the schema below decides, and a refusal is the caller's sentence.
function asRows(value: unknown): Row[] {
  const rows = z.array(rowSchema).safeParse(value)

  if (!rows.success)
    throw new ExtensionRunError(
      'bad_input',
      '“rows” should be a list of rows, each an object of column values.',
    )

  return rows.data
}

async function publish(
  deps: ExtensionRuntimeDeps,
  workspaceId: string,
  resolved: ResolvedInstall,
  declaration: ExtensionPublisherDeclaration,
  args: { rows: unknown; name?: string; parameters: unknown },
  fetchUrl: ConnectorFetch,
): Promise<PublishOutcome> {
  const rows = asRows(args.rows)

  const parameters = checkDeclaredValues(
    declaration.parameters,
    args.parameters ?? {},
    'input',
  )

  const settings = requireSettings(
    declaration,
    (await deps.loadSettings?.(
      workspaceId,
      resolved.install.id,
      settingsScope('publishers', declaration.id),
    )) ?? {},
  )

  // 1. The plugin says which requests to make.
  const requests = await plan(
    deps,
    workspaceId,
    resolved,
    declaration.runner.entry,
    { rows, name: args.name ?? '', parameters, settings },
  )

  // 2. The app makes them, to the declared hosts and nowhere else.
  const responses = await send(declaration, requests, fetchUrl)

  // 3. The plugin reads the answers and says what happened.
  const parsed = await runPackage(deps, workspaceId, resolved, {
    inputs: {},
    parameters: {
      kind: 'operation',
      entry: declaration.parse.entry,
      input: { responses, parameters },
    },
  })

  const answer = publishAnswer.safeParse(parsed.rows.at(0))

  if (!answer.success)
    throw bad(
      'The plugin’s answer should be a message of up to 500 characters and optionally a link.',
    )

  return { ...answer.data, requests: responses.length }
}

/** Publishing from an assistant card, a pipeline or the API: the same flow, audited by the caller. */
export async function publishFromCallable(
  deps: ExtensionRuntimeDeps,
  workspaceId: string,
  resolved: ResolvedInstall,
  itemId: string,
  input: Row,
  fetchUrl: ConnectorFetch = defaultFetch,
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- The callable's answer is the publisher's own JSON outcome, carried in the runtime's dictionary envelope; `PublishOutcome` is what this file builds it from.
): Promise<Record<string, unknown>> {
  const declaration = resolved.manifest.contributions.publishers?.find(
    (entry) => entry.id === itemId,
  )

  if (!declaration)
    throw new ExtensionRunError(
      'not_declared',
      'That plugin doesn’t offer this any more.',
    )
  const { rows, name, ...parameters } = input
  const senderName = z.string().safeParse(name).data

  const outcome = await publish(
    deps,
    workspaceId,
    resolved,
    declaration,
    {
      rows,
      name: senderName,
      parameters,
    },
    fetchUrl,
  )

  return { ...outcome }
}

/** Sends rows to another system with a plugin publisher, for a person using the app. */
export async function runExtensionPublisher(
  args: Caller & {
    publisherId: string
    rows: unknown
    name?: string
    parameters: unknown
  },
  deps: ExtensionRuntimeDeps = defaultDeps(),
  fetchUrl: ConnectorFetch = defaultFetch,
): Promise<PublishOutcome & { durationMs: number }> {
  const { value, durationMs } = await withItem(
    deps,
    args,
    'publishers',
    args.publisherId,
    (declaration, resolved) =>
      publish(deps, args.workspaceId, resolved, declaration, args, fetchUrl),
  )

  return { ...value, durationMs }
}

// ---------------------------------------------------------------------------
// Notification channels.
// ---------------------------------------------------------------------------

export interface ChannelNotification {
  event: string
  title: string
  body: string
  /** An address the person can open, from the app's own base address. */
  link: string
  at: string
}

const failureLine = (response: ConnectorResponse) =>
  `${new URL(response.url).hostname} answered ${response.status}${
    response.text.trim() ? `: ${response.text.trim().slice(0, 160)}` : ''
  }`

async function deliver(
  deps: ExtensionRuntimeDeps,
  workspaceId: string,
  resolved: ResolvedInstall,
  declaration: ExtensionNotificationChannelDeclaration,
  args: { destination: string; notification: ChannelNotification },
  fetchUrl: ConnectorFetch,
): Promise<void> {
  const settings = requireSettings(
    declaration,
    (await deps.loadSettings?.(
      workspaceId,
      resolved.install.id,
      settingsScope('notification-channels', declaration.id),
    )) ?? {},
  )

  const requests = await plan(
    deps,
    workspaceId,
    resolved,
    declaration.runner.entry,
    {
      notification: args.notification,
      destination: args.destination,
      settings,
    },
  )

  const responses = await send(declaration, requests, fetchUrl)

  if (declaration.parse) {
    // The plugin knows what its service calls a refusal (Slack answers 200 with ok: false).
    await runPackage(deps, workspaceId, resolved, {
      inputs: {},
      parameters: {
        kind: 'operation',
        entry: declaration.parse.entry,
        input: { responses, destination: args.destination },
      },
    })

    return
  }

  const refused = responses.find(
    (response) => response.status < 200 || response.status >= 300,
  )

  if (refused)
    throw new ExtensionRunError('service_refused', failureLine(refused))
}

/** Sends one notification down a plugin channel to where a person asked for it. */
export async function runChannelDelivery(
  args: Caller & {
    channelId: string
    destination: string
    notification: ChannelNotification
  },
  deps: ExtensionRuntimeDeps = defaultDeps(),
  fetchUrl: ConnectorFetch = defaultFetch,
): Promise<{ durationMs: number }> {
  const { durationMs } = await withItem(
    deps,
    args,
    'notification-channels',
    args.channelId,
    (declaration, resolved) =>
      deliver(deps, args.workspaceId, resolved, declaration, args, fetchUrl),
  )

  return { durationMs }
}
