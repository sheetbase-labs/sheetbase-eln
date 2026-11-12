/** Webhook events for parameter sets: saved (made or changed) and deleted. */
import type { EventCatalogueEntry } from '#/lib/event-catalogue'

import { WEBHOOK_SSE_PIPELINE } from '../define'

const event = (
  entry: Pick<EventCatalogueEntry, 'name' | 'summary' | 'producer' | 'notes'>,
): EventCatalogueEntry => ({
  family: 'pipeline',
  wireName: entry.name,
  status: 'stable',
  introducedIn: 'pipelines-sets',
  consumers: WEBHOOK_SSE_PIPELINE,
  ...entry,
})

export const PARAMETER_SET_EVENTS: readonly EventCatalogueEntry[] =
  Object.freeze([
    event({
      name: 'pipeline.parameter_set.created',
      summary: 'A reusable parameter set was made.',
      producer: { entityType: 'pipeline_parameter_set', operation: 'create' },
      notes: 'Payload is the set: `key`, `name` and `parameters`.',
    }),
    event({
      name: 'pipeline.parameter_set.updated',
      summary: 'A reusable parameter set was changed.',
      producer: { entityType: 'pipeline_parameter_set', operation: 'update' },
      notes:
        'Versions that included it keep their own copy until they are saved again.',
    }),
    event({
      name: 'pipeline.parameter_set.deleted',
      summary: 'A reusable parameter set was deleted.',
      producer: { entityType: 'pipeline_parameter_set', operation: 'delete' },
    }),
  ])

export const PARAMETER_SET_EVENT_LABELS = {
  'pipeline.parameter_set.created': 'A parameter set is made',
  'pipeline.parameter_set.updated': 'A parameter set is changed',
  'pipeline.parameter_set.deleted': 'A parameter set is deleted',
} as const
