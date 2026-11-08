/**
 * Tools an installed extension adds to the assistant and to MCP.
 *
 * The extension declares each tool: its name, what it is for, its inputs and
 * whether it only reads or also writes. A read tool runs straight away, as the
 * person asking, and its answer goes back to the model. A write tool never runs
 * from the model's call: it becomes a card, the person presses the button, and
 * the extension runs then. An extension cannot sign, approve or attest; those
 * stay human-only whatever it declares.
 */
import type { ExtensionField } from './extensions/points'

/** Prefix of every extension tool name (`plugin.<key>.<tool>`). */
export const EXTENSION_TOOL_PREFIX = 'plugin.'

/** Longest tool name providers accept, after the dots become `__`. */
export const MAX_WIRE_TOOL_NAME = 64

export function isExtensionToolName(name: string): boolean {
  return name.startsWith(EXTENSION_TOOL_PREFIX)
}

/** What an extension tool card does when its button is pressed. */
export interface ExtensionToolAction {
  kind: 'plugin.run'
  extensionKey: string
  operationId: string
  input: Record<string, unknown>
}

export function isExtensionToolAction(action: {
  kind: string
}): action is ExtensionToolAction {
  return action.kind === 'plugin.run'
}

export interface ExtensionToolActionResult {
  openHref?: string
}

/** A plain-words line for a value on a card. */
export function describeFieldValue(
  field: Pick<ExtensionField, 'type'>,
  value: unknown,
): string {
  if (value === null || value === undefined) return ''
  if (field.type === 'json') return JSON.stringify(value)
  return String(value)
}
