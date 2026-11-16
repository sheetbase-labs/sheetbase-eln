/** Webhook, live feed and pipeline events for undoing what the assistant changed. */
import type { EventCatalogueEntry } from '#/lib/event-catalogue'

import { WEBHOOK_SSE_PIPELINE } from '../define'

export const AI_UNDO_EVENTS: readonly EventCatalogueEntry[] = Object.freeze([
  {
    name: 'assistant.changes.undone',
    family: 'administration',
    wireName: 'assistant.changes.undone',
    status: 'stable',
    introducedIn: 'ai-undo-01',
    consumers: WEBHOOK_SSE_PIPELINE,
    summary: 'Someone undid the changes an assistant card or plan made.',
    producer: {
      entityType: 'assistant_change_set',
      operation: 'update',
      when: { key: 'effect', equals: 'undone' },
    },
    notes:
      'Payload carries `changeSetId`, `title` and `kind` (`card` or `plan`). Each thing put back also sends its own event as the person (for example `record.archived` or `booking.cancelled`).',
  },
])

export const AI_UNDO_EVENT_LABELS = {
  'assistant.changes.undone': 'Changes made by the assistant are undone',
} as const
