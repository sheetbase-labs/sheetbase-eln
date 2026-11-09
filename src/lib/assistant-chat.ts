import type { UIMessage } from 'ai'

import type { AssistantSource, AssistantUsage } from './assistant'
import type { ChatTurn } from './ai-providers/types'

/**
 * What rides alongside an assistant message in the chat stream: the sources the
 * answer was grounded on, and (once the answer is complete) its usage. Not
 * part of the text, and never sent back to the model as history.
 */
export interface AssistantMessageMetadata {
  mode?: 'built-in' | 'provider'
  providerProfile?: string | null
  sources?: AssistantSource[]
  usage?: AssistantUsage
}

export type AssistantUIMessage = UIMessage<AssistantMessageMetadata>

/** Longest question the assistant accepts. Shared by the box and the server. */
export const ASSISTANT_MAX_QUESTION_CHARS = 2_000

export const ASSISTANT_CHAT_PATH = '/api/assistant/chat'

/** The text of a message: its text parts, in order. */
export function messageText(message: UIMessage): string {
  return message.parts
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('')
}

/**
 * The conversation as plain turns for the server. Empty messages (a failed or
 * still-empty answer) are dropped so history only holds real exchanges.
 */
export function toChatTurns(messages: UIMessage[]): ChatTurn[] {
  const turns: ChatTurn[] = []

  for (const message of messages) {
    if (message.role !== 'user' && message.role !== 'assistant') continue
    const content = messageText(message).trim()

    if (content === '') continue
    turns.push({ role: message.role, content })
  }

  return turns
}
