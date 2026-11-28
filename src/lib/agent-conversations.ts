import { z } from 'zod'

import type { DataClient } from '#/lib/data-client'
import type { AssistantUIMessage } from '#/lib/assistant-chat'
import { messageText } from '#/lib/assistant-chat'
import { cardOutcomeFor } from '#/lib/assistant-card-outcomes'

/**
 * The Agent page's saved conversations: the list on the left of the page and
 * the messages of one. They are the person's own (row-level security), kept
 * through `save_assistant_conversation` and friends.
 */

export interface ConversationSummary {
  id: string
  title: string
  created_at: string
  updated_at: string
}

export interface ConversationRow extends ConversationSummary {
  messages: AssistantUIMessage[]
}

export const conversationKeys = {
  all: (workspaceId: string) => ['agent-conversations', workspaceId] as const,
  one: (workspaceId: string, id: string) =>
    ['agent-conversations', workspaceId, id] as const,
}

const LIST_LIMIT = 200

export function fetchConversations(
  client: DataClient,
  workspaceId: string,
): Promise<ConversationSummary[]> {
  return client.list<ConversationSummary>(
    'assistant_conversations',
    `?select=id,title,created_at,updated_at&workspace_id=eq.${workspaceId}&order=updated_at.desc&limit=${LIST_LIMIT}`,
  )
}

export async function fetchConversation(
  client: DataClient,
  id: string,
): Promise<ConversationRow | null> {
  const rows = await client.list<ConversationRow>(
    'assistant_conversations',
    `?select=id,title,created_at,updated_at,messages&id=eq.${id}&limit=1`,
  )

  return rows.at(0) ?? null
}

/** Messages worth keeping: the ones that were answered, not a failed attempt. */
export function messagesToSave(
  messages: readonly AssistantUIMessage[],
): AssistantUIMessage[] {
  return messages.flatMap((message) => {
    const kept =
      message.role === 'user' ||
      messageText(message).trim() !== '' ||
      message.parts.some((part) => part.type === 'dynamic-tool')

    return kept ? [withOutcomes(message)] : []
  })
}

const savedOutputObject = z.looseObject({})

/** A card's outcome is saved on its tool part, so a later chat can read it. */
function withOutcomes(message: AssistantUIMessage): AssistantUIMessage {
  if (message.role !== 'assistant') return message

  return {
    ...message,
    parts: message.parts.map((part) => {
      if (part.type !== 'dynamic-tool' || part.state !== 'output-available')
        return part
      const outcome = cardOutcomeFor(part.toolCallId)
      const output = savedOutputObject.safeParse(part.output)

      return outcome && output.success
        ? { ...part, output: { ...output.data, outcome } }
        : part
    }),
  }
}

export function saveConversation(
  client: DataClient,
  input: {
    id: string
    messages: readonly AssistantUIMessage[]
    title?: string
  },
): Promise<ConversationSummary> {
  return client.rpc<ConversationSummary>('save_assistant_conversation', {
    p_conversation_id: input.id,
    p_messages: messagesToSave(input.messages),
    p_title: input.title ?? null,
  })
}

export async function renameConversation(
  client: DataClient,
  id: string,
  title: string,
): Promise<void> {
  await client.rpc<unknown>('rename_assistant_conversation', {
    p_conversation_id: id,
    p_title: title,
  })
}

export async function deleteConversation(
  client: DataClient,
  id: string,
): Promise<void> {
  await client.rpc<unknown>('delete_assistant_conversation', {
    p_conversation_id: id,
  })
}

const TITLE_CHARS = 48

/** Greetings and polite lead-ins that say nothing about the chat. */
const LEAD_INS = [
  /^(?:hi|hello|hey)(?: there)?\b[\s,!.]*/i,
  /^(?:please|pls|ok(?:ay)?|so)\b[\s,]*/i,
  /^(?:could|can|would|will) you(?: please)?\s+/i,
  /^i(?:'d|’d| would) like (?:you )?to\s+/i,
  /^i (?:want|need) you to\s+/i,
  /^(?:help me|i need to|i want to)\s+/i,
]

/** "setup a" reads as the verb in a title. */
const SET_UP = /^setup\b/i

/**
 * A conversation's title: what the person asked, as a short name. Greetings
 * and lead-ins such as "I'd like you to" are dropped so chats that start alike
 * still read apart, only the first sentence is kept, and a long one is cut at
 * a word.
 */
export function titleFromMessages(
  messages: readonly AssistantUIMessage[],
): string | undefined {
  const first = messages.find((message) => message.role === 'user')
  let text = first ? messageText(first).replaceAll(/\s+/g, ' ').trim() : ''

  for (let changed = true; changed;) {
    changed = false

    for (const lead of LEAD_INS) {
      const next = text.replace(lead, '')

      if (next !== text && next.trim() !== '') {
        text = next.trim()
        changed = true
      }
    }
  }

  text = text.replace(SET_UP, 'set up')

  const sentence = /^(.+?[.?!])(?:\s|$)/.exec(text)?.[1] ?? text

  text = sentence.replace(/[.!]+$/, '').trim()

  if (text === '') return undefined

  text = `${text.charAt(0).toUpperCase()}${text.slice(1)}`

  if (text.length <= TITLE_CHARS) return text

  const cut = text.slice(0, TITLE_CHARS - 1)
  const word = cut.lastIndexOf(' ')

  return `${(word > TITLE_CHARS / 2 ? cut.slice(0, word) : cut).replace(/[\s,;:–-]+$/, '')}…`
}

export type ConversationGroup = 'today' | 'yesterday' | 'week' | 'earlier'

const GROUP_ORDER: readonly ConversationGroup[] = [
  'today',
  'yesterday',
  'week',
  'earlier',
]

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

export function groupOf(updatedAt: string, now: Date): ConversationGroup {
  const day = 86_400_000
  const age = startOfDay(now) - startOfDay(new Date(updatedAt))

  if (age <= 0) return 'today'

  if (age <= day) return 'yesterday'

  if (age <= 7 * day) return 'week'

  return 'earlier'
}

/** The list in groups, newest first, leaving out the groups with nothing in them. */
export function groupConversations(
  rows: readonly ConversationSummary[],
  now: Date = new Date(),
): Array<{ group: ConversationGroup; rows: ConversationSummary[] }> {
  return GROUP_ORDER.flatMap((group) => {
    const inGroup = rows.filter((row) => groupOf(row.updated_at, now) === group)

    return inGroup.length > 0 ? [{ group, rows: inGroup }] : []
  })
}
