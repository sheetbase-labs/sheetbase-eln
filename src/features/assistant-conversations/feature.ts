/**
 * The Agent page: a full-page chat with the assistant and the person's saved
 * conversations. The chat itself is the assistant (same tools, confirm cards,
 * budget and agent policies); this folder is only the saved conversations.
 */
import { defineFeature } from '../define'
import { ASSISTANT_CONVERSATION_LAB_TABLES } from './api-tables'
import {
  ASSISTANT_CONVERSATION_EVENT_LABELS,
  ASSISTANT_CONVERSATION_EVENTS,
} from './events'
import { ASSISTANT_CONVERSATION_OPERATIONS } from './operations'

export const feature = defineFeature({
  name: 'assistant-conversations',
  operations: ASSISTANT_CONVERSATION_OPERATIONS,
  events: ASSISTANT_CONVERSATION_EVENTS,
  eventLabels: ASSISTANT_CONVERSATION_EVENT_LABELS,
  labTables: ASSISTANT_CONVERSATION_LAB_TABLES,
})
