/** Webhook, live feed and pipeline events for the Agent page's conversations. */
import type { EventCatalogueEntry } from '#/lib/event-catalogue'

import { WEBHOOK_SSE_PIPELINE } from '../define'

const event = (
  entry: Pick<EventCatalogueEntry, 'name' | 'summary' | 'producer' | 'notes'>,
): EventCatalogueEntry => ({
  family: 'administration',
  wireName: entry.name,
  status: 'stable',
  introducedIn: 'agent-chat-01',
  consumers: WEBHOOK_SSE_PIPELINE,
  ...entry,
})

export const ASSISTANT_CONVERSATION_EVENTS: readonly EventCatalogueEntry[] =
  Object.freeze([
    event({
      name: 'assistant.conversation.created',
      summary: 'Someone started a conversation on the Agent page.',
      producer: { entityType: 'assistant_conversation', operation: 'create' },
      notes:
        'Payload carries `conversationId`, `title` and `messageCount`, never the messages themselves.',
    }),
    event({
      name: 'assistant.conversation.deleted',
      summary: 'Someone deleted one of their conversations on the Agent page.',
      producer: { entityType: 'assistant_conversation', operation: 'delete' },
      notes: 'Payload carries `conversationId` and `title`.',
    }),
  ])

export const ASSISTANT_CONVERSATION_EVENT_LABELS = {
  'assistant.conversation.created':
    'A conversation is started on the Agent page',
  'assistant.conversation.deleted':
    'A conversation is deleted on the Agent page',
} as const
