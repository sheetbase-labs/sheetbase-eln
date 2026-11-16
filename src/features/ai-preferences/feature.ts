/**
 * AI preferences: short standing notes the assistant keeps about how the lab
 * (or one person) likes things done. A person confirms each one on a card, and
 * the assistant reads the saved ones before it plans.
 */
import { defineFeature } from '../define'
import { AI_PREFERENCE_LAB_TABLES } from './api-tables'
import { AI_PREFERENCE_OPERATIONS } from './operations'

/** Lists what the assistant remembers; answers in the reply. */
export const AI_PREFERENCES_READ_TOOL = 'sheetbase.ai_preferences.list'

export const feature = defineFeature({
  name: 'ai-preferences',
  operations: AI_PREFERENCE_OPERATIONS,
  labTables: AI_PREFERENCE_LAB_TABLES,
  eventLabels: {
    'ai.preference.saved': 'A preference is saved for the assistant',
    'ai.preference.updated': 'A preference for the assistant is changed',
    'ai.preference.deleted': 'A preference for the assistant is removed',
  },
  agentArea: {
    area: 'Agents and AI',
    match: /_ai_preference$/,
    beforeCore: true,
  },
  agentMayDelete: ['delete_ai_preference'],
  assistantReadTools: [AI_PREFERENCES_READ_TOOL],
})
