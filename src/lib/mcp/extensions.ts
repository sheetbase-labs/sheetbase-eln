import type { z } from 'zod'

import { listExtensions } from '../extensions/client'
import { fieldsJsonSchema, parsePluginName } from '../extensions/points'
import { resolveRunnerPoints } from '../extensions/runner-points'
import type { RunnerItem } from '../extensions/runner-points'
import type { ExtensionOperationDeclaration } from '../extensions/points'
import {
  ExtensionRunError,
  checkDeclaredValues,
} from '../extensions/runtime.server'
import { invokeWithHostCalls } from '../extensions/operation-host.server'
import type { Scope } from '../api-credential-scopes'
import type { McpContext, McpTool } from './handler'

/**
 * Tools an installed plugin adds to MCP.
 *
 * Listed per call from the workspace's enabled installs, so switching an
 * extension or one of its points off removes the tools at once. A read tool
 * runs straight away as the person the token belongs to. A write tool is an
 * agent action request, like `sheetbase.lab.act`: the workspace's agent
 * permission decides, and by default a person approves it in the Inbox, when
 * the plugin runs as them. Personal tokens only.
 */

type Item = RunnerItem<ExtensionOperationDeclaration>

const READ_ANY = (scopes: readonly Scope[]) =>
  scopes.some((scope) => scope.endsWith(':read'))

function allowed(context: McpContext, item: Item): boolean {
  if (context.actor.kind !== 'user') return false

  return item.declaration.access === 'read'
    ? context.flags.mcp_read && READ_ANY(context.scopes)
    : context.flags.mcp_lab && context.scopes.includes('lab:write')
}

async function items(context: McpContext): Promise<Item[]> {
  try {
    return resolveRunnerPoints(await listExtensions(context.client)).operations
  } catch {
    return []
  }
}

export async function listExtensionMcpTools(
  context: McpContext,
): Promise<McpTool[]> {
  if (context.actor.kind !== 'user') return []

  return (await items(context))
    .filter((item) => allowed(context, item))
    .map((item) => ({
      name: item.name,
      description:
        item.declaration.access === 'write'
          ? `${item.declaration.description} (Plugin: ${item.extensionName}. Follows the workspace's agent permissions: it may wait for a person to approve it.)`
          : `${item.declaration.description} (Plugin: ${item.extensionName}.)`,
      // SAFETY: fieldsJsonSchema constructs an object JSON Schema from the
      // declared field catalogue, with properties, required and additionalProperties.
      inputSchema: fieldsJsonSchema(
        item.declaration.inputs,
      ) as McpTool['inputSchema'],
      annotations: {
        title: item.declaration.title,
        readOnlyHint: item.declaration.access === 'read',
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    }))
}

export type ExtensionMcpOutcome =
  | { ok: true; value: unknown }
  | { ok: 'waiting'; requestId: string; message: string }
  | { ok: false; message: string; code?: string }

/** The action key an extension tool's request is recorded under. */
export function extensionActionKey(key: string, id: string): string {
  return `plugin.${key.replaceAll('-', '_')}.${id.replaceAll('-', '_')}`
}

const WAITING =
  'This is waiting for a person to approve it in Sheetbase (it is in their Inbox). Nothing has changed yet.'

export function isExtensionMcpTool(name: string): boolean {
  return parsePluginName(name) !== null
}

export async function callExtensionMcpTool(
  name: string,
  args: { [name: string]: z.JSONType },
  context: McpContext,
): Promise<ExtensionMcpOutcome> {
  const item = (await items(context)).find((entry) => entry.name === name)

  if (!item || !allowed(context, item)) {
    return {
      ok: false,
      message: 'The tool is not available to this credential.',
    }
  }

  const { declaration } = item
  let input: { [name: string]: z.JSONType }

  try {
    // SAFETY: args comes from the MCP JSON decoder. checkDeclaredValues
    // only projects its declared keys and never constructs non-JSON values.
    input = checkDeclaredValues(declaration.inputs, args, 'input') as {
      [name: string]: z.JSONType
    }
  } catch (error) {
    return {
      ok: false,
      code: 'invalid_arguments',
      message: error instanceof Error ? error.message : 'Invalid arguments.',
    }
  }

  // `approved`: a write that was approved (or allowed to run on its own) by
  // the workspace's agent permission, so the changes it makes into the app on
  // the person's behalf may be made. A read may call in to read.
  const run = async (approved = false) => {
    try {
      const outcome = await invokeWithHostCalls(
        {
          workspaceId: context.workspaceId,
          actorUserId: context.actor.id,
          extensionKey: item.extensionKey,
          itemId: item.id,
          input,
        },
        {
          workspaceId: context.workspaceId,
          userId: context.actor.id,
          client: async () => context.client,
          approve: approved ? 'all' : 'none',
        },
      )

      if (outcome.kind === 'confirm')
        return {
          ok: false as const,
          message: `${outcome.confirm.summary ?? 'This'} changes something and needs a person to confirm it in Sheetbase.`,
        }

      return { ok: true as const, value: outcome.result.output }
    } catch (error) {
      return {
        ok: false as const,
        message:
          error instanceof ExtensionRunError || error instanceof Error
            ? error.message
            : 'The plugin operation failed.',
      }
    }
  }

  if (declaration.access === 'read') return run()

  const actionKey = extensionActionKey(item.extensionKey, item.id)

  const argumentsJson = {
    extensionKey: item.extensionKey,
    operationId: item.id,
    input,
  }

  const waiting = await context.client.list<{
    id: string
    arguments: {
      extensionKey: string
      operationId: string
      input: { [name: string]: z.JSONType }
    }
  }>(
    'agent_action_requests',
    `?select=id,arguments&status=eq.pending&action_key=eq.${encodeURIComponent(actionKey)}&order=created_at.desc&limit=20`,
  )

  const same = waiting.find(
    (row) => JSON.stringify(row.arguments) === JSON.stringify(argumentsJson),
  )

  if (same) return { ok: 'waiting', requestId: same.id, message: WAITING }

  const request = await context.client.rpc<{ id: string; status: string }>(
    'request_agent_action',
    {
      p_workspace_id: context.workspaceId,
      p_action_key: actionKey,
      p_arguments: argumentsJson,
      p_summary:
        `${declaration.title} (${item.extensionName}): ${JSON.stringify(input)}`.slice(
          0,
          500,
        ),
      p_provenance: {
        agentId: `mcp:${context.credentialId}`,
        tool: item.name,
      },
      p_idempotency_key: `mcp-${crypto.randomUUID()}`,
    },
  )

  if (request.status === 'refused') {
    return {
      ok: false,
      code: 'agent_action_never',
      message: `${declaration.title} is switched off for agents in this workspace. A person can do it in Sheetbase.`,
    }
  }

  if (request.status === 'pending') {
    return { ok: 'waiting', requestId: request.id, message: WAITING }
  }

  // Auto: run now, then record how it ended.
  const outcome = await run(true)
  await context.client
    .rpc('finish_agent_action', {
      p_request_id: request.id,
      p_ok: outcome.ok,
      p_result: outcome.ok ? outcome.value : null,
      p_error: outcome.ok ? null : outcome.message,
    })
    .catch(() => undefined)

  return outcome
}
