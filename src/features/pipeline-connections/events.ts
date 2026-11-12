/** Webhook events for pipeline connections: an address approved, changed or removed. */
import type { EventCatalogueEntry } from '#/lib/event-catalogue'

import { WEBHOOK_SSE_PIPELINE } from '../define'

const event = (
  entry: Pick<EventCatalogueEntry, 'name' | 'summary' | 'producer' | 'notes'>,
): EventCatalogueEntry => ({
  family: 'administration',
  wireName: entry.name,
  status: 'stable',
  introducedIn: 'pipelines-web-call',
  consumers: WEBHOOK_SSE_PIPELINE,
  ...entry,
})

export const PIPELINE_CONNECTION_EVENTS: readonly EventCatalogueEntry[] =
  Object.freeze([
    event({
      name: 'pipeline_connection.created',
      summary: 'An administrator approved an address for pipeline web calls.',
      producer: { entityType: 'pipeline_connection', operation: 'create' },
      notes:
        'Payload carries `connectionId`, `key`, `name`, `kind` and `baseUrl`.',
    }),
    event({
      name: 'pipeline_connection.updated',
      summary:
        'A pipeline connection was renamed, moved to another address, or switched on or off.',
      producer: { entityType: 'pipeline_connection', operation: 'update' },
      notes:
        'Payload carries `connectionId`, `key`, `name`, `kind`, `baseUrl` and `status`.',
    }),
    event({
      name: 'pipeline_connection.deleted',
      summary: 'A pipeline connection and its secrets were removed.',
      producer: { entityType: 'pipeline_connection', operation: 'delete' },
      notes: 'Payload carries `connectionId`, `key` and `name`.',
    }),
  ])
