import type { DataClient } from '#/lib/data-client'
import type { AssistantUIMessage } from '#/lib/assistant-chat'
import { messageText } from '#/lib/assistant-chat'

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
  return messages.filter(
    (message) =>
      message.role === 'user' ||
      messageText(message).trim() !== '' ||
      message.parts.some((part) => part.type === 'dynamic-tool'),
  )
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

const TITLE_CHARS = 60

/** A conversation's title: the first thing the person asked, kept short. */
export function titleFromMessages(
  messages: readonly AssistantUIMessage[],
): string | undefined {
  const first = messages.find((message) => message.role === 'user')
  const text = first ? messageText(first).replaceAll(/\s+/g, ' ').trim() : ''

  if (text === '') return undefined

  return text.length > TITLE_CHARS
    ? `${text.slice(0, TITLE_CHARS - 1).trimEnd()}…`
    : text
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
