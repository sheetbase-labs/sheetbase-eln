import type {
  ExtensionToolAction,
  ExtensionToolActionResult,
} from './assistant-extensions'

/**
 * Runs an extension tool card's action. Loaded only in the browser, when a
 * button is pressed: the server runs the extension as the person, after
 * checking again that it is installed, enabled and still declares the tool.
 */
export async function runExtensionToolAction(
  action: ExtensionToolAction,
): Promise<ExtensionToolActionResult | undefined> {
  const response = await fetch('/api/extensions/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      kind: 'tool',
      extensionKey: action.extensionKey,
      toolId: action.toolId,
      input: action.input,
    }),
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string
    } | null
    throw new Error(body?.error ?? 'The extension could not do that.')
  }
  return undefined
}
