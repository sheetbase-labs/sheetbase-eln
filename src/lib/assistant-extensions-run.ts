import { runPluginOperation } from './extensions/run-client'
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
  // The person pressed the card's button: what the operation does inside the
  // app (`host_call`) is covered by that same yes.
  await runPluginOperation(
    {
      extensionKey: action.extensionKey,
      operationId: action.operationId,
      input: action.input,
    },
    async () => true,
    'The plugin could not do that.',
  )

  return undefined
}
