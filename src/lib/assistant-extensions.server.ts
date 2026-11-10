import { listExtensions } from './extensions/client'
import { invokeWithHostCalls } from './extensions/operation-host.server'
import { pluginOperationName, fieldsJsonSchema } from './extensions/points'
import { resolveRunnerPoints } from './extensions/runner-points'
import type { RunnerItem } from './extensions/runner-points'
import type { ExtensionOperationDeclaration } from './extensions/points'
import {
  ExtensionRunError,
  checkDeclaredValues,
  invokeExtension,
} from './extensions/runtime.server'
import {
  MAX_WIRE_TOOL_NAME,
  describeFieldValue,
  isExtensionToolName,
} from './assistant-extensions'
import type { ExtensionToolAction } from './assistant-extensions'
import type { AssistantProposal, ProposalChange } from './assistant-proposals'
import type { DataClient } from './data-client'
import type { ProviderToolDef } from './ai-providers/types'

/**
 * The assistant's view of extension tools (see `assistant-extensions.ts`).
 * Tools are looked up per question from the person's own view of the
 * workspace's installs, so a switched-off or removed extension is gone at once.
 */

export type ExtensionToolItem = RunnerItem<ExtensionOperationDeclaration>

export interface ExtensionToolset {
  items: ExtensionToolItem[]
  /** The tools as the model sees them. Writes only when agents may draft. */
  defs: (allowWrites: boolean) => ProviderToolDef[]
  find: (name: string) => ExtensionToolItem | undefined
}

const wireName = (name: string) => name.replaceAll('.', '__')

export async function loadExtensionToolset(
  client: DataClient,
): Promise<ExtensionToolset> {
  let items: ExtensionToolItem[] = []

  try {
    const installs = await listExtensions(client)
    items = resolveRunnerPoints(installs).operations.filter(
      // A name providers would refuse never reaches the model.
      (item) => wireName(item.name).length <= MAX_WIRE_TOOL_NAME,
    )
  } catch {
    // The lookup failing leaves the assistant without extension tools, never broken.
  }

  return {
    items,
    defs: (allowWrites) =>
      items
        .filter((item) => allowWrites || item.declaration.access === 'read')
        .map((item) => ({
          name: wireName(item.name),
          description:
            item.declaration.access === 'write'
              ? `${item.declaration.description} (From the ${item.extensionName} extension. Proposes a change: the person sees a card and presses a button to do it; nothing happens until they do.)`
              : `${item.declaration.description} (From the ${item.extensionName} extension. Reads only.)`,
          parameters: fieldsJsonSchema(item.declaration.inputs),
        })),
    find: (name) => items.find((item) => item.name === name),
  }
}

export function isExtensionTool(name: string): boolean {
  return isExtensionToolName(name)
}

export type ExtensionToolOutcome =
  | { ok: true; text: string; proposal?: AssistantProposal }
  | { ok: false; message: string }

/** Runs a read tool, or builds the card for a write tool. */
export async function runExtensionTool(
  toolset: ExtensionToolset,
  name: string,
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- The model's tool call arrives unparsed; checkDeclaredValues decodes it against the operation's declared fields before a read or a card uses it.
  args: Record<string, unknown>,
  context: {
    workspaceId: string
    userId: string
    allowWrites: boolean
    /** The person's own access, for an operation that calls into the app. */
    client?: DataClient
  },
): Promise<ExtensionToolOutcome> {
  const item = toolset.find(name)

  if (!item) return { ok: false, message: 'That tool is not available.' }
  const { declaration } = item

  if (declaration.access === 'write') {
    if (!context.allowWrites)
      return { ok: false, message: 'That tool is not available.' }
    let input: ReturnType<typeof checkDeclaredValues>

    try {
      input = checkDeclaredValues(declaration.inputs, args, 'input')
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Invalid input.',
      }
    }

    const changes: ProposalChange[] = declaration.inputs
      .filter((field) => input[field.name] !== undefined)
      .map((field) => ({
        label: field.description?.slice(0, 40) ?? field.name,
        before: null,
        after: describeFieldValue(field, input[field.name]),
      }))

    const action: ExtensionToolAction = {
      kind: 'plugin.run',
      extensionKey: item.extensionKey,
      operationId: item.id,
      input,
    }

    return {
      ok: true,
      text: 'The person now sees this as a card with a button to do it. Nothing has changed yet. Say in one sentence what you proposed, then stop.',
      proposal: {
        tool: pluginOperationName(item.extensionKey, item.id),
        title: declaration.title,
        summary:
          `${declaration.title}, from the ${item.extensionName} extension.`.slice(
            0,
            400,
          ),
        target: item.extensionName,
        deepLink: null,
        changes,
        action,
      },
    }
  }

  try {
    const call = {
      workspaceId: context.workspaceId,
      actorUserId: context.userId,
      extensionKey: item.extensionKey,
      itemId: item.id,
      input: args,
    }

    // A read may call into the app (`host_call`) for what it needs to read.
    const hostClient = context.client

    const outcome = hostClient
      ? await invokeWithHostCalls(call, {
          workspaceId: context.workspaceId,
          userId: context.userId,
          client: async () => hostClient,
          approve: 'none',
        })
      : ({ kind: 'done', result: await invokeExtension(call) } as const)

    if (outcome.kind === 'confirm')
      return {
        ok: false,
        message: 'That tool tried to change something; it can only read.',
      }

    return { ok: true, text: JSON.stringify(outcome.result.output) }
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof ExtensionRunError || error instanceof Error
          ? error.message
          : 'The extension tool failed.',
    }
  }
}
