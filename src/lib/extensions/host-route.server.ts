/**
 * POST /api/plugins/host: a plugin screen uses the app. Every tool the MCP
 * server has is open to it under the tool's own MCP name (`sheetbase.lab.act`,
 * `sheetbase.canonical.read`, `sheetbase.search` and the rest), run as the
 * person using the screen. There is no separate list for plugins: a tool added
 * for agents and the API is there for plugins the moment it exists.
 *
 * What stands between a screen and an action:
 * - the plugin asked for the scope at install (`permissions`, shown to the
 *   administrator who added it), and the tool needs that scope;
 * - for `sheetbase.lab.act`, anything that changes data is only run once the
 *   screen host has asked the person (`confirmed`), and is run straight away
 *   because that person just said yes, not put through the agent permission
 *   queue a second time;
 * - the database: row-level security and each action's own role checks decide
 *   what the person can do.
 * Every call is written to the change log under the plugin. Server-only.
 */
import { z } from 'zod'

import { VALID_SCOPES } from '../api-credential-scopes'
import type { Scope } from '../api-credential-scopes'
import { AI_FEATURE_FLAG_KEYS } from '../ai-feature-flags'
import type { AiFeatureFlags } from '../ai-feature-flags'
import { createServerDataClient } from '../connectors/enterprise/execution.server'
import type { DataClient } from '../data-client'
import { handleMcpMessage } from '../mcp/handler'
import type { McpContext } from '../mcp/handler'
import { LAB_ACT_TOOL_NAME } from '../mcp/lab'
import { pipelineJsonObjectSchema } from '../pipelines/types'
import {
  realSessionAuthDeps,
  requestErrorResponse,
  resolveSessionAuth,
} from '../request-auth'
import type { SessionAuthDeps } from '../request-auth'
import { checkAppAction } from './app-actions'
import { listExtensions } from './client'
import type { ExtensionWire } from './client'
import { extensionAuditIdentity } from './contract'
import { parseExtensionManifest } from './manifest'
import { defaultDeps } from './runtime.server'
import type { ExtensionRuntimeDeps } from './runtime.server'

const idPattern = /^[a-z][a-z0-9-]{0,48}$/

const bodySchema = z.strictObject({
  extensionKey: z.string().regex(idPattern),
  point: z.string().regex(idPattern),
  /** An MCP tool name, such as `sheetbase.lab.act`. */
  name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9._-]{0,99}$/),
  arguments: z.record(z.string(), z.unknown()).default({}),
  confirmed: z.boolean().default(false),
})

export interface PluginHostRouteDeps {
  auth: SessionAuthDeps
  makeClient: (token: string) => DataClient
  runtime: Pick<ExtensionRuntimeDeps, 'audit'>
}

const isScope = (value: string): value is Scope =>
  (VALID_SCOPES as readonly string[]).includes(value)

