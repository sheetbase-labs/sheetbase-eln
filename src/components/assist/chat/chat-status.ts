import { t } from '#/copy'
import { z } from 'zod'

import { messageText } from '#/lib/assistant-chat'
import type { AssistantUIMessage } from '#/lib/assistant-chat'

/** A refusal the server sends as JSON: `{ message }`, and nothing else it adds. */
const refusalBody = z.looseObject({ message: z.string() })

/** The server answers refusals with `{ message }`; a stream error is plain text. */
export function errorText(error: Error): string {
  try {
    const message = refusalBody.safeParse(JSON.parse(error.message)).data
      ?.message

    if (message !== undefined) return message
  } catch {
    // Not JSON: the text is already the message.
  }

  return error.message || t('notebook.assistantPanel.tryAgainOrAsk')
}

/** Waiting for the first words of an answer, rather than for a tool call. */
export function isWaitingForAnswer(
  status: string,
  last: AssistantUIMessage | undefined,
): boolean {
  if (status === 'submitted') return true

  if (status !== 'streaming' || last?.role !== 'assistant') return false

  return (
    messageText(last).trim() === '' &&
    !last.parts.some((part) => part.type === 'dynamic-tool')
  )
}
