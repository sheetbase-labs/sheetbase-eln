/**
 * The event stream: every catalogued change in a workspace, in order, as
 * CloudEvents 1.0. This module only maps and shapes; reading rows (and the
 * permission filter) lives in `api.event_stream_page`.
 */
import { EVENT_CATALOGUE, toCanonicalEnvelope } from '#/lib/event-catalogue'
import type { PayloadCondition } from '#/lib/event-catalogue'
import type { ChangeEventInput } from '#/lib/webhook-events'

export const CLOUDEVENTS_TYPE_PREFIX = 'io.sheetbase.'

/** One row as `api.event_stream_page` returns it (snake_case, no workspace). */
export interface StreamRow {
  id: string
  sequence: number | string
  entity_type: string
  entity_uuid: string
  operation: string
  record_id: string | null
  project_id: string | null
  actor_user_id: string | null
  actor_credential_id: string | null
  client_id: string | null
  payload: Record<string, unknown> | null
  created_at: string
}

export interface StreamPage {
  events: StreamRow[]
  nextCursor: number
  hasMore: boolean
  earliest: number | null
  latest: number | null
  expired: boolean
  retentionDays: number
}

export interface CloudEvent {
  specversion: '1.0'
  id: string
  source: string
  type: string
  subject: string
  time: string
  datacontenttype: 'application/json'
  /** Extension attribute: the position in the workspace's log. */
  sequence: string
  data: Record<string, unknown>
}

function holds(
  condition: PayloadCondition | undefined,
  payload: Record<string, unknown>,
): boolean {
  if (condition === undefined) return true
  const value = payload[condition.key]

  if (condition.equals !== undefined) return value === condition.equals

  if (condition.notEquals !== undefined) return value !== condition.notEquals

  return true
}

/** The catalogue name for a change, honouring `when`; null when not catalogued. */
export function streamEventName(
  entityType: string,
  operation: string,
  payload: Record<string, unknown>,
): string | null {
  for (const entry of EVENT_CATALOGUE) {
    const producer = entry.producer

    if (
      producer !== null &&
      producer.entityType === entityType &&
      producer.operation === operation &&
      holds(producer.when, payload)
    ) {
      return entry.name
    }
  }

  return null
}

/** Every entity type the catalogue can produce, to narrow the database scan. */
export const STREAM_ENTITY_TYPES: readonly string[] = Object.freeze([
  ...new Set(
    EVENT_CATALOGUE.flatMap((entry) =>
      entry.producer === null ? [] : [entry.producer.entityType],
    ),
  ),
])

/** The kinds of change behind some event names, to narrow the database scan. */
export function entityTypesFor(names: ReadonlySet<string>): readonly string[] {
  if (names.size === 0) return STREAM_ENTITY_TYPES

  return [
    ...new Set(
      EVENT_CATALOGUE.flatMap((entry) =>
        names.has(entry.name) && entry.producer !== null
          ? [entry.producer.entityType]
          : [],
      ),
    ),
  ]
}

/** Every catalogue name, for the `types` filter. */
export function knownEventNames(): Set<string> {
  return new Set(EVENT_CATALOGUE.map((entry) => entry.name))
}

export function toCloudEvent(
  workspaceId: string,
  row: StreamRow,
): CloudEvent | null {
  const payload = row.payload ?? {}
  const name = streamEventName(row.entity_type, row.operation, payload)

  if (name === null) return null

  const input: ChangeEventInput = {
    id: row.id,
    workspaceId,
    sequence: Number(row.sequence),
    entityType: row.entity_type,
    entityUuid: row.entity_uuid,
    operation: row.operation,
    recordId: row.record_id,
    projectId: row.project_id,
    actorUserId: row.actor_user_id,
    actorCredentialId: row.actor_credential_id,
    clientId: row.client_id,
    payload,
    createdAt: new Date(row.created_at).toISOString(),
  }

  const envelope = toCanonicalEnvelope(input, name)

  return {
    specversion: '1.0',
    id: row.id,
    source: `/workspaces/${workspaceId}`,
    type: `${CLOUDEVENTS_TYPE_PREFIX}${name}`,
    subject: `${row.entity_type}/${row.entity_uuid}`,
    time: input.createdAt,
    datacontenttype: 'application/json',
    sequence: String(input.sequence),
    data: {
      actor: envelope.actor,
      provenance: envelope.provenance,
      data: envelope.data,
    },
  }
}

export interface ShapedPage {
  events: CloudEvent[]
  nextCursor: number
  hasMore: boolean
  earliest: number | null
  latest: number | null
  retentionDays: number
}

/** A database page as the public response: catalogued events only, filtered by name. */
export function shapePage(
  workspaceId: string,
  page: StreamPage,
  names?: ReadonlySet<string>,
): ShapedPage {
  const events: CloudEvent[] = []

  for (const row of page.events) {
    const event = toCloudEvent(workspaceId, row)

    if (!event) continue

    if (names && names.size > 0) {
      if (!names.has(event.type.slice(CLOUDEVENTS_TYPE_PREFIX.length))) continue
    }

    events.push(event)
  }

  return {
    events,
    nextCursor: Number(page.nextCursor),
    hasMore: page.hasMore,
    earliest: page.earliest == null ? null : Number(page.earliest),
    latest: page.latest == null ? null : Number(page.latest),
    retentionDays: page.retentionDays,
  }
}

/** One Server-Sent Events frame for an event. */
export function sseFrame(event: CloudEvent): string {
  return `id: ${event.sequence}\nevent: ${event.type.slice(CLOUDEVENTS_TYPE_PREFIX.length)}\ndata: ${JSON.stringify(event)}\n\n`
}