export async function handlePluginHost(
  request: Request,
  deps: PluginHostRouteDeps = defaultRouteDeps(),
): Promise<Response> {
  if (request.method !== 'POST')
    return requestErrorResponse(405, 'method_not_allowed', 'Use POST.')
  const auth = await resolveSessionAuth(request.headers, deps.auth)

  if (!auth.ok)
    return requestErrorResponse(auth.status, auth.code, auth.message)
  const { context } = auth
  let raw: unknown

  try {
    raw = await request.json()
  } catch {
    return requestErrorResponse(400, 'bad_request', 'Send a JSON body.')
  }

  const parsed = bodySchema.safeParse(raw)

  if (!parsed.success)
    return requestErrorResponse(
      400,
      'bad_request',
      'The request could not be read.',
    )
  const body = parsed.data
  const client = deps.makeClient(context.token)

  const install = (await listExtensions(client)).find(
    (row) => row.key === body.extensionKey,
  )

  if (!install)
    return requestErrorResponse(
      404,
      'not_installed',
      'That plugin is not installed.',
    )

  if (
    install.status !== 'enabled' ||
    install.disabled_points.includes(body.point)
  )
    return requestErrorResponse(
      409,
      'not_enabled',
      'An administrator has switched this part of the plugin off.',
    )

  const outcome = await performHostCall(deps, {
    workspaceId: context.workspaceId,
    userId: context.userId,
    client,
    install,
    point: body.point,
    name: body.name,
    arguments: body.arguments,
    confirmed: body.confirmed,
  })

  if (!outcome.ok)
    return requestErrorResponse(outcome.status, outcome.code, outcome.message)

  return Response.json(
    { name: body.name, result: outcome.result },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

export type HostCallOutcome =
  | { ok: true; result: unknown }
  | {
      ok: false
      status: number
      code: string
      message: string
      /** For `confirmation_needed`: what the action does, in words. */
      summary?: string
    }

const fail = (
  status: number,
  code: string,
  message: string,
  summary?: string,
): HostCallOutcome => ({
  ok: false,
  status,
  code,
  message,
  ...(summary ? { summary } : {}),
})

export interface HostCall {
  workspaceId: string
  userId: string
  client: DataClient
  install: ExtensionWire
  point: string
  name: string
  arguments: Record<string, unknown>
  confirmed: boolean
}

/**
 * One call into the app for a plugin: checks the scope the plugin asked for,
 * asks for confirmation of a change, runs it as the person and audits it. Used
 * by the screen route below and by Python operations that call into the app.
 */
export async function performHostCall(
  deps: Pick<PluginHostRouteDeps, 'runtime'>,
  call: HostCall,
): Promise<HostCallOutcome> {
  let manifest

  try {
    manifest = parseExtensionManifest(call.install.manifest)
  } catch {
    return fail(409, 'bad_manifest', 'That plugin is damaged.')
  }

  const toolArguments = pipelineJsonObjectSchema.safeParse(call.arguments)

  if (!toolArguments.success)
    return fail(
      400,
      'invalid_arguments',
      'The tool arguments must be a JSON object.',
    )

  const granted = manifest.scopes.filter(isScope)

  let writes = false
  let label = call.name
  let run: () => Promise<unknown>

  if (call.name === LAB_ACT_TOOL_NAME) {
    const action = toolArguments.data.action
    const checked = checkAppAction(action, toolArguments.data.arguments ?? {})

    if (!checked.ok) return fail(400, 'invalid_arguments', checked.message)

    if (!granted.includes(checked.rpc.scope))
      return fail(
        403,
        'scope_missing',
        `This plugin did not ask for ${checked.rpc.scope}, which ${checked.action} needs.`,
      )
    writes = checked.writes
    label = `${call.name}:${checked.action}`

    if (writes && !call.confirmed)
      return fail(
        409,
        'confirmation_needed',
        'This changes something, so the person has to confirm it first.',
        checked.rpc.summary,
      )
    run = () => call.client.rpc<unknown>(checked.action, checked.args)
  } else {
    const mcp: McpContext = {
      workspaceId: call.workspaceId,
      actor: { kind: 'user', id: call.userId },
      scopes: granted,
      flags: Object.fromEntries(
        AI_FEATURE_FLAG_KEYS.map((key) => [key, true]),
      ) as AiFeatureFlags,
      client: call.client,
      credentialId: `plugin:${call.install.key}`,
    }

    run = async () => {
      const response = await handleMcpMessage(
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: call.name, arguments: toolArguments.data },
        },
        mcp,
      )

      if (!response || 'error' in response)
        throw new Error(
          response && 'error' in response
            ? response.error.message
            : 'The tool did not answer.',
        )

      const result = response.result as {
        content?: Array<{ text?: string }>
        isError?: boolean
        structuredContent?: unknown
      }

      const text = result.content?.map((part) => part.text ?? '').join('\n')

      if (result.isError) throw new Error(text || 'The tool refused.')

      if (result.structuredContent !== undefined)
        return result.structuredContent

      try {
        return JSON.parse(text ?? 'null') as unknown
      } catch {
        return text ?? null
      }
    }
  }

  const audit = (ok: boolean, error?: string) =>
    deps.runtime
      .audit({
        workspaceId: call.workspaceId,
        actorUserId: call.userId,
        extensionId: call.install.id,
        payload: {
          change: 'used-app',
          extensionKey: call.install.key,
          point: call.point,
          tool: label,
          writes,
          ok,
          ...(error ? { error: error.slice(0, 300) } : {}),
          ...extensionAuditIdentity({
            extensionId: call.install.id,
            extensionKey: call.install.key,
            manifest,
          }),
        },
      })
      .catch(() => undefined)

  try {
    const result = await run()
    await audit(true)

    return { ok: true, result: result ?? null }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'The action could not be done.'

    await audit(false, message)

    return fail(422, 'action_failed', message)
  }
}

function defaultRouteDeps(): PluginHostRouteDeps {
  return {
    auth: realSessionAuthDeps,
    makeClient: createServerDataClient,
    runtime: defaultDeps(),
  }
}
