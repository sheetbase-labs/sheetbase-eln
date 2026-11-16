/**
 * Undo for what the assistant changed: one set per approved card or plan, a
 * preview of what undoing would do, and the undo itself, on the API, MCP, the
 * assistant, pipelines and webhooks.
 */
import { AI_UNDO_LAB_TABLES } from './api-tables'
import { AI_UNDO_EVENT_LABELS, AI_UNDO_EVENTS } from './events'
import { AI_UNDO_OPERATIONS } from './operations'
import { CHANGES_READ_TOOL_NAMES } from './undo'
import { defineFeature } from '../define'

export const feature = defineFeature({
  name: 'ai-undo',
  operations: AI_UNDO_OPERATIONS,
  events: AI_UNDO_EVENTS,
  eventLabels: AI_UNDO_EVENT_LABELS,
  labTables: AI_UNDO_LAB_TABLES,
  agentArea: {
    area: 'Undo',
    match: /ai_change_set|ai_undo/,
  },
  assistantReadTools: CHANGES_READ_TOOL_NAMES,
})
